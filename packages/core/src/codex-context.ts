import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,relative} from 'node:path';
import {mkdir,readdir,readFile,writeFile,rename,stat,rm} from 'node:fs/promises';
import {GatewayContext,GatewayContextError,type ContextScope} from './gateway-context.js';
import {safePath} from './agent-connections.js';

type Item=Record<string,any>;
const LIMIT=64*1024*1024;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export const codexContextScope:ContextScope={owner:'managed-agent:codex',source:'portable-context',model:'portable-context'};
const failure=()=>new GatewayContextError('无法恢复这段压缩上下文。请在保留原始会话记录的本机继续，或提供可读交接摘要；原会话未被清空。');
const object=(v:unknown):v is Item=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function portableCodexItem(item:Item):Item[]{
 if(!object(item))throw failure();
 if(item.type==='compaction'||item.type==='item_reference')throw failure();
 if(item.type==='reasoning'){
  const text=(Array.isArray(item.summary)?item.summary:[]).filter((p:Item)=>object(p)&&typeof p.text==='string').map((p:Item)=>p.text).join('\n');
  return text?[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]:[];
 }
 const value=structuredClone(item);delete value.id;delete value.encrypted_content;
 if(typeof value.role==='string'){value.type='message';if(typeof value.content==='string')value.content=[{type:value.role==='assistant'?'output_text':'input_text',text:value.content}];}
 return [value];
}
/** Replays only local Codex rollout data. No credentials, cloud lookup, or model
 * call occurs here. The service enables this exclusively for its managed Codex key. */
