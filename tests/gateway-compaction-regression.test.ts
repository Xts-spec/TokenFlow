import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm,readFile,readdir,writeFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function setup(){const root=await mkdtemp(join(tmpdir(),'compaction-regression-'));roots.push(root);return {root,context:await GatewayContext.open(root)};}
const history=[{role:'user',content:'Keep compatibility; work in /app.'},{role:'assistant',content:'old work '.repeat(2000)},...Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'Recent '+i}))];
const usage={input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:80},output_tokens_details:{reasoning_tokens:4}};
function stream(text:string){return new Response([
 {type:'response.output_text.delta',output_index:0,content_index:0,delta:text},
 {type:'response.completed',response:{status:'completed',output:[],usage}},
].map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});}
it('reads streamed summary text even when the terminal output array is empty',async()=>{
 const {context}=await setup();
 const result=await context.response('responses/compact',{model:'qoder/m',input:history},'a','s',async(_p,b)=>{expect(b.stream).toBe(true);return stream('Kept compatibility. Next: tests.');});
 expect((await result.json()).usage).toEqual(usage);
});
it('does not pay again for an identical successful summary after restart',async()=>{
 const {root,context}=await setup();let calls=0;
 const send=async()=>{calls++;return stream('Kept compatibility. Next: tests.');};
 await context.response('responses/compact',{model:'qoder/m',input:history},'a','s',send);
 const restarted=await GatewayContext.open(root);
 const repeat=await restarted.response('responses/compact',{model:'qoder/m',input:history},'a','s',send);
 expect(calls).toBe(1);expect((await repeat.json()).usage.input_tokens).toBe(0);
 const saved=(await readdir(join(root,'gateway-context'))).find(name=>name.startsWith('summary-'))!;
 expect(await readFile(join(root,'gateway-context',saved),'utf8')).not.toContain('Kept compatibility');
 await restarted.response('responses/compact',{model:'qoder/other',input:history},'a','s',send);expect(calls).toBe(2);
 await restarted.response('responses/compact',{model:'qoder/m',input:history},'a','other-source',send);expect(calls).toBe(3);
 await restarted.response('responses/compact',{model:'qoder/m',input:history},'other-owner','s',send);expect(calls).toBe(4);
});
it('returns non-retryable empty-summary errors and preserves usage details',async()=>{
 const {context}=await setup();let calls=0;
 const send=async()=>{calls++;return stream('');};
 await expect(context.response('responses/compact',{model:'qoder/m',input:history},'a','s',send)).rejects.toMatchObject({statusCode:422,code:'compaction_empty',usage});
 await expect(context.response('responses/compact',{model:'qoder/m',input:history},'a','s',send)).rejects.toMatchObject({statusCode:422,usage:{input_tokens:0,output_tokens:0}});
 expect(calls).toBe(1);
});
it('bounds an 11 MiB recovered tool transcript before sending summaries or inference',async()=>{
 const {context}=await setup();const old=[{role:'user',content:'Preserve API and report TASK_MARKER.'},...Array.from({length:100},(_,i)=>[
 {type:'function_call',call_id:'c'+i,name:'read',arguments:'{}'},
 {type:'function_call_output',call_id:'c'+i,output:i%2?'x'.repeat(115000):[{type:'input_text',text:'x'.repeat(115000)}]},
 ]).flat(),...history.slice(-8)];let calls=0;
 const result=await context.response('responses',{model:'qoder/m',input:[{type:'compaction',encrypted_content:'official-opaque'},{role:'user',content:'Continue TASK_MARKER.'}],store:false},'a','s',async(_p,b)=>{
  calls++;expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(128*1024);expect(calls).toBeLessThanOrEqual(12);
  return stream('TASK_MARKER: API kept compatible. Verify tests next.');
 },{scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>old});
 await result.text();expect(calls).toBeGreaterThan(1);
});
it('retains the current user constraint even after a large older user attachment and a long tool loop',async()=>{
 const {context}=await setup();const input:Record<string,unknown>[]=[{role:'user',content:'old attachment '.repeat(2000)},{role:'assistant',content:'Earlier task done.'},{role:'user',content:'Never change billing.ts.'}];
 for(let i=0;i<8;i++)input.push({type:'function_call',call_id:'c'+i,name:'read',arguments:'{}'},{type:'function_call_output',call_id:'c'+i,output:'result '.repeat(1000)});
 const compact=await (await context.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>stream('Earlier reads done. Current work pending.'))).json();
 let forwarded:unknown;
 await context.response('responses',{model:'qoder/m',input:compact.output,store:false},'a','s',async(_p,b)=>{forwarded=b.input;return Response.json({status:'completed',output:[],usage});});
 expect(forwarded).toContainEqual({role:'user',content:'Never change billing.ts.'});
});
it('preserves confirmed summary charges when inference fails or its transport disconnects',async()=>{
 const {context}=await setup();
 for(const failure of ['http','network']){
  await expect(context.response('responses',{model:'qoder/'+failure,input:history,context_management:[{type:'compaction',compact_threshold:100}]},'a','s',async(_p,b)=>{
   if(b.instructions)return stream('Kept compatibility. Next: tests.');
   if(failure==='network')throw Error('disconnect');
   return Response.json({error:{message:'bad request'}},{status:400});
  })).rejects.toMatchObject({code:'compaction_continuation_failed',usage,unmetered:failure==='network'});
 }
});
it('does not attach a healthy concurrent summary request to a disconnected owner',async()=>{
 const {context}=await setup();let fail!:(reason:Error)=>void;let started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;});let secondCalls=0;
 const first=context.response('responses/compact',{model:'qoder/m',input:history},'a','s',async()=>{started();return new Promise<Response>((_r,reject)=>{fail=reject;});}).catch(error=>error);
 await ready;
 const second=context.response('responses/compact',{model:'qoder/m',input:history},'a','s',async()=>{secondCalls++;return stream('Kept compatibility. Next: tests.');});
 const third=context.response('responses/compact',{model:'qoder/m',input:history},'a','s',async()=>{secondCalls++;return stream('Kept compatibility. Next: tests.');});
 // Let the second caller reach the pending-summary lookup.
 await new Promise(r=>setTimeout(r,10));fail(Error('client disconnected'));
 expect(await first).toMatchObject({code:'compaction_transport_failed'});expect((await second).ok).toBe(true);expect((await third).ok).toBe(true);expect(secondCalls).toBe(1);
});
it('keeps successful chunk usage and reuses the chunk after a later transport failure',async()=>{
 const {root,context}=await setup();const input:Record<string,unknown>[]=[{role:'user',content:'Preserve API.'}];
 for(let i=0;i<60;i++)input.push({type:'function_call',call_id:'c'+i,name:'read',arguments:'{}'},{type:'function_call_output',call_id:'c'+i,output:'result '.repeat(500)});
 input.push(...history.slice(-8));let calls=0;
 await expect(context.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>{if(++calls===2)throw Error('disconnect');return stream('Keep API. Reads done. Test next.');})).rejects.toMatchObject({usage,unmetered:true});
 let reused=0;const restarted=await GatewayContext.open(root);
 await restarted.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>stream('Keep API. Reads done. Test next.'),undefined,{onCompaction:r=>{reused=r.reused;}});
 expect(reused).toBeGreaterThan(0);
});
it('accepts a small final chunk whose summary grows when the complete checkpoint shrinks',async()=>{
 const {context}=await setup();let calls=0;
 const input=[{role:'user',content:'Historical attachment: '+'x'.repeat(48*1024+500)},...history.slice(-8)];
 const response=await context.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>stream(++calls===1?'Earlier attachment summarized.':'TAIL_CONSTRAINT: '+'Preserve the final historical constraint. '.repeat(30)));
 expect(calls).toBe(2);const compact=await response.json();let forwarded:unknown;
 await context.response('responses',{model:'qoder/m',input:compact.output,store:false},'a','s',async(_p,b)=>{forwarded=b.input;return Response.json({status:'completed',output:[],usage});});
 expect(JSON.stringify(forwarded)).toContain('TAIL_CONSTRAINT');expect(Buffer.byteLength(JSON.stringify(forwarded))).toBeLessThan(16*1024);
});
it('does not permanently reuse a checkpoint that failed the complete-round shrink check',async()=>{
 const {root,context}=await setup();let calls=0;
 await expect(context.response('responses/compact',{model:'qoder/m',input:history},'a','s',async()=>{calls++;return stream('Expanded rather than summarized. '.repeat(100));})).rejects.toMatchObject({code:'compaction_not_reduced'});
 const restarted=await GatewayContext.open(root);
 const response=await restarted.response('responses/compact',{model:'qoder/m',input:history},'a','s',async()=>{calls++;return stream('Constraints kept. Test next.');});
 expect(response.ok).toBe(true);expect(calls).toBe(2);
});
it('invalidates summaries that grow the final context after preserved messages are restored',async()=>{
 const {root,context}=await setup();let calls=0;
 const input=[{role:'user',content:'x'.repeat(8000)},{role:'assistant',content:'y'.repeat(300)},...Array.from({length:8},()=>({role:'assistant',content:'Recent work'}))];
 await expect(context.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>{calls++;return stream('Summary detail. '.repeat(60));})).rejects.toMatchObject({code:'compaction_not_reduced'});
 const restarted=await GatewayContext.open(root);
 const response=await restarted.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>{calls++;return stream('Next: test.');});
 expect(response.ok).toBe(true);expect(calls).toBe(2);
});
it('does not erase known charges when a later summary omits usage',async()=>{
 const {context}=await setup();const input:Record<string,unknown>[]=[{role:'user',content:'Preserve API.'}];
 for(let i=0;i<60;i++)input.push({type:'function_call',call_id:'c'+i,name:'read',arguments:'{}'},{type:'function_call_output',call_id:'c'+i,output:'result '.repeat(500)});
 input.push(...history.slice(-8));let calls=0;let incomplete=false;
 const response=await context.response('responses/compact',{model:'qoder/m',input},'a','s',async()=>{
  if(++calls===1)return stream('Keep API. Reads done.');
  return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Continue tests.'}]}]});
 },undefined,{onCompaction:r=>{incomplete=r.unmetered;}});
 expect((await response.json()).usage).toMatchObject({input_tokens:100,output_tokens:10,token_flow_unmetered:true});expect(incomplete).toBe(true);
});
it('fits JSON-escaped summaries into the retained-context budget before inference',async()=>{
 const {context}=await setup();let calls=0;
 const input=[...Array.from({length:70},()=>({role:'assistant',content:'historical work '.repeat(1000)})),{role:'user',content:'Current constraint: '+'x'.repeat(118*1024)},...Array.from({length:7},()=>({role:'assistant',content:'recent'}))];
 const migration={scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>[]};
 const response=await context.response('responses',{model:'qoder/m',input,store:false},'a','s',async(_p,b)=>{
  if(!b.instructions){expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(151*1024);return Response.json({status:'completed',output:[],usage});}
  return stream(++calls<4?'"quoted code"\n'.repeat(600):'Checkpoint: old work completed; preserve current constraint.');
 },migration);
 expect(response.ok).toBe(true);expect(calls).toBeGreaterThanOrEqual(3);
});
it('keeps store:false exported-key summaries off disk and prunes only derived caches',async()=>{
 const {root,context}=await setup();
 await context.response('responses/compact',{model:'qoder/m',input:history,store:false},'a','s',async()=>stream('Keep constraints. Test next.'));
 expect(await readdir(join(root,'gateway-context'))).toEqual(['key']);
 const directory=join(root,'gateway-context');const expired=join(directory,'summary-'+'f'.repeat(64));
 await writeFile(expired,'old');await utimes(expired,new Date(0),new Date(0));
 await writeFile(join(directory,'resp_tf_preserved'),'original response');
 await Promise.all(Array.from({length:513},(_,i)=>writeFile(join(directory,'summary-'+i.toString(16).padStart(64,'0')),'derived')));
 await GatewayContext.open(root);
 expect((await readdir(directory)).filter(name=>name.startsWith('summary-'))).toHaveLength(512);
 expect(await readFile(join(directory,'resp_tf_preserved'),'utf8')).toBe('original response');
});

