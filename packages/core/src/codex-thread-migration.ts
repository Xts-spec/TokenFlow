import {codexRuntimeClient,migrationBinary} from './codex-runtime.js';
import {mkdir, readdir, readFile, writeFile, rename, copyFile, chmod} from 'node:fs/promises';
import {constants} from 'node:fs';
import {dirname,join,isAbsolute} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RunnerCoreError} from './errors.js';
import {safePath} from './agent-connections.js';

const active=(entry:Entry)=>entry.state!=='restored'&&entry.state!=='deleted';
const fail=(message:string,code='codex_migration_failed')=>new RunnerCoreError(message,{statusCode:409,code});
type Route={id:string;provider:string;model:string;rollout:string;archived:boolean;source:string};
type Entry=Route&{nextModel:string;returnModel?:string;rearchive?:boolean;state:'pending'|'migrated'|'restored'|'deleted'};
type Journal={version:1;id:string;createdAt:string;state:'prepared'|'migrated'|'restored';entries:Entry[]};
export type MigrationStatus={backups:number;remaining:number;restorable:number;phase:'idle'|'backup'|'migrating'|'restoring';done:number;total:number};
export interface MigrationClient {pid?:number;resume(id:string,provider:string,model:string):Promise<void>;setArchived(id:string,archived:boolean):Promise<void>;close():Promise<void>}

/** Resume only: no turn or tool is started. */
export async function codexMigrationClient(home:string,binary?:string):Promise<MigrationClient>{
 const client=await codexRuntimeClient(home,binary);
 return {pid:client.pid,close:client.close,setArchived:async(id,archived)=>{await client.rpc(archived?'thread/archive':'thread/unarchive',{threadId:id});},resume:async(id,provider,model)=>{
  const result=await client.rpc('thread/resume',{threadId:id,modelProvider:provider,model});
  if(result.thread?.id!==id||result.thread?.modelProvider!==provider)throw fail('Codex 未确认新来源，迁移已停止，备份保留。');
  await client.rpc('thread/unsubscribe',{threadId:id}).catch(()=>{});
 }};
}

