import {createHash,randomUUID} from 'node:crypto';
import {dirname,join,relative,basename} from 'node:path';
import {mkdir,readdir,readFile,writeFile,rename,stat,rm,copyFile,chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {GatewayContext,GatewayContextError,type ContextScope} from './gateway-context.js';
import {safePath} from './agent-connections.js';
import {CodexHistoryBackups,type HistorySnapshot} from './codex-history-backups.js';

type Item=Record<string,any>;
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
// V8 substrings can pin the whole rollout they were split from.
const detached=(text:string):string=>JSON.parse(JSON.stringify(text));
export const codexContextScope:ContextScope={owner:'managed-agent:codex',source:'portable-context',model:'portable-context'};
const failure=()=>new GatewayContextError('无法恢复这段压缩上下文。请在保留原始会话记录的本机继续，或提供可读交接摘要；原会话未被清空。');
const object=(v:unknown):v is Item=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function portableCodexItem(item:Item):Item[]{
 if(!object(item))throw failure();
 // Responses Lite declarations describe the tools available in that old turn,
 // not a conversation message. The current request supplies its own tools.
 if(item.type==='additional_tools'||(item.type==='message'&&item.role==='developer'&&Array.isArray(item.tools)&&item.content===undefined))return [];
 if(item.type==='compaction'||item.type==='item_reference')throw failure();
 if(item.type==='reasoning'){
  const text=(Array.isArray(item.summary)?item.summary:[]).filter((p:Item)=>object(p)&&typeof p.text==='string').map((p:Item)=>p.text).join('\n');
  return text?[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]:[];
 }
 if(item.type==='agent_message'){
  const text=(Array.isArray(item.content)?item.content:[]).filter((p:Item)=>object(p)&&typeof p.text==='string').map((p:Item)=>p.text).join('\n');
  return text?[{type:'message',role:'developer',content:[{type:'input_text',text}]}]:[];
 }
 const value=structuredClone(item);delete value.id;delete value.encrypted_content;
 if(typeof value.role==='string'){
  value.type='message';
  if(typeof value.content==='string')value.content=[{type:value.role==='assistant'?'output_text':'input_text',text:value.content}];
  else if(Array.isArray(value.content))value.content=value.content.filter((p:Item)=>!object(p)||p.type!=='encrypted_content');
 }
 return [value];
}
/** Replays only local Codex rollout data. No credentials, cloud lookup, or model
 * call occurs here. The service enables this exclusively for its managed Codex key. */
export class CodexContext {
 private cache:string;private backups:string;private history:CodexHistoryBackups;
 constructor(private root:string,private configPath:string,private context:GatewayContext){this.cache=join(root,'codex-context-cache');this.backups=join(root,'codex-context-backups');this.history=new CodexHistoryBackups(root);}
 private async files(){
  const files:{path:string;mtime:number}[]=[];
  const walk=async(dir:string,depth:number)=>{
   await safePath(dir);let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}
   for(const entry of entries){if(entry.isSymbolicLink())continue;const path=join(dir,entry.name);
    if(entry.isDirectory()&&depth<4)await walk(path,depth+1);
    else if(entry.isFile()&&/^rollout-.*\.jsonl$/.test(entry.name)){const info=await stat(path);files.push({path,mtime:info.mtimeMs});}
   }
  };
  await walk(join(dirname(this.configPath),'sessions'),0);await walk(join(dirname(this.configPath),'archived_sessions'),0);
  return files.sort((a,b)=>b.mtime-a.mtime);
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
  if(item.type==='previous_response')return (await this.context.readStoredHistory(item.id,[codexContextScope,...scopes])).flatMap(portableCodexItem);
  const token=item.encrypted_content;if(typeof token!=='string'||!token)throw failure();
  if(token.startsWith('tfctx1.'))return this.context.decodeCheckpoint(token,[codexContextScope,...scopes]).flatMap(portableCodexItem);
  const cached=await this.cached(token);if(cached)return cached.flatMap(portableCodexItem);
  for(const {path} of await this.files()){
   await safePath(path);const text=await readFile(path,'utf8');if(!text.includes(token))continue;
   let history:Item[]=[];let complete=false;
   for(const line of text.split('\n')){
    let event:Item;try{event=JSON.parse(line);}catch{if(line.trim())throw failure();continue;}
    const payload=event.payload;if(!object(payload))continue;
    if(event.type==='event_msg'&&payload.type==='thread_rolled_back')throw failure();
    if(event.type==='response_item'){
     if(payload.type==='compaction'){
      if(payload.encrypted_content===token){complete=true;break;}
      if(typeof payload.encrypted_content==='string'&&payload.encrypted_content.startsWith('tfctx1.'))history=this.context.decodeCheckpoint(payload.encrypted_content,[codexContextScope,...scopes]).flatMap(portableCodexItem);
      continue;
     }
     history.push(...portableCodexItem(payload));
    }
    if(event.type==='compacted'){
     const replacement=payload.replacement_history;
     if(!Array.isArray(replacement)||!replacement.every(object))throw failure();
     if(replacement.some(i=>i.type==='compaction'&&i.encrypted_content===token)){complete=true;break;}
     if(!replacement.some(i=>i.type==='compaction'))history=replacement.flatMap(portableCodexItem);
     else if(replacement.some(i=>i.type==='compaction'&&String(i.encrypted_content).startsWith('tfctx1.'))){
      history=[];
      for(const item of replacement){
       if(item.type==='compaction'&&String(item.encrypted_content).startsWith('tfctx1.'))history=this.context.decodeCheckpoint(item.encrypted_content,[codexContextScope,...scopes]).flatMap(portableCodexItem);
       else if(item.type!=='compaction')history.push(...portableCodexItem(item));
      }
     }
     // Earlier opaque windows are reconstructed from their original response
     // items already on disk; never pretend the ciphertext is a readable summary.
    }
   }
   if(complete&&history.some(i=>i.role==='user')){
    await this.save(token,history);return history;
   }
  }
  throw failure();
 }
 /** Called before leaving the gateway. Restore plaintext checkpoints only after
  * Codex has exited; compare bytes again and back up before atomic replacement. */
 async repairLineage(processes:()=>Promise<number[]>){return this.prepare([],processes,false);}
 async prepareOfficial(scopes:ContextScope[],processes:()=>Promise<number[]>){return this.prepare(scopes,processes,true);}
 private async prepare(scopes:ContextScope[],processes:()=>Promise<number[]>,normalize:boolean){
  const staging=join(this.root,'codex-context-staging',randomUUID());
  try{return await this.rewrite(scopes,processes,normalize,staging);}finally{await rm(staging,{recursive:true,force:true});}
 }
 private async rewrite(scopes:ContextScope[],processes:()=>Promise<number[]>,normalize:boolean,staging:string){
  // Rewritten rollouts wait on disk; only their hashes stay in memory.
  const candidates:{path:string;beforeHash:string;afterHash:string;staged:string}[]=[];
  const stage=async(path:string,before:string,after:string)=>{
   await mkdir(staging,{recursive:true,mode:0o700});const staged=join(staging,`${candidates.length}.jsonl`);
   await writeFile(staged,after,{mode:0o600,flag:'wx'});candidates.push({path,beforeHash:digest(before),afterHash:digest(after),staged});
  };
  // Keep only headers and numeric boundaries for unchanged history. A large
  // Codex home can contain gigabytes of rollouts; never retain them all in RAM.
  const views=new Map<string,{header:string;originalHeader:string;row:Item;boundaries:number[]}>();
  const remember=(path:string,text:string)=>{
   const lines=text.split('\n');let row:Item;try{row=JSON.parse(lines[0]!);}catch{return;}
   const boundaries=[0];let bytes=0,ordinal=0;
   for(const line of lines){if(!line)break;let event:Item;try{event=JSON.parse(line);}catch{break;}if(event.ordinal!==ordinal)break;bytes+=Buffer.byteLength(line)+1;boundaries[++ordinal]=bytes;}
   const header=detached(lines[0]!);
   views.set(path,{header,originalHeader:views.get(path)?.originalHeader??header,row,boundaries});
  };
  for(const {path} of await this.files()){
   await safePath(path);const before=await readFile(path,'utf8');remember(path,before);const lines=before.split('\n');let index=-1,event:Item|undefined;let malformed=false;
   let gatewayTurn=false;const foreignReasoning=new Set<string>();
   const normalizeItem=(item:Item):Item[]=>{
    // Gateway item IDs identify records in that source, not persisted OpenAI
    // items. Replay complete inline items on return; call_id still binds every
    // tool result to its call. Keep native IDs outside gateway turns intact.
    if(gatewayTurn&&typeof item?.id==='string'&&['message','function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(item.type)){
     const value={...item};delete value.id;return [value];
    }
    if(!normalize)return [item];
    // Chat-to-Responses translators emit synthetic reasoning IDs and sometimes
    // an empty ciphertext. Neither is an official encrypted reasoning item.
    if(item?.type!=='reasoning'||!(gatewayTurn||foreignReasoning.has(item.id)||/^rs_chatcmpl[-_]/.test(String(item.id))))return [item];
    if(typeof item.id==='string')foreignReasoning.add(item.id);
    return portableCodexItem(item);
   };
   for(let i=0;i<lines.length;i++){
    let row:Item;try{row=JSON.parse(lines[i]!);}catch{if(lines[i]!.trim())malformed=true;continue;}
    if(!object(row.payload))continue;
    if(row.type==='session_meta')gatewayTurn=row.payload.model_provider==='token_flow';
    if(row.type==='turn_context'&&typeof row.payload.model==='string')gatewayTurn=row.payload.model.includes('/');
    if(row.type==='response_item'){
     const normalized=normalizeItem(row.payload);
     if(normalized.length!==1||normalized[0]!==row.payload)lines[i]=(normalized.length?normalized:[{type:'message',role:'assistant',content:[{type:'output_text',text:''}]}]).map(payload=>JSON.stringify({...row,payload})).join('\n');
    }
    if(row.type==='compacted'){
     const history=row.payload.replacement_history;
     if(Array.isArray(history)){
      const normalized=history.flatMap(normalizeItem);
      if(JSON.stringify(normalized)!==JSON.stringify(history)){row.payload.replacement_history=normalized;delete row.payload.replacement_history_metadata;lines[i]=JSON.stringify(row);}
     }
     index=i;event=row;
    }else if(row.type==='response_item'&&row.payload.type==='compaction'){index=i;event={...row,type:'compacted',payload:{message:'',replacement_history:[row.payload]}};}
   }
   const retainChanges=async()=>{
    const after=lines.join('\n');if(after===before)return;
    if(malformed)throw new GatewayContextError('会话记录不完整，迁移已停止；请先退出 Codex 后重试，原文件保留。',409);
    await stage(path,before,after);remember(path,after);
   };
   if(!normalize){await retainChanges();continue;}
   const history=event?.payload?.replacement_history;if(index<0||!Array.isArray(history)){await retainChanges();continue;}
   const recoveredTokens=new Map<string,Item[]>();
   for(const item of history){
    if(item?.type!=='compaction'||typeof item.encrypted_content!=='string')continue;
    const token=item.encrypted_content;
    const recovered=token.startsWith('tfctx1.')?this.context.decodeCheckpoint(token,[codexContextScope,...scopes]):await this.cached(token);
    if(recovered)recoveredTokens.set(token,recovered);
   }
   if(!recoveredTokens.size){await retainChanges();continue;}
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
    lines[index]=JSON.stringify(event);
   }
   await retainChanges();
  }
  // Codex paginated branches pin an ordinal AND a byte boundary in the
  // canonical source rollout. Rewriting JSON changes UTF-8 byte lengths even
  // when every event stays in place. Rebase dependants, including stale bounds
  // left by older TokenFlow versions, from explicit ordinals (never guess).
  const sources=new Map<string,string>(),invalidated=new Set<string>();
  for(const [path,view] of views){const meta=view.row.payload;if(typeof meta?.id==='string'&&basename(path).endsWith(`-${meta.id}.jsonl`))sources.set(meta.id,path);}
  let changed=true,passes=0;
  while(changed){
   if(++passes>views.size+1)throw new GatewayContextError('分页历史依赖存在循环，原记录保留。',409);
   changed=false;
   for(const view of views.values()){
    const base=view.row.type==='session_meta'?view.row.payload?.history_base:undefined;
    if(!base||!Number.isSafeInteger(base.end_ordinal_exclusive)||base.end_ordinal_exclusive<0)continue;
    const source=sources.get(base.thread_id);if(!source)continue;
    const offset=views.get(source)!.boundaries[base.end_ordinal_exclusive];
    if(offset===undefined||offset===base.end_byte_offset)continue;
    invalidated.add(base.thread_id);base.end_byte_offset=offset;
    const header=JSON.stringify(view.row),delta=Buffer.byteLength(header)-Buffer.byteLength(view.header);
    for(let ordinal=1;ordinal<view.boundaries.length;ordinal++)view.boundaries[ordinal]!+=delta;
    view.header=header;changed=true;
   }
  }
  for(const [path,view] of views){
   if(view.header===view.originalHeader)continue;
   const rest=(text:string)=>{const end=text.indexOf('\n');return end<0?'':text.slice(end);};
   const candidate=candidates.find(c=>c.path===path);
   if(candidate){const after=view.header+rest(await readFile(candidate.staged,'utf8'));await writeFile(candidate.staged,after,{mode:0o600});candidate.afterHash=digest(after);continue;}
   await safePath(path);const before=await readFile(path,'utf8');if(before.split('\n',1)[0]!==view.originalHeader)throw new GatewayContextError('迁移期间会话发生变化，原记录保留。',409);
   await stage(path,before,view.header+rest(before));
  }
  for(const c of candidates){const id=views.get(c.path)?.row.payload?.id;if(typeof id==='string')invalidated.add(id);}
  if(!candidates.length)return {migrated:0};
  if((await processes()).length)throw Object.assign(new Error(`有 ${candidates.length} 个会话需要兼容处理。请先退出 Codex，再切换官方登录；原配置和会话尚未修改。`),{statusCode:409});
  const changedDuringBackup=()=>Object.assign(new Error('迁移期间会话发生变化，已停止；原始备份已保留。'),{statusCode:409});
  const batch=join(this.backups,randomUUID());await mkdir(batch,{recursive:true,mode:0o700});
  const journal=candidates.map(c=>({path:relative(dirname(this.configPath),c.path),historySnapshot:undefined as HistorySnapshot|undefined,beforeHash:c.beforeHash,afterHash:c.afterHash}));
  const databaseBackups:Record<string,string>={};const createdAt=new Date().toISOString();
  const saveJournal=()=>writeFile(join(batch,'manifest.json'),JSON.stringify({createdAt,files:journal,databaseBackups}),{mode:0o600});
  try{
   for(let i=0;i<candidates.length;i++){const c=candidates[i]!;await safePath(c.path);const before=await readFile(c.path,'utf8');if(digest(before)!==c.beforeHash)throw changedDuringBackup();journal[i]!.historySnapshot=await this.history.capture(c.path,Buffer.from(before));}
   await saveJournal();
  }catch(error){await rm(batch,{recursive:true,force:true});throw error;}
  // This database is a derived UI projection with byte offsets into the
  // rollouts. Preserve a consistent backup, then let Codex rebuild affected
  // projections from history instead of reusing offsets into rewritten bytes.
  const home=dirname(this.configPath);
  const databaseCandidates:string[]=[];
  for(const directory of [join(this.root,'codex-thread-backups'),this.backups])for(const id of await readdir(directory).catch(()=>[]))if(/^[a-f0-9-]{36}$/.test(id))databaseCandidates.push(join(directory,id));
  for(const name of (await readdir(home)).filter(n=>/^thread_history_\d+\.sqlite$/.test(n))){
   if(!invalidated.size)break;
   const path=join(home,name);await safePath(path);
   const {DatabaseSync,backup}=await import('node:sqlite');const db=new DatabaseSync(path);
   try{
    for(const directory of databaseCandidates){const candidate=join(directory,name);try{await safePath(candidate);if((await stat(candidate)).isFile()){databaseBackups[name]=candidate;break;}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
    if(!databaseBackups[name]){databaseBackups[name]=join(batch,name);await backup(db,databaseBackups[name]);}
    await saveJournal();
    if((await processes()).length)throw new GatewayContextError('Codex 重新启动，迁移已停止。',409);
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
    db.exec('BEGIN IMMEDIATE');
    try{for(const table of ['thread_turns','thread_items','thread_history_projection_state','thread_realtime_items'])if(tables.has(table)){const remove=db.prepare(`DELETE FROM ${table} WHERE thread_id=?`);for(const id of invalidated)remove.run(id);}db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
   }finally{db.close();}
  }
  const unchanged=async(path:string,hash:string)=>digest(await readFile(path,'utf8'))===hash;
  for(const candidate of candidates){
   await safePath(candidate.path);if(!await unchanged(candidate.path,candidate.beforeHash))throw changedDuringBackup();
   const temp=candidate.path+'.token-flow-'+randomUUID();
   try{await copyFile(candidate.staged,temp,constants.COPYFILE_EXCL);await chmod(temp,0o600);if(!await unchanged(temp,candidate.afterHash))throw changedDuringBackup();if((await processes()).length||!await unchanged(candidate.path,candidate.beforeHash))throw Object.assign(new Error('Codex 重新启动或会话发生变化，迁移已停止，备份保留。'),{statusCode:409});await rename(temp,candidate.path);}finally{await rm(temp,{force:true});}
  }
  return {migrated:candidates.length};
 }
}
