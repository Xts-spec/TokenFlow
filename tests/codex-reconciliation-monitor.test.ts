import {afterEach,expect,it} from 'vitest';
import {mkdtemp,realpath,mkdir,writeFile,readFile,rm,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexReconciliationMonitor} from '../packages/core/src/codex-reconciliation-monitor.js';
import {CodexReconciliationRecorder} from '../packages/core/src/codex-reconciliation.js';
import {nativeIdentity} from '../packages/core/src/local-usage.js';
const dirs:string[]=[],monitors:CodexReconciliationMonitor[]=[];
async function fixture(){
 const dir=await mkdtemp(join(await realpath(tmpdir()),'tf-reconciliation-monitor-'));dirs.push(dir);
 const root=join(dir,'profile'),home=join(dir,'codex');await mkdir(root);await mkdir(join(home,'sessions'),{recursive:true});await mkdir(join(home,'archived_sessions'));
 const options={root,codexHome:home,allowOfficial:false,intervalMs:40},output=join(root,'reconciliation','codex');
 return {root,home,output,options};
}
async function json(path:string){try{return JSON.parse(await readFile(path,'utf8'));}catch{return null;}}
async function events(output:string){return (await readFile(join(output,'events.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));}
function monitor(options:ConstructorParameters<typeof CodexReconciliationMonitor>[0]){const m=new CodexReconciliationMonitor(options);monitors.push(m);return m;}
afterEach(async()=>{for(const m of monitors.splice(0))await m.close();for(const d of dirs.splice(0))await rm(d,{recursive:true,force:true});});
it('auto starts, resumes the same window and separates switched accounts without recounting archived copies',async()=>{
 const f=await fixture(),m=monitor(f.options);await m.start();await expect.poll(()=>m.snapshot().state,{timeout:5000}).toBe('recording');
 const start=await json(join(f.output,'monitor.json')),proofs:any[]=[];
 const add=async(account:string,response:string,input:number)=>{
  const timestamp=new Date().toISOString(),thread='thread-'+account;
  proofs.push({thread:nativeIdentity('thread',thread),time:Date.parse(timestamp),model:'gpt-test',input,read:0,write:0,output:5,account:nativeIdentity('codex',account),email:nativeIdentity('email',account+'@example.test')});
  await writeFile(join(f.root,'usage-account-evidence.json'),JSON.stringify({version:1,records:proofs}));
  await writeFile(join(f.home,'sessions',account+'.jsonl'),[
   {type:'session_meta',payload:{id:thread,source:'vscode',thread_source:'user',originator:'codex_work_desktop',model_provider:'openai',auth_mode:'chatgpt'}},
   {type:'turn_context',payload:{model:'gpt-test'}},
   {type:'token_usage_record',timestamp,payload:{thread_id:thread,response_id:response,usage:{input_tokens:input,cached_input_tokens:0,output_tokens:5,total_tokens:input+5}}},
  ].map(v=>JSON.stringify(v)).join('\n')+'\n');
 };
 await add('A','response-A',100);await expect.poll(async()=> (await json(join(f.output,'daily-accounts.json')))?.groups.length).toBe(1);
 await m.close();await expect(stat(join(f.output,'recorder.lock'))).rejects.toMatchObject({code:'ENOENT'});
 await add('B','response-B',200);await writeFile(join(f.home,'archived_sessions','duplicate.jsonl'),await readFile(join(f.home,'sessions','A.jsonl')));
 const reopened=monitor(f.options);await reopened.start();await expect.poll(async()=> (await json(join(f.output,'daily-accounts.json')))?.groups.length,{timeout:5000}).toBe(2);
 await reopened.close();const summary=await json(join(f.output,'daily-accounts.json'));
 expect(summary.since).toBe(start.since);expect(summary.groups.map((g:any)=>g.totalTokens).sort((a:number,b:number)=>a-b)).toEqual([105,205]);
 expect(new Set(summary.groups.map((g:any)=>g.account.accountHash)).size).toBe(2);expect(summary.groups.every((g:any)=>g.account.evidence==='otel')).toBe(true);
 const all=await events(f.output);expect(all.filter(e=>e.type==='usage')).toHaveLength(2);expect(all.filter(e=>e.type==='run-start')).toHaveLength(2);expect(all.filter(e=>e.type==='run-stop')).toHaveLength(2);expect(all.some(e=>e.type==='official-snapshot')).toBe(false);
 expect((await json(join(f.root,'codex-reconciliation-status.json'))).state).toBe('stopped');
},15000);
it('uses the persisted project output and automatically waits for the standalone writer to release it',async()=>{
 const f=await fixture(),output=join(f.root,'project-logs');await writeFile(join(f.root,'codex-reconciliation-settings.json'),JSON.stringify({version:1,output}));
 const original=await CodexReconciliationRecorder.open({output,codexHome:f.home,dataRoot:f.root});
 try{const m=monitor(f.options);await m.start();await expect.poll(()=>m.snapshot().state,{timeout:5000}).toBe('retrying');await original.close();await expect.poll(()=>m.snapshot().state,{timeout:5000}).toBe('recording');await m.close();expect((await json(join(output,'monitor.json'))).since).toBe(original.state.since);expect((await events(output)).filter(e=>e.type==='run-start')).toHaveLength(2);}finally{await original.close();}
});
it('honors explicit disable and handles close while startup is still pending',async()=>{
 const f=await fixture();await writeFile(join(f.root,'codex-reconciliation-settings.json'),JSON.stringify({version:1,enabled:false}));
 const m=monitor(f.options);await m.start();expect(m.snapshot().state).toBe('disabled');await expect(stat(f.output)).rejects.toMatchObject({code:'ENOENT'});
 const pending=monitor(f.options);const starting=pending.start();await pending.close();await starting;expect(pending.snapshot().state).toBe('stopped');
});