export class CodexThreadMigration {
 private home:string;private directory:string;
 private progress:Pick<MigrationStatus,'phase'|'done'|'total'>={phase:'idle',done:0,total:0};
 constructor(root:string,configPath:string,private processes:()=>Promise<number[]>,private clientFactory:(home:string)=>Promise<MigrationClient>=codexMigrationClient){this.home=dirname(configPath);this.directory=join(root,'codex-thread-backups');}
 private async database(){
  await safePath(this.home);let files:string[];try{files=await readdir(this.home);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return;throw error;}
  const name=files.filter(name=>/^state_\d+\.sqlite$/.test(name)).sort((a,b)=>Number(b.match(/\d+/)![0])-Number(a.match(/\d+/)![0]))[0];
  if(name){const path=join(this.home,name);await safePath(path);return path;}
 }
 private async rows():Promise<Route[]>{
  const path=await this.database();if(!path)return [];
  const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(path,{readOnly:true});
  try{return db.prepare("SELECT id,model_provider AS provider,model,rollout_path AS rollout,archived,source FROM threads").all().map(row=>({id:String(row.id),provider:String(row.provider),model:String(row.model??''),rollout:String(row.rollout??''),archived:!!row.archived,source:String(row.source)}));}finally{db.close();}
 }
 private async journals():Promise<Journal[]>{
  await safePath(this.directory);let files:string[];try{files=await readdir(this.directory);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}
  const result:Journal[]=[];for(const id of files.filter(id=>/^[a-f0-9-]{36}$/.test(id))){const path=join(this.directory,id,'manifest.json');await safePath(path);try{const value=JSON.parse(await readFile(path,'utf8'));if(value.version!==1||value.id!==id||!Array.isArray(value.entries))throw fail('旧对话备份索引损坏，请保留备份后联系维修。');result.push(value);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}}
  return result.sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
 }
 private async save(journal:Journal){const path=join(this.directory,journal.id,'manifest.json');await safePath(path);const temp=path+'.tmp';await writeFile(temp,JSON.stringify(journal),{mode:0o600});await rename(temp,path);}
 private async idle(ownPid?:number){if((await this.processes()).some(pid=>pid!==ownPid))throw fail('请先保存工作并完全退出 Codex，再继续迁移旧对话。备份和现有记录会保留。','codex_exit_required');}
 async status():Promise<MigrationStatus>{const journals=await this.journals();return {...this.progress,backups:journals.length,remaining:journals.flatMap(j=>j.entries).filter(e=>e.state==='pending').length,restorable:journals.flatMap(j=>j.entries).filter(active).length};}
 /** Complete a consistent local backup before the caller writes gateway config. */
 async prepare(model:string,allowedModels:string[]=[model]){
  const journals=await this.journals(),owned=new Set(journals.flatMap(j=>j.entries.filter(active).map(e=>e.id)));
  const current=await this.rows();
  const rows=current.filter(row=>(row.provider==='openai'&&!row.archived||row.provider==='token_flow')&&['vscode','cli'].includes(row.source)&&!!row.model&&!owned.has(row.id));
  if(!rows.length&&!journals.some(j=>j.entries.some(active)))return;
  await this.idle();
  for(const journal of journals){
   let changed=false;
   for(const entry of journal.entries){const row=current.find(row=>row.id===entry.id);if(active(entry)&&row?.provider==='token_flow'&&!allowedModels.includes(row.model)){entry.state='pending';entry.nextModel=model;changed=true;}}
   if(changed){journal.state='prepared';await this.save(journal);}
  }
  if(rows.length)await this.backup(rows,model,false);
 }
 /** Also retain conversations created while the gateway was active. */
 async prepareOfficial(model:string){
  const owned=new Set((await this.journals()).flatMap(j=>j.entries.filter(active).map(e=>e.id)));
  const rows=(await this.rows()).filter(row=>row.provider==='token_flow'&&['vscode','cli'].includes(row.source)&&!!row.model&&!owned.has(row.id));
  if(!rows.length)return;
  if(!model||model.includes('/'))throw fail('请先选择一个官方 Codex 模型，再还原这些对话。');
  await this.idle();await this.backup(rows,model,true);
 }
 private async backup(rows:Route[],model:string,official:boolean){
  // Check runtime availability before creating a backup or changing configuration.
  if(this.clientFactory===codexMigrationClient)await migrationBinary();
  // Empty drafts have no saved model or completed turn; leave them untouched.
  this.progress={phase:'backup',done:0,total:rows.length};
  const journal:Journal={version:1,id:randomUUID(),createdAt:new Date().toISOString(),state:'prepared',entries:rows.map(row=>({...row,provider:official?'openai':row.provider,model:official?model:row.model,nextModel:official?row.model:model,state:official?'migrated':'pending'}))};
  const directory=join(this.directory,journal.id);await mkdir(directory,{recursive:true,mode:0o700});
  try{
   const {DatabaseSync,backup}=await import('node:sqlite');
   const files=(await readdir(this.home)).filter(name=>/^(?:state|thread_history)_\d+\.sqlite$/.test(name));
   for(const name of files){await this.idle();const path=join(this.home,name);await safePath(path);const db=new DatabaseSync(path,{readOnly:true});try{await backup(db,join(directory,name));await chmod(join(directory,name),0o600);}finally{db.close();}}
   const config=join(this.home,'config.toml');await safePath(config);try{await copyFile(config,join(directory,'config.toml'));await chmod(join(directory,'config.toml'),0o600);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
   for(let i=0;i<rows.length;i++){const row=rows[i]!;if(row.rollout){if(!isAbsolute(row.rollout))throw fail('旧对话记录路径异常，未迁移。');await safePath(row.rollout);await copyFile(row.rollout,join(directory,`${i}.jsonl`),constants.COPYFILE_FICLONE);await chmod(join(directory,`${i}.jsonl`),0o600);}}
   await this.idle();await this.save(journal);
  }finally{this.progress={phase:'idle',done:0,total:0};}
 }
 async migrate(model:string,allowedModels:string[]=[model]){return this.execute(false,model,allowedModels);}
 async restore(model?:string|(()=>Promise<string|undefined>)){
  const entries=(await this.journals()).flatMap(j=>j.entries.filter(active)),rows=await this.rows();
  const hasThreads=rows.some(row=>entries.some(entry=>entry.id===row.id)||row.provider==='token_flow'&&!!row.model&&['vscode','cli'].includes(row.source));
  if(!entries.length&&!hasThreads)return {migrated:0};
  const selected=hasThreads?(typeof model==='function'?await model():model):undefined;
  await this.prepareOfficial(selected??'');return this.execute(true,selected);
 }
 private async execute(restore:boolean,model?:string,allowedModels:string[]=[]){
  const journals=await this.journals(),entries=journals.flatMap(j=>j.entries.filter(active));
  if(!entries.length)return {migrated:0};await this.idle();
  if(!await this.database())throw fail('找不到旧对话数据库，备份已保留，请检查 Codex 数据目录后重试。');
  this.progress={phase:restore?'restoring':'migrating',done:0,total:entries.length};let client:MigrationClient|undefined;
  try{
   const getClient=async()=>client??=await this.clientFactory(this.home);
   for(const journal of journals){for(const entry of journal.entries){if(!entries.includes(entry))continue;await this.idle(client?.pid);
    let row=(await this.rows()).find(row=>row.id===entry.id);
    // Finish an interrupted archive round-trip before deciding whether routing is done.
    if(row&&entry.rearchive){if(!row.archived)await (await getClient()).setArchived(entry.id,true);entry.rearchive=false;await this.save(journal);row=(await this.rows()).find(row=>row.id===entry.id);}
    if(!row){entry.state='deleted';await this.save(journal);continue;}
    if(!['vscode','cli'].includes(row.source))throw fail('旧对话来源已被其他程序修改，未覆盖；请检查后重试。');
    if(!restore&&row.provider==='token_flow'&&allowedModels.includes(row.model)){entry.state='migrated';entry.nextModel=row.model;await this.save(journal);continue;}
    if(restore&&model){entry.returnModel=model;await this.save(journal);}
    const restoredModel=entry.returnModel??(entry.provider==='token_flow'?'':entry.model),restoredProvider=entry.provider==='token_flow'?'openai':entry.provider;
    if(restore&&!restoredModel)throw fail('请先选择一个官方 Codex 模型，再还原这些对话。');
    if(restore&&row.provider===restoredProvider&&row.model===restoredModel){entry.state='restored';await this.save(journal);continue;}
    if(!(restore&&row.provider===restoredProvider)&&row.provider!==(restore?'token_flow':entry.provider)&&row.provider!=='token_flow')throw fail('旧对话来源已被其他程序修改，未覆盖；请检查后重试。');
    if(!restore){entry.nextModel=model!;await this.save(journal);}
    // Codex refuses to resume archived threads. Keep the archive intent durable
    // so a crash between unarchive and archive is recoverable on the next attempt.
    const runtime=await getClient();await this.idle(runtime.pid);
    if(row.archived){entry.rearchive=true;await this.save(journal);}
    try{
     if(row.archived)await runtime.setArchived(entry.id,false);
     await runtime.resume(entry.id,restore?restoredProvider:'token_flow',restore?restoredModel:entry.nextModel);
    }finally{
     if(entry.rearchive){await runtime.setArchived(entry.id,true);entry.rearchive=false;await this.save(journal);}
    }
    const persisted=(await this.rows()).find(row=>row.id===entry.id);
    if(persisted?.provider!==(restore?restoredProvider:'token_flow')||persisted?.model!==(restore?restoredModel:entry.nextModel)||persisted?.archived!==row.archived)throw fail('旧对话来源未持久保存，迁移已停止，备份保留。');
    entry.state=restore?'restored':'migrated';await this.save(journal);this.progress.done++;
   }journal.state=journal.entries.every(e=>!active(e))?'restored':journal.entries.every(e=>!active(e)||e.state==='migrated')?'migrated':'prepared';await this.save(journal);}
   return {migrated:this.progress.done};
  }finally{await client?.close();this.progress={phase:'idle',done:0,total:0};}
 }
}
