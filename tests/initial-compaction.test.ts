import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialParts,initialParallel,smallerParts,compactionModelWindow,reuseInitialParts} from '../packages/core/src/initial-compaction.js';
import {GatewayContext,type ContextMigration,type CompactionReport} from '../packages/core/src/gateway-context.js';
import {compactionProgress} from '../packages/core/src/compaction-progress.js';
import {upstreamIdle,finishUpstream} from '../packages/core/src/upstream-idle.js';
const roots:string[]=[];afterEach(async()=>{vi.useRealTimers();await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function setup(){const root=await mkdtemp(join(tmpdir(),'initial-compaction-'));roots.push(root);return {root,context:await GatewayContext.open(root)};}
const answer=(text='SAVED_SUMMARY')=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:100,output_tokens:20,total_tokens:120}});
const migration:ContextMigration={bootstrapOnFirstRequest:true,contextWindowTokens:32768,threadId:'thread-a',connectionId:'connection-a',scope:{owner:'managed',source:'managed',model:'managed'},recover:async()=>{throw Error('unused');}};
const history=[{role:'user',content:'EARLIEST_REQUIREMENT'},...Array.from({length:30},(_,i)=>({role:'assistant',content:(`Historical batch ${i} start `+'数据🙂'.repeat(800)+' middle '+i+' '+ 'x'.repeat(5000))})),{role:'user',content:'LATEST_REQUIREMENT'}];
it('preserves every codepoint, increases recent detail and scales chunk size with declared capacity',()=>{
 const text='首🙂'+('abc中文\n'.repeat(100000))+'尾';const small=initialParts(text,16384),large=initialParts(text,131072);
 expect(small.map(part=>part.text).join('')).toBe(text);expect(large.map(part=>part.text).join('')).toBe(text);
 expect(large.length).toBeLessThan(small.length);expect(large[0].detail).toBe('overview');expect(large.at(-1)?.detail).toBe('working-detail');
 expect(Buffer.byteLength(large.at(-2)!.text)).toBeLessThan(Buffer.byteLength(large[0].text));
});
it('uses selected provider capacity and only trusts the local Codex catalog for codex routes',async()=>{
 const {root}=await setup();await writeFile(join(root,'models_cache.json'),JSON.stringify({models:[{slug:'gpt-6-luna',context_window:272000,max_context_window:872000}]}));
 expect(await compactionModelWindow('codex/gpt-6-luna',[],join(root,'config.toml'))).toBe(272000);
 expect(await compactionModelWindow('api-source/gpt-6-luna',[],join(root,'config.toml'))).toBeUndefined();
 expect(await compactionModelWindow('codex/gpt-6-luna',[{id:'codex/gpt-6-luna',contextWindow:16000}],join(root,'config.toml'))).toBe(16000);
});
it('returns results in chronological order despite parallel completion',async()=>{
 let active=0,peak=0;const result=await initialParallel([30,20,10,1],async n=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,n));active--;return n;});
 expect(result).toEqual([30,20,10,1]);expect(peak).toBe(4);
});
it('saves parallel completed chunks after a failure and reuses them across a gateway restart',async()=>{
 const {root,context}=await setup();let active=0,peak=0,failed=false;const completed=new Set<string>();let report:CompactionReport|undefined;
 await expect(context.response('responses',{model:'codex/test',input:history},'key','source',async(_path,body)=>{
  const text=JSON.stringify(body.input);peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,5));active--;
  if(!failed){failed=true;throw Error('network failure');}completed.add(text);return answer();
 },migration,{onCompaction:r=>{report=r;}})).rejects.toMatchObject({code:'compaction_transport_failed'});
 expect(peak).toBeGreaterThan(1);expect(completed.size).toBeGreaterThan(0);expect(report?.inputTokens).toBe(completed.size*100);
 const again=await GatewayContext.open(root);let newCalls=0;
 await again.response('responses',{model:'codex/test',input:history},'key','source',async(_path,body)=>{
  if(body.instructions){expect(completed.has(JSON.stringify(body.input))).toBe(false);newCalls++;}return answer();
 },migration,{onCompaction:r=>{report=r;}});
 expect(newCalls).toBeGreaterThan(0);expect(report?.reused).toBe(completed.size);expect(report?.failed).toBe(false);
});
it.each(['http','sse'])('subdivides real %s capacity errors without losing historical text',async format=>{
 const {context}=await setup();const accepted:string[]=[];let rejected=0;let forwarded='';
 await context.response('responses',{model:'codex/test',input:history},'key','source',async(_path,body)=>{
  if(!body.instructions){forwarded=JSON.stringify(body.input);return answer('Done');}const text=(body.input as any[])[0].content as string;
  if(Buffer.byteLength(text)>20000){rejected++;return format==='http'?Response.json({error:{code:'context_length_exceeded'}},{status:400}):new Response('data: '+JSON.stringify({type:'response.failed',response:{status:'failed',error:{code:'context_too_large'}}})+'\n\n',{headers:{'content-type':'text/event-stream'}});}
  accepted.push(text);return answer();
 },migration);
 expect(rejected).toBeGreaterThan(0);const text=accepted.join('')+forwarded;expect(text).toContain('EARLIEST_REQUIREMENT');expect(text).toContain('middle 0');expect(text).toContain('middle 29');
});
it('keeps later automatic growth untouched and explicit Codex compaction serial',async()=>{
 const {context}=await setup();let active=0,peak=0,summaries=0;
 const send=async(_path:string,body:Record<string,unknown>)=>{if(body.instructions){summaries++;peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;}return answer();};
 await context.response('responses',{model:'codex/test',input:[{role:'user',content:'New conversation'}]},'key','source',send,migration);
 await context.response('responses',{model:'codex/test',input:history},'key','source',send,migration);expect(summaries).toBe(0);
 await context.response('responses',{model:'codex/test',input:[...history,{type:'compaction_trigger'}]},'key','source',send,migration);expect(summaries).toBeGreaterThan(0);expect(peak).toBe(1);
});
it('keeps initial streaming alive and communicates a failed operation without pretending it completed',async()=>{
 vi.useFakeTimers();let reject!:(error:unknown)=>void;const task=new Promise<Response>((_r,j)=>{reject=j;});const response=compactionProgress(task);const reader=response.body!.getReader();
 expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: response.in_progress');
 await vi.advanceTimersByTimeAsync(15000);expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: response.in_progress');
 reject({code:'compaction_transport_failed',message:'Source disconnected',usage:{input_tokens:200,output_tokens:20}});
 const terminal=new TextDecoder().decode((await reader.read()).value);expect(terminal).toContain('response.failed');expect(terminal).toContain('200');expect(terminal).not.toContain('response.completed');expect((await reader.read()).done).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('pauses only the initial operation clock; independent workers still time out and inference gets its own deadline',async()=>{
 vi.useFakeTimers();const parent=upstreamIdle(100,200);parent.pause();const child=upstreamIdle(100,200);
 const childResult=finishUpstream(child.watch(new Response('finished')),child);await childResult.text();
 await vi.advanceTimersByTimeAsync(1000);expect(parent.signal.aborted).toBe(false);expect(child.signal.aborted).toBe(false);
 const stalled=upstreamIdle(100,200);await vi.advanceTimersByTimeAsync(101);expect(stalled.timeoutKind).toBe('idle');expect(parent.signal.aborted).toBe(false);
 parent.resume();await vi.advanceTimersByTimeAsync(101);expect(parent.timeoutKind).toBe('idle');expect(vi.getTimerCount()).toBe(0);
});

it('queues initial Cursor chunks for its single-generation SDK instead of failing cursor_busy',async()=>{
 const {context}=await setup();let active=0,peak=0;
 await context.response('responses',{model:'cursor/test',input:history},'key','source',async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;return answer();},migration);
 expect(peak).toBe(1);
});

it.each(['responses','responses/compact'])('uses the initial parallel plan when Codex itself requests %s compaction on first contact',async path=>{
 const {context}=await setup();let active=0,peak=0;const lifecycle:boolean[]=[];
 const input=path==='responses'?[...history,{type:'compaction_trigger'}]:history;
 await context.response(path,{model:'codex/test',input},'key','source',async()=>{peak=Math.max(peak,++active);await new Promise(r=>setTimeout(r,1));active--;return answer();},migration,{onInitialCompaction:value=>lifecycle.push(value)});
 expect(peak).toBeGreaterThan(1);expect(lifecycle).toEqual([true,false]);
});

it('summarizes a large completed final answer when Codex requests first-contact compaction before appending the next user turn',async()=>{
 const {context}=await setup();const original=[{role:'user',content:'Original requirement'},{role:'assistant',content:'begin '+ 'x'.repeat(1024*1024)+' MIDDLE_REQUIRED_FACT '+ 'y'.repeat(1024*1024)+' end'},{type:'compaction_trigger'}];let seen='';
 const compact=await(await context.response('responses',{model:'codex/test',input:original},'key','source',async(_path,body)=>{seen+=JSON.stringify(body.input);return answer('Summary retains MIDDLE_REQUIRED_FACT');},migration)).json();
 expect(seen).toContain('MIDDLE_REQUIRED_FACT');
 let forwarded='';await context.response('responses',{model:'codex/test',input:[...compact.output,{role:'user',content:'Continue'}]},'key','source',async(_path,body)=>{forwarded=JSON.stringify(body.input);return answer();},migration);
 expect(Buffer.byteLength(forwarded)).toBeLessThan(128*1024);expect(forwarded).toContain('MIDDLE_REQUIRED_FACT');expect(forwarded).toContain('Original requirement');
});

it('capacity fallback strictly reduces Unicode chunks without empty or repeated children',()=>{
 expect(smallerParts('🙂')).toEqual(['🙂']);const parts=smallerParts('首🙂尾');expect(parts.join('')).toBe('首🙂尾');expect(parts.every(part=>part.length>0&&Buffer.byteLength(part)<Buffer.byteLength('首🙂尾'))).toBe(true);
});

it('retains completed original groups after new messages extend an interrupted first compaction',async()=>{
 const {root,context}=await setup();const done=new Set<string>();let first=true;
 await expect(context.response('responses',{model:'codex/test',input:history},'key','source',async(_path,body)=>{
  const key=JSON.stringify(body.input);if(first){first=false;throw Error('interrupted');}done.add(key);return answer();
 },migration)).rejects.toMatchObject({code:'compaction_transport_failed'});
 expect(done.size).toBeGreaterThan(0);
 const extended=[...history,{role:'assistant',content:'Additional completed work. '.repeat(3000)},{role:'user',content:'NEW_REQUIREMENT'}];
 let reused=0;const again=await GatewayContext.open(root);await again.response('responses',{model:'codex/test',input:extended},'key','source',async(_path,body)=>{
  if(body.instructions)expect(done.has(JSON.stringify(body.input)),'completed original group must never be paid again').toBe(false);return answer();
 },migration,{onCompaction:r=>{reused=r.reused;}});
 expect(reused).toBeGreaterThanOrEqual(done.size);
});

it('freezes unchanged group text and age after appends and edits, including Unicode',()=>{
 const original='首🙂'+('older log\n'.repeat(2000))+('recent state\n'.repeat(1500))+'尾';
 const plan=initialParts(original,4096);const appended=original+'NEW_MESSAGES_🙂'.repeat(900);
 const extended=reuseInitialParts(appended,plan,32768);
 expect(extended.map(p=>p.text).join('')).toBe(appended);expect(extended.slice(0,plan.length)).toEqual(plan);expect(extended.at(-1)?.detail).toBe('working-detail');
 const changed=plan.map((part,index)=>index===2?{...part,text:part.text.replace('older','EDITED_LONGER_')}:part);
 const edited=changed.map(p=>p.text).join('')+'next group';const reused=reuseInitialParts(edited,plan,4096);
 expect(reused.map(p=>p.text).join('')).toBe(edited);
 for(const [index,part]of plan.entries())if(index!==2)expect(reused).toContainEqual(part);
});

it('retains original group boundaries when an interrupted conversation is shortened and then restored',async()=>{
 const {root,context}=await setup();const completed=new Set<string>();
 const initialSend=async(_path:string,body:Record<string,unknown>)=>{const text=JSON.stringify(body.input);if(text.includes('Recent history: retain detailed'))throw Error('interrupted');completed.add(text);return answer();};
 await expect(context.response('responses',{model:'codex/test',input:history},'key','source',initialSend,migration)).rejects.toMatchObject({code:'compaction_transport_failed'});
 const shortened=[...history.slice(0,22),{role:'user',content:'Temporarily edit this branch'}];
 await expect(context.response('responses',{model:'codex/test',input:shortened},'key','source',async()=>{throw Error('interrupted branch');},migration)).rejects.toMatchObject({code:'compaction_transport_failed'});
 const again=await GatewayContext.open(root);let report:CompactionReport|undefined;
 await again.response('responses',{model:'codex/test',input:history},'key','source',async(_path,body)=>{if(body.instructions)expect(completed.has(JSON.stringify(body.input))).toBe(false);return answer();},migration,{onCompaction:r=>{report=r;}});
 expect(report?.reused).toBeGreaterThanOrEqual(completed.size);
});