export class CodexContext {
 private cache:string;private backups:string;
 constructor(private root:string,private configPath:string,private context:GatewayContext){this.cache=join(root,'codex-context-cache');this.backups=join(root,'codex-context-backups');}
 private async files(){
  const files:{path:string;mtime:number}[]=[];
  const walk=async(dir:string,depth:number)=>{
   await safePath(dir);let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
   for(const entry of entries){if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);
    if(entry.isDirectory()&&depth<4)await walk(path,depth+1);
    else if(entry.isFile()&&/^rollout-.*\.jsonl$/.test(entry.name)){const info=await stat(path);if(info.size<=LIMIT)files.push({path,mtime:info.mtimeMs});}
   }
  };
  await walk(join(dirname(this.configPath),'sessions'),0);await walk(join(dirname(this.configPath),'archived_sessions'),0);
  return files.sort((a,b)=>b.mtime-a.mtime).slice(0,2000);
 }
 private async cached(token:string){
  try{return this.context.decodeCheckpoint(await readFile(join(this.cache,digest(token)),'utf8'),[codexContextScope]);}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw e;}
 }
 private async save(token:string,items:Item[]){
  await mkdir(this.cache,{recursive:true,mode:0o700});const path=join(this.cache,digest(token)),temp=path+'.'+randomUUID();
  try{await writeFile(temp,this.context.encodeCheckpoint(items,codexContextScope),{mode:0o600,flag:'wx'});await rename(temp,path);}finally{await rm(temp,{force:true});}
 }
 async recover(item:Item,scopes:ContextScope[]):Promise<Item[]>{
  if(item.type==='previous_response')return this.context.readStoredHistory(item.id,[codexContextScope,...scopes]);
  const token=item.encrypted_content;if(typeof token!=='string'||!token)throw failure();
  if(token.startsWith('tfctx1.'))return this.context.decodeCheckpoint(token,[codexContextScope,...scopes]);
  const cached=await this.cached(token);if(cached)return cached;
  for(const {path} of await this.files()){
   await safePath(path);const text=await readFile(path,'utf8');if(!text.includes(token))continue;
   let history:Item[]=[];let complete=false;
   for(const line of text.split('\n')){
    let event:Item;try{event=JSON.parse(line);}catch{if(line.trim())throw failure();continue;}
    const payload=event.payload;if(!object(payload))continue;
    if(event.type==='event_msg'&&payload.type==='thread_rolled_back')throw failure();
    if(event.type==='response_item'){
     if(payload.type==='compaction'){if(payload.encrypted_content===token){complete=true;break;}continue;}
     history.push(...portableCodexItem(payload));
    }
    if(event.type==='compacted'){
     const replacement=payload.replacement_history;
     if(!Array.isArray(replacement)||!replacement.every(object))throw failure();
     if(replacement.some(i=>i.type==='compaction'&&i.encrypted_content===token)){complete=true;break;}
     if(!replacement.some(i=>i.type==='compaction'))history=replacement.flatMap(portableCodexItem);
     // Earlier opaque windows are reconstructed from their original response
     // items already on disk; never pretend the ciphertext is a readable summary.
    }
   }
   if(complete&&history.some(i=>i.role==='user')){
    if(Buffer.byteLength(JSON.stringify(history))>16*1024*1024)throw new GatewayContextError('可恢复历史超过 16 MB，请先在原来源压缩或生成交接摘要；原会话未修改。',413);
    await this.save(token,history);return history;
   }
  }
  throw failure();
 }
 /** Called before leaving the gateway. Restore plaintext checkpoints only after
  * Codex has exited; compare bytes again and back up before atomic replacement. */
 async prepareOfficial(scopes:ContextScope[],processes:()=>Promise<number[]>){
  const candidates:{path:string;before:string;after:string}[]=[];
  for(const {path} of await this.files()){
   await safePath(path);const before=await readFile(path,'utf8');const lines=before.split('\n');let index=-1,event:Item|undefined;let malformed=false;
   for(let i=0;i<lines.length;i++){try{const row=JSON.parse(lines[i]!);if(row.type==='compacted'){index=i;event=row;}else if(row.type==='response_item'&&row.payload?.type==='compaction'){index=i;event={...row,type:'compacted',payload:{message:'',replacement_history:[row.payload]}};}}catch{if(lines[i]!.trim())malformed=true;}}
   const history=event?.payload?.replacement_history;if(index<0||!Array.isArray(history))continue;
   const recoveredTokens=new Map<string,Item[]>();
   for(const item of history){
    if(item?.type!=='compaction'||typeof item.encrypted_content!=='string')continue;
    const token=item.encrypted_content;
    const recovered=token.startsWith('tfctx1.')?this.context.decodeCheckpoint(token,[codexContextScope,...scopes]):await this.cached(token);
    if(recovered)recoveredTokens.set(token,recovered);
   }
   if(!recoveredTokens.size)continue;
   let changed=false;const output:Item[]=[];
   for(const item of history){
    if(item?.type!=='compaction'){output.push(...portableCodexItem(item));continue;}
    const recovered=recoveredTokens.get(item.encrypted_content);
    if(!recovered){output.push(item);continue;}
    // This checkpoint covers preceding retained user messages; use the full
    // restored window, not both copies of the same turns.
    const fresh=output.filter(entry=>['user','system','developer'].includes(String(entry.role))&&!recovered!.some(saved=>saved.role===entry.role&&JSON.stringify(saved.content)===JSON.stringify(entry.content)));
    output.length=0;output.push(...recovered.flatMap(portableCodexItem),...fresh);changed=true;
   }
   if(changed){
    if(malformed)throw new GatewayContextError('会话记录不完整，迁移已停止；请先退出 Codex 后重试，原文件保留。',409);
    event!.payload.replacement_history=output;
    // This optional array is position-aligned with the OLD history. Keeping it
    // causes Codex to ignore the rewritten checkpoint on resume. The independent
    // guardian history and retained user/assistant records remain unchanged.
    delete event!.payload.replacement_history_metadata;
    lines[index]=JSON.stringify(event);candidates.push({path,before,after:lines.join('\n')});
   }
  }
  if(!candidates.length)return {migrated:0};
  if((await processes()).length)throw Object.assign(new Error(`有 ${candidates.length} 个压缩会话需要迁移。请先退出 Codex，再切换官方登录；原配置和会话尚未修改。`),{statusCode:409});
  const batch=join(this.backups,randomUUID());await mkdir(batch,{recursive:true,mode:0o700});
  const journal=candidates.map((c,i)=>({path:relative(dirname(this.configPath),c.path),backup:`${i}.jsonl`,beforeHash:digest(c.before),afterHash:digest(c.after)}));
  for(let i=0;i<candidates.length;i++)await writeFile(join(batch,`${i}.jsonl`),candidates[i]!.before,{mode:0o600,flag:'wx'});
  await writeFile(join(batch,'manifest.json'),JSON.stringify({createdAt:new Date().toISOString(),files:journal}),{mode:0o600,flag:'wx'});
  for(const candidate of candidates){
   await safePath(candidate.path);if(await readFile(candidate.path,'utf8')!==candidate.before)throw Object.assign(new Error('迁移期间会话发生变化，已停止；原始备份已保留。'),{statusCode:409});
   const temp=candidate.path+'.token-flow-'+randomUUID();
   try{await writeFile(temp,candidate.after,{mode:0o600,flag:'wx'});if((await processes()).length||await readFile(candidate.path,'utf8')!==candidate.before)throw Object.assign(new Error('Codex 重新启动或会话发生变化，迁移已停止，备份保留。'),{statusCode:409});await rename(temp,candidate.path);}finally{await rm(temp,{force:true});}
  }
  return {migrated:candidates.length};
 }
}