it.each(['tools','instructions','developer','user'])('forwards a fresh managed Codex request with large %s without recovery or paid compaction',async field=>{
 const {context}=await setup();const input:Record<string,unknown>[]=[{role:'user',content:'Hello'}];
 const body:Record<string,unknown>={};const large='Static context '.repeat(12000);
 if(field==='tools')body.tools=[{type:'function',name:'read',description:large,parameters:{type:'object'}}];
 if(field==='instructions')body.instructions=large;
 if(field==='developer')input.unshift({role:'developer',content:large});
 if(field==='user')input[0].content=large;
 let calls=0;let recoveries=0;let compactions=0;
 const response=await context.response('responses',{model:'cursor/test',...body,input,store:false},'a','s',async(_p,b)=>{
  calls++;expect(b.input).toEqual(input);for(const key of Object.keys(body))expect(b[key]).toEqual(body[key]);
  return Response.json({status:'completed',output:[],usage});
 },{scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>{recoveries++;throw Error('No checkpoint to recover');}},{onCompaction:()=>{compactions++;}});
 expect(response.ok).toBe(true);expect(calls).toBe(1);expect(recoveries).toBe(0);expect(compactions).toBe(0);
});

it('compacts accumulated history with large fixed tools and preserves the new request',async()=>{
 const {context}=await setup();const tools=[{type:'function',name:'read',description:'tool schema '.repeat(18000)}];
 const input=[{role:'developer',content:'Keep instructions verbatim.'},...Array.from({length:30},()=>({role:'assistant',content:'Old completed work '.repeat(2000)})),{role:'user',content:'Continue current task.'}];
 let summaries=0;let answers=0;
 await context.response('responses',{model:'cursor/test',input,tools,store:false},'a','s',async(_p,b)=>{
  if(b.instructions){summaries++;return stream('Old work finished. Check tests next.');}
  answers++;expect(b.tools).toEqual(tools);expect(b.input).toContainEqual(input[0]);expect(b.input).toContainEqual(input.at(-1));expect(JSON.stringify(b.input).length).toBeLessThan(32*1024);
  return Response.json({status:'completed',output:[],usage});
 },{scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>{throw Error('Must not recover another conversation');}});
 expect(summaries).toBeGreaterThan(0);expect(answers).toBe(1);
});

