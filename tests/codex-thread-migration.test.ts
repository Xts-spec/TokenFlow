import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {CodexThreadMigration,type MigrationClient} from '../packages/core/src/codex-thread-migration.js';
async function fixture(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'thread-migration-')),home=join(root,'codex');await mkdir(home);
 await writeFile(join(home,'config.toml'),'model="native"');
 const db=new DatabaseSync(join(home,'state_5.sqlite'));db.exec('create table threads(id text,model_provider text,model text,rollout_path text,source text,archived integer)');
 for(const [id,provider,source,archived] of [['old','openai','vscode',0],['cli','openai','cli',0],['custom','other','vscode',0],['archived','openai','vscode',1],['test','openai','exec',0],['subagent','openai','{"subagent":1}',0],['draft','openai','vscode',0]] as const){const path=join(home,`${id}.jsonl`);await writeFile(path,`{"history":"${id}"}\n`);db.prepare('insert into threads values (?,?,?,?,?,?)').run(id,provider,id==='draft'?null:'native',path,source,archived);}
 let running=false,failOn='',archiveFailure=false,calls=0;
 const client=async():Promise<MigrationClient>=>({pid:100,setArchived:async(id,archived)=>{if(archived&&archiveFailure)throw Error('archive fixture failure');db.prepare('update threads set archived=? where id=?').run(Number(archived),id);},close:async()=>{},resume:async(id,provider,model)=>{calls++;if(id===failOn)throw Error('fixture failure');db.prepare('update threads set model_provider=?,model=? where id=?').run(provider,model,id);}});
 const migration=new CodexThreadMigration(root,join(home,'config.toml'),async()=>running?[99]:[],client);
 return {root,home,db,migration,reopen:()=>new CodexThreadMigration(root,join(home,'config.toml'),async()=>running?[99]:[],client),setArchiveFailure:(v:boolean)=>archiveFailure=v,setRunning:(v:boolean)=>running=v,setFailure:(v:string)=>failOn=v,calls:()=>calls,close:async()=>{db.close();await rm(root,{recursive:true,force:true});}};
}
describe('Codex old thread migration',()=>{
 it('requires exit before backup or configuration writes',async()=>{const f=await fixture();try{f.setRunning(true);await expect(f.migration.prepare('gateway')).rejects.toMatchObject({code:'codex_exit_required'});expect(f.calls()).toBe(0);expect((await f.migration.status()).backups).toBe(0);}finally{await f.close();}});
 it('backs up routes and history, migrates only local official threads, restores without losing later turns',async()=>{const f=await fixture();try{
  await f.migration.prepare('gateway');const dirs=await readdir(join(f.root,'codex-thread-backups'));const saved=new DatabaseSync(join(f.root,'codex-thread-backups',dirs[0]!,'state_5.sqlite'),{readOnly:true});expect(saved.prepare('select model_provider from threads where id=?').get('old')?.model_provider).toBe('openai');saved.close();
  expect((await f.migration.migrate('gateway')).migrated).toBe(2);expect(f.calls()).toBe(2);expect(f.db.prepare('select model_provider from threads where id=?').get('custom')?.model_provider).toBe('other');
  await writeFile(join(f.home,'old.jsonl'),'original history plus a new message');await f.migration.prepare('next');expect((await f.migration.status()).backups).toBe(1);
  await f.migration.restore();expect(await readFile(join(f.home,'old.jsonl'),'utf8')).toBe('original history plus a new message');expect(f.db.prepare('select model_provider,model from threads where id=?').get('old')).toMatchObject({model_provider:'openai',model:'native'});expect((await f.migration.status()).restorable).toBe(0);
 }finally{await f.close();}});
 it('resumes a partial migration after a service restart and refuses external provider changes',async()=>{const f=await fixture();try{await f.migration.prepare('gateway');f.setFailure('cli');await expect(f.migration.migrate('gateway')).rejects.toThrow('fixture failure');expect((await f.migration.status()).remaining).toBe(1);f.setFailure('');await f.migration.migrate('gateway');expect((await f.migration.status()).remaining).toBe(0);f.db.prepare("update threads set model_provider='external' where id='old'").run();await expect(f.migration.restore()).rejects.toThrow('其他程序');expect((await f.migration.status()).restorable).toBe(2);}finally{await f.close();}});
 it('backs up gateway-born threads and restores them to an official model without discarding history',async()=>{const f=await fixture();try{
  const path=join(f.home,'gateway.jsonl');await writeFile(path,'gateway history and tools');
  f.db.prepare('insert into threads values (?,?,?,?,?,?)').run('gateway','token_flow','qoder/Kimi-K3',path,'vscode',0);
  f.setRunning(true);await expect(f.migration.restore('gpt-6-luna')).rejects.toMatchObject({code:'codex_exit_required'});
  f.setRunning(false);await f.migration.restore('gpt-6-luna');
  expect(f.db.prepare('select model_provider,model from threads where id=?').get('gateway')).toMatchObject({model_provider:'openai',model:'gpt-6-luna'});
  expect(await readFile(path,'utf8')).toBe('gateway history and tools');expect((await f.migration.status()).backups).toBe(1);
  await f.migration.restore('gpt-6-luna');expect(f.calls()).toBe(1);
 }finally{await f.close();}});
 it('keeps backups if Codex is opened during migration',async()=>{const f=await fixture();try{await f.migration.prepare('gateway');f.setRunning(true);await expect(f.migration.migrate('gateway')).rejects.toMatchObject({code:'codex_exit_required'});expect((await f.migration.status()).remaining).toBe(2);expect(f.calls()).toBe(0);}finally{await f.close();}});
});

