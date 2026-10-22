import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,readdir,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext,type ContextMigration} from '../packages/core/src/gateway-context.js';
import {codexContextScope,portableCodexItem} from '../packages/core/src/codex-context.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const work=(tag:string)=>Array.from({length:20},(_,i)=>[
 {type:'function_call',call_id:tag+i,name:'read',arguments:'{}'},
 {type:'function_call_output',call_id:tag+i,output:(tag+' old tool result ').repeat(600)},
]).flat();
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'managed-continuation-'));roots.push(root);
 const requests:any[]=[];let summaries=0;
 const send=async(_path:string,body:any)=>{requests.push(body);const summary=body.instructions?.startsWith('Summarize the supplied');return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:summary?`SAVED_SUMMARY_${++summaries}: retain task constraints and test results.`:'Answer'}]}],usage:{input_tokens:100,output_tokens:10}});};
 const migration:ContextMigration={bootstrapOnFirstRequest:true,threadId:'thread-a',connectionId:'gateway-a',scope:codexContextScope,normalize:portableCodexItem,recover:async()=>{throw Error('Unexpected recovery');}};
 return {root,requests,send,migration,summaries:()=>summaries,context:await GatewayContext.open(root)};
}
it('bootstraps only the current first request and waits for Codex after restart',async()=>{
 const f=await setup();const original=[{role:'user',content:'Finish the task.'},...work('initial'),{role:'user',content:'Continue.'}];
 const first=await(await f.context.response('responses',{model:'qoder/m',input:original,store:false},'key','source',f.send,f.migration)).json();
 expect(f.summaries()).toBeGreaterThan(0);const count=f.summaries();
 const resumed=await GatewayContext.open(f.root),input=[...first.output,...work('recent'),{role:'user',content:'Keep working.'}];
 await resumed.response('responses',{model:'qoder/m',input,store:false},'key','source',f.send,f.migration);
 expect(f.summaries()).toBe(count);expect(JSON.stringify(f.requests.at(-1).input)).toContain('recent19');
 await resumed.response('responses',{model:'qoder/m',input:[...input,{type:'compaction_trigger'}],store:false},'key','source',f.send,f.migration);
 expect(f.summaries()).toBeGreaterThan(count);
 const newestSummary=f.requests.filter(body=>body.instructions?.startsWith('Summarize the supplied')).at(-1);
 expect(JSON.stringify(newestSummary.input)).not.toContain('SAVED_SUMMARY_1');
 expect(JSON.stringify(newestSummary.input)).toContain('recent');
});
it('does not begin gateway compaction when a short new chat grows during ordinary tool turns',async()=>{
 const f=await setup();const first=[{role:'user',content:'New task.'}];
 await f.context.response('responses',{model:'qoder/m',input:first,store:false},'key','source',f.send,f.migration);
 await (await GatewayContext.open(f.root)).response('responses',{model:'qoder/m',input:[...first,...work('later')],store:false},'key','source',f.send,f.migration);
 expect(f.summaries()).toBe(0);
});
it('reuses durable per-thread summary prefixes across models and summarizes only work added on the official route',async()=>{
 const f=await setup();const instructions={role:'developer',content:'Current project rules.'};
 const original=[instructions,{role:'user',content:'ORIGINAL_REQUIREMENT'},...work('initial'),{role:'user',content:'Continue.'}];
 await f.context.response('responses',{model:'qoder/m',input:original,store:false},'key','source',f.send,f.migration);
 const count=f.summaries();
 // Long-lived conversation summaries outlive the transient per-call cache.
 for(const file of await readdir(join(f.root,'gateway-context')))if(file.startsWith('managed-'))await utimes(join(f.root,'gateway-context',file),new Date(0),new Date(0));
 const again=await GatewayContext.open(f.root);
 await again.response('responses',{model:'workbuddy/m',input:original,store:false},'new-key','new-source',f.send,{...f.migration,connectionId:'gateway-b'});
 expect(f.summaries()).toBe(count);expect(JSON.stringify(f.requests.at(-1).input)).toContain('SAVED_SUMMARY_1');expect(JSON.stringify(f.requests.at(-1).input)).not.toContain('initial0');
 const added=[{role:'user',content:'OFFICIAL_NEW_WORK'},...work('official'),{role:'user',content:'Resume from official.'}];
 const result=await(await again.response('responses',{model:'workbuddy/m',input:[...original,...added],store:false},'new-key','new-source',f.send,{...f.migration,connectionId:'gateway-c'})).json();
 expect(f.summaries()).toBeGreaterThan(count);
 const recentSummary=f.requests.filter(body=>body.instructions?.startsWith('Summarize the supplied')).slice(count).map(body=>body.input);
 expect(JSON.stringify(recentSummary)).toContain('OFFICIAL_NEW_WORK');expect(JSON.stringify(recentSummary)).not.toContain('initial0');expect(JSON.stringify(recentSummary)).not.toContain('SAVED_SUMMARY_1');
 const restored=again.decodeCheckpoint(result.output[0].encrypted_content,[codexContextScope]);
 expect(JSON.stringify(restored)).toContain('SAVED_SUMMARY_1');expect(JSON.stringify(restored)).toContain('SAVED_SUMMARY_2');
 const after=f.summaries();
 await (await GatewayContext.open(f.root)).response('responses',{model:'cursor/m',input:[...original,...added],store:false},'third-key','third-source',f.send,{...f.migration,connectionId:'gateway-d'});
 expect(f.summaries()).toBe(after);expect(JSON.stringify(f.requests.at(-1).input)).toContain('SAVED_SUMMARY_2');
 // Identical text in another chat has its own continuity record.
 await again.response('responses',{model:'cursor/m',input:[instructions,{role:'user',content:'OTHER_THREAD_CONSTRAINT'},...original.slice(2)],store:false},'other-key','other-source',f.send,{...f.migration,threadId:'thread-b'});
 expect(f.summaries()).toBeGreaterThan(after);
});
it('reuses a newly created summary after the formal answer fails without another paid summary',async()=>{
 const f=await setup();const input=[{role:'user',content:'Task'},...work('initial'),{role:'user',content:'Continue.'}];
 await expect(f.context.response('responses',{model:'qoder/m',input,store:false},'key','source',(path,body)=>typeof body.instructions==='string'?f.send(path,body):Promise.resolve(Response.json({error:{message:'unavailable'}},{status:503})),f.migration)).rejects.toMatchObject({code:'compaction_continuation_failed'});
 const count=f.summaries();await(await GatewayContext.open(f.root)).response('responses',{model:'qoder/m',input,store:false},'key','source',f.send,f.migration);
 expect(f.summaries()).toBe(count);expect(JSON.stringify(f.requests.at(-1).input)).toContain('SAVED_SUMMARY_1');
});
it('keeps completed summary chunks across a later failure, cache cleanup and a gateway model change',async()=>{
 const f=await setup();const input=[{role:'user',content:'Long historical reference '+ 'history '.repeat(16000)},...Array.from({length:10},(_,i)=>({role:i%2?'assistant':'user',content:'Recent '+i}))];
 let attempts=0;
 await expect(f.context.response('responses/compact',{model:'qoder/m',input,store:false},'key','source',async(path,body)=>{
  if(++attempts===2)return Response.json({error:{message:'temporary failure'}},{status:503});return f.send(path,body);
 },f.migration)).rejects.toMatchObject({code:'compaction_upstream_failed'});
 const files=(await readdir(join(f.root,'gateway-context'))).filter(name=>name.startsWith('managed-summary-'));expect(files).toHaveLength(1);
 for(const file of files)await utimes(join(f.root,'gateway-context',file),new Date(0),new Date(0));
 let report:any;const restarted=await GatewayContext.open(f.root);
 await restarted.response('responses/compact',{model:'workbuddy/m',input,store:false},'new-key','new-source',f.send,{...f.migration,connectionId:'new-connection'},{onCompaction:value=>{report=value;}});
 expect(report.reused).toBeGreaterThanOrEqual(1);expect(report.failed).toBe(false);
});

