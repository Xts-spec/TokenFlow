import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,readdir,readFile,writeFile,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GatewayContext,type ContextMigration} from '../packages/core/src/gateway-context.js';
import {codexContextScope,portableCodexItem} from '../packages/core/src/codex-context.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const work=(tag:string)=>Array.from({length:20},(_,i)=>[{type:'function_call',call_id:tag+i,name:'read',arguments:'{}'},{type:'function_call_output',call_id:tag+i,output:(tag+' completed work ').repeat(1200)}]).flat();
async function setup(){
 const root=await mkdtemp(join(tmpdir(),'migration-bootstrap-'));roots.push(root);const context=await GatewayContext.open(root),requests:Record<string,any>[]=[];
 const migration:ContextMigration={scope:codexContextScope,threadId:'thread',normalize:portableCodexItem,recover:async()=>{throw Error('Unexpected foreign history');}};
 const send=async(_route:string,body:Record<string,any>)=>{requests.push(body);const summary=body.instructions?.startsWith('Summarize the supplied');return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:summary?'A and B completed. Preserve decisions and continue C.':'Normal answer'}]}],usage:{input_tokens:summary?500000:100,output_tokens:summary?1000:10}});};
 return {root,context,migration,requests,send,summaries:()=>requests.filter(body=>body.instructions?.startsWith('Summarize the supplied'))};
}
it('leaves a gateway-born chat to Codex even when its first payload already contains large tool history',async()=>{
 const f=await setup(),input=[{role:'developer',content:'RULE '.repeat(60000)},{role:'user',content:'New task'},...work('fresh')];
 const response=await(await f.context.response('responses',{model:'qoder/m',input,store:false},'key','source',f.send,f.migration)).json();
 expect(f.summaries()).toHaveLength(0);expect(response.output.some((item:any)=>item.type==='compaction')).toBe(false);expect(f.requests.at(-1)!.input).toEqual(input.map(portableCodexItem).flat());
});
it('ignores fixed instructions and the latest user request when deciding whether migrated old history needs organizing',async()=>{
 const f=await setup(),input=[{role:'developer',content:'RULE '.repeat(60000)},{role:'user',content:'Old task'},{role:'assistant',content:'Done'},{role:'user',content:'Current large request '+ 'text '.repeat(60000)}];
 const result=await(await f.context.response('responses',{model:'qoder/m',input,store:false},'key','source',f.send,{...f.migration,bootstrapHistory:'official-history-A'})).json();
 expect(f.summaries()).toHaveLength(0);expect(result.output.some((item:any)=>item.type==='compaction')).toBe(false);
});
it('does not bootstrap again for a new connection key and does bootstrap new official history with the same key',async()=>{
 const f=await setup();const first=[{role:'user',content:'A'},...work('A'),{role:'user',content:'Continue B'}];
 const a=await(await f.context.response('responses',{model:'qoder/m',input:first,store:false},'key','source',f.send,{...f.migration,bootstrapHistory:'history-A'})).json();
 const count=f.summaries().length;expect(count).toBeGreaterThan(0);
 const b=[...a.output,...work('B'),{role:'user',content:'Continue C'}];
 await f.context.response('responses',{model:'qoder/m',input:b,store:false},'rotated-key','source',f.send,{...f.migration,bootstrapHistory:'history-A'});
 expect(f.summaries()).toHaveLength(count);
 const c=await(await f.context.response('responses',{model:'qoder/m',input:b,store:false},'rotated-key','source',f.send,{...f.migration,bootstrapHistory:'history-AB'})).json();
 expect(f.summaries().length).toBeGreaterThan(count);const after=f.summaries().length;
 await(await GatewayContext.open(f.root)).response('responses',{model:'workbuddy/m',input:b,store:false},'another-key','another-source',f.send,{...f.migration,bootstrapHistory:'history-AB'});
 expect(f.summaries()).toHaveLength(after);expect(JSON.stringify(f.requests.at(-1)!.input)).toContain('A and B completed');expect(c.output[0].type).toBe('compaction');
});
it('returns only continuation usage to Codex while retaining all paid summary usage for accounting',async()=>{
 const f=await setup();let billed:unknown;
 const response=await(await f.context.response('responses',{model:'qoder/m',input:[{role:'user',content:'A'},...work('A'),{role:'user',content:'Continue'}],store:false},'key','source',f.send,{...f.migration,bootstrapHistory:'history-A'},{onBillingUsage:(value:unknown)=>{billed=value;}})).json();
 expect(f.summaries().length).toBeGreaterThan(0);expect(response.usage).toMatchObject({input_tokens:100,output_tokens:10});
 expect(billed).toMatchObject({input_tokens:f.summaries().length*500000+100,output_tokens:f.summaries().length*1000+10});
});
it('reuses only the matching historical prefix when the same conversation revisits an earlier branch',async()=>{
 const f=await setup();const original=[{role:'user',content:'A_GOAL'},...work('A'),{role:'user',content:'Continue'}];
 const send=async(_route:string,body:Record<string,any>)=>{
  const compact=body.instructions?.startsWith('Summarize the supplied');const text=compact?(JSON.stringify(body.input).includes('B_BRANCH')?'SUMMARY_AB':'SUMMARY_A'):'Answer';
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:2}});
 };
 const first=await(await f.context.response('responses',{model:'qoder/m',input:original,store:false},'key','source',send,{...f.migration,bootstrapHistory:'A'})).json();
 await f.context.response('responses',{model:'qoder/m',input:[...first.output,{role:'user',content:'B_BRANCH'},...work('B'),{type:'compaction_trigger'}],store:false},'key','source',send,f.migration);
 let restored='';
 await f.context.response('responses',{model:'workbuddy/m',input:[...original,{role:'user',content:'C_BRANCH'}],store:false},'rotated-key','new-source',async(path,body)=>{restored=JSON.stringify(body.input);return send(path,body);},{...f.migration,bootstrapHistory:'A'});
 expect(restored).toContain('SUMMARY_A');expect(restored).toContain('C_BRANCH');expect(restored).not.toContain('SUMMARY_AB');expect(restored).not.toContain('B_BRANCH');
});
it.each([false,true])('migrates old connection-based session metadata without reprocessing prior imports (new import=%s)',async newer=>{
 const f=await setup();await f.context.response('responses',{model:'qoder/m',input:'Hello',store:false},'old-key','source',f.send,f.migration);
 const directory=join(f.root,'gateway-context'),file=(await readdir(directory)).find(name=>/^managed-[a-f0-9]+$/.test(name))!;
 const state=f.context.decodeCheckpoint(await readFile(join(directory,file),'utf8'),[codexContextScope]);state[0]!.format='managed-session-v1';
 await writeFile(join(directory,file),f.context.encodeCheckpoint(state,codexContextScope));await utimes(join(directory,file),new Date(2000),new Date(2000));
 await(await GatewayContext.open(f.root)).response('responses',{model:'qoder/m',input:[{role:'user',content:'A'},...work('A'),{role:'user',content:'Continue'}],store:false},'new-key','source',f.send,{...f.migration,bootstrapHistory:'official-history',bootstrapRecordedAt:newer?3000:1000});
 expect(f.summaries().length>0).toBe(newer);
});