it('does not repeatedly compact a short checkpoint just because fixed context is large',async()=>{
 const {context}=await setup();const input=[{role:'developer',content:'Fixed instructions '.repeat(10000)},{role:'assistant',content:'Historical task checkpoint: '+'x'.repeat(5000)},...Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'short turn '+i}))];
 let compactions=0;let calls=0;
 await context.response('responses',{model:'cursor/test',input,store:false},'a','s',async(_p,b)=>{calls++;expect(b.input).toEqual(input);return Response.json({status:'completed',output:[],usage});},{scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>[]},{onCompaction:()=>compactions++});
 expect(calls).toBe(1);expect(compactions).toBe(0);
});

it('preserves a safe upstream network category when summary creation fails',async()=>{
 const {context}=await setup();
 await expect(context.response('responses/compact',{model:'codex/model',input:history},'a','s',async()=>Response.json({error:{message:'TLS handshake failed: secret-token'}},{status:500}))).rejects.toMatchObject({statusCode:422,code:'compaction_upstream_failed',message:expect.stringContaining('TLS')});
});

it('compacts more than 16 MiB of replayed old tool results before forwarding',async()=>{
 const {context}=await setup();const input:Record<string,unknown>[]=[{role:'user',content:'Keep the public API unchanged.'}];
 for(let i=0;i<18;i++)input.push({type:'function_call',name:'read',call_id:'large'+i,arguments:'{}'},{type:'function_call_output',call_id:'large'+i,output:'x'.repeat(1024*1024)});
 input.push({role:'user',content:'Now run the tests.'});let summaries=0,answers=0;
 await context.response('responses',{model:'qoder/m',input,store:false},'a','s',async(_p,b)=>{
  expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(128*1024);
  if(b.instructions){summaries++;return stream('Read results checked. Preserve the API and run tests next.');}
  answers++;expect(b.input).toContainEqual(input.at(-1));return Response.json({status:'completed',output:[],usage});
 },{scope:{owner:'portable',source:'portable',model:'portable'},recover:async()=>{throw Error('No recovery expected');}});
 expect(summaries).toBeGreaterThan(0);expect(answers).toBe(1);
});