it('keeps lazy bootstrap isolated to the requested conversation and preserves current instructions',async()=>{
 const f=await setup();const original=[{role:'developer',content:'CURRENT_RULE'},...work('waiting'),{role:'user',content:'CURRENT_REQUEST'}];
 const other={...f.migration,threadId:'thread-b'};
 // A different small conversation must not process the waiting large history.
 await f.context.response('responses',{model:'qoder/m',input:[{role:'user',content:'Small chat'}]},'key','source',f.send,other);
 expect(f.summaries()).toBe(0);
 await f.context.response('responses',{model:'qoder/m',input:original},'key','source',f.send,f.migration);
 const count=f.summaries();expect(count).toBeGreaterThan(0);
 expect(JSON.stringify(f.requests.at(-1).input)).toContain('CURRENT_RULE');expect(JSON.stringify(f.requests.at(-1).input)).toContain('CURRENT_REQUEST');
 await f.context.response('responses',{model:'qoder/m',input:original},'key','source',f.send,other);
 expect(f.summaries()).toBe(count); // B already started small: later growth is Codex's decision.
 expect(JSON.stringify(f.requests.at(-1).input)).toContain('waiting19');
});

it('retries a failed first summary immediately without marking the conversation initialized',async()=>{
 const f=await setup();const input=[{role:'user',content:'Task'},...work('initial'),{role:'user',content:'Continue'}];
 await expect(f.context.response('responses',{model:'qoder/m',input},'key','source',async()=>Response.json({error:{message:'temporary failure'}},{status:503}),f.migration)).rejects.toMatchObject({code:'compaction_upstream_failed'});
 await (await GatewayContext.open(f.root)).response('responses',{model:'qoder/m',input},'key','source',f.send,f.migration);
 expect(f.summaries()).toBeGreaterThan(0);expect(JSON.stringify(f.requests.at(-1).input)).toContain('SAVED_SUMMARY_1');
});