it('restores archived threads without unarchiving and skips deleted records',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("update threads set archived=1 where id='old'").run();
 f.db.prepare("delete from threads where id='cli'").run();
 await f.migration.restore();
 expect(f.db.prepare("select model_provider,model,archived from threads where id='old'").get()).toMatchObject({model_provider:'openai',model:'native',archived:1});
 expect(f.db.prepare("select id from threads where id='cli'").get()).toBeUndefined();
 expect((await f.migration.status()).restorable).toBe(0);
}finally{await f.close();}});
it('replaces removed gateway models and retains still-authorized thread selections',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("update threads set model='retained' where id='cli'").run();
 await f.migration.prepare('replacement');await f.migration.migrate('replacement',['replacement','retained']);
 expect(f.db.prepare("select model from threads where id='old'").get()?.model).toBe('replacement');
 expect(f.db.prepare("select model from threads where id='cli'").get()?.model).toBe('retained');
 await f.migration.restore();
 expect(f.db.prepare("select model from threads where id='old'").get()?.model).toBe('native');
}finally{await f.close();}});

it('continues restoring surviving threads after a deleted record and keeps the deletion across retries',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("delete from threads where id='old'").run();
 await f.migration.restore();await f.reopen().restore();
 expect(f.db.prepare("select model_provider from threads where id='cli'").get()?.model_provider).toBe('openai');
 expect(f.db.prepare("select id from threads where id='old'").get()).toBeUndefined();
 expect((await f.migration.status()).restorable).toBe(0);
}finally{await f.close();}});
it('preserves the archive state on resume failure and completes an interrupted rearchive after restart',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("update threads set archived=1 where id='old'").run();f.setFailure('old');
 await expect(f.migration.restore()).rejects.toThrow('fixture failure');
 expect(f.db.prepare("select archived from threads where id='old'").get()?.archived).toBe(1);
 f.setFailure('');f.setArchiveFailure(true);
 await expect(f.migration.restore()).rejects.toThrow('archive fixture failure');
 expect(f.db.prepare("select model_provider,archived from threads where id='old'").get()).toMatchObject({model_provider:'openai',archived:0});
 f.setArchiveFailure(false);await f.reopen().restore();
 expect(f.db.prepare("select model_provider,archived from threads where id='old'").get()).toMatchObject({model_provider:'openai',archived:1});
 expect((await f.migration.status()).restorable).toBe(0);
}finally{await f.close();}});
it('reconciles gateway-born threads too and resumes a partially failed model replacement',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 const path=join(f.home,'born.jsonl');await writeFile(path,'saved gateway history');
 f.db.prepare('insert into threads values (?,?,?,?,?,?)').run('born','token_flow','removed',path,'vscode',1);
 f.setRunning(true);await expect(f.migration.prepare('replacement')).rejects.toMatchObject({code:'codex_exit_required'});f.setRunning(false);
 await f.migration.prepare('replacement');expect((await f.migration.status()).remaining).toBe(3);
 f.setFailure('cli');await expect(f.migration.migrate('replacement')).rejects.toThrow('fixture failure');
 f.setFailure('');await f.reopen().migrate('replacement');
 expect(f.db.prepare("select model,archived from threads where id='born'").get()).toMatchObject({model:'replacement',archived:1});
 await f.reopen().restore('official-default');
 expect(f.db.prepare("select model_provider,model,archived from threads where id='born'").get()).toMatchObject({model_provider:'openai',model:'official-default',archived:1});
 expect(await readFile(path,'utf8')).toBe('saved gateway history');
}finally{await f.close();}});
it('does not confuse changed thread sources or a missing database with deletion',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("update threads set source='exec' where id='old'").run();
 await expect(f.migration.restore()).rejects.toThrow('其他程序');
 expect((await f.migration.status()).restorable).toBe(2);
 await rm(join(f.home,'state_5.sqlite'));
 await expect(f.migration.restore()).rejects.toThrow('数据库');
 expect((await f.migration.status()).restorable).toBe(2);
}finally{await f.close();}});

it('finishes deleted-only journals without requiring a runtime or a default model',async()=>{const f=await fixture();try{
 await f.migration.prepare('gateway');await f.migration.migrate('gateway');
 f.db.prepare("delete from threads where id in ('old','cli')").run();
 const restarted=new CodexThreadMigration(f.root,join(f.home,'config.toml'),async()=>[],async()=>{throw Error('runtime should not start');});
 await restarted.restore(async()=>{throw Error('default should not be resolved');});
 expect((await restarted.status()).restorable).toBe(0);
}finally{await f.close();}});