it('summarizes a long transcript without a fixed summary-call ceiling',async()=>{
 const {context}=await setup();let calls=0;
 const input=[{role:'user',content:'Historical reference: '+'x'.repeat(33*48*1024)},...history.slice(-8)];
 const response=await context.response('responses/compact',{model:'qoder/m',input,store:false},'a','s',async()=>{calls++;return stream('Historical reference reviewed. Continue with tests.');});
 expect(response.ok).toBe(true);expect(calls).toBeGreaterThan(32);
});

it('stores, reloads and checkpoints history and responses larger than the former byte cap',async()=>{
 const {root,context}=await setup();const scope={owner:'a',model:'qoder/m',source:'s'};
 const input=[{role:'user',content:'x'.repeat(17*1024*1024)}];
 const encrypted=context.encodeCheckpoint(input,scope);
 expect(context.decodeCheckpoint(encrypted,[scope])[0].content).toHaveLength(17*1024*1024);
 const response=await context.response('responses',{model:'qoder/m',input},'a','s',async()=>Response.json({status:'completed',output:[{role:'assistant',type:'message',content:'y'.repeat(17*1024*1024)}],usage}));
 const stored=await response.json();const reopened=await GatewayContext.open(root);
 const saved=await reopened.readStoredHistory(stored.id,[scope]);
 expect(saved[0].content).toHaveLength(17*1024*1024);expect(saved[1].content).toHaveLength(17*1024*1024);
});

it('passes through a large SSE event without a gateway byte cutoff',async()=>{
 const {context}=await setup();
 const upstream=[{type:'response.output_text.delta',delta:'x'.repeat(17*1024*1024)},{type:'response.completed',response:{status:'completed',output:[],usage}}].map(e=>'data: '+JSON.stringify(e)+'\n\n').join('');
 const response=await context.response('responses',{model:'qoder/m',input:'Continue',stream:true,store:false},'a','s',async()=>new Response(upstream,{headers:{'content-type':'text/event-stream'}}));
 const text=await response.text();expect(text.length).toBeGreaterThan(17*1024*1024);expect(text).toContain('response.completed');
});
