import {it,expect,vi,beforeEach} from 'vitest';
const sdk=vi.hoisted(()=>({query:vi.fn(),descriptions:[] as string[],callbacks:[] as Array<(args:Record<string,unknown>)=>unknown>}));
vi.mock('../packages/codebuddy-runtime/node_modules/@tencent-ai/agent-sdk/lib/index.js',()=>({
 query:sdk.query,
 tool:(_name:unknown,description:string,schema:{parse:(value:unknown)=>Record<string,unknown>},callback:(args:Record<string,unknown>)=>unknown)=>{sdk.descriptions.push(description);sdk.callbacks.push(args=>callback(schema.parse(args)));return {};},
 createSdkMcpServer:()=>({instance:{close:async()=>{}}}),
}));
import {runOfficialSDK} from '../packages/codebuddy-runtime/index.js';
beforeEach(()=>{sdk.callbacks.length=0;sdk.descriptions.length=0;sdk.query.mockReset();});

it.each([false,true,undefined])('hands back client proposals with parallelToolCalls=%s without running commands',async parallelToolCalls=>{
 const command='printf should-only-run-on-client';let options:Record<string,any>={};
 sdk.query.mockImplementation((request:{options:Record<string,any>})=>{
  options=request.options;
  return (async function*(){
   const results=await Promise.all(sdk.callbacks.map(callback=>callback({command})));
   expect(results[0]).toMatchObject({content:[{text:expect.stringContaining('has not executed')}]});
   if(parallelToolCalls===false)expect(results[1]).toMatchObject({isError:true});
   yield {type:'assistant',message:{model:'test',content:[]}};
   yield {type:'result',is_error:true,subtype:'error_max_turns'};
  })();
 });
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Use client tools',tools:['first','second'].map(name=>({name,parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}})),parallelToolCalls,signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(options).toMatchObject({tools:[],strictMcpConfig:true,settingSources:[],maxTurns:1});
 expect(await options.canUseTool('Bash',{command})).toMatchObject({behavior:'deny'});
 expect(result.failed).toBe(false);expect(result.calls).toHaveLength(parallelToolCalls===false?1:2);
 expect(result.calls[0]).toMatchObject({name:'first',arguments:JSON.stringify({command})});
});

it('accepts client tools whose schema is not a plain object',async()=>{
 const args={threadId:'t1'};
 sdk.query.mockImplementation(()=>(async function*(){
  for(const callback of sdk.callbacks)await callback(args);
  yield {type:'assistant',message:{model:'test',content:[]}};
  yield {type:'result',is_error:true,subtype:'error_max_turns'};
 })());
 const union={anyOf:[{type:'object',properties:{threadId:{type:'string'}},required:['threadId']},{type:'object',properties:{projectId:{type:'string'}},required:['projectId']}]};
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Use client tools',tools:[{name:'union',parameters:union},{name:'unconvertible',parameters:{type:'object',properties:{x:{$ref:'#/$defs/missing'}}}}],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(result.failed).toBe(false);
 expect(sdk.descriptions[0]).toContain(JSON.stringify(union));
 expect(result.calls.map(call=>call.name)).toEqual(['union','unconvertible']);
 expect(result.calls[0]!.arguments).toBe(JSON.stringify(args));
});

it('overrides the coding preset and emits partial text once before completion',async()=>{
 let complete!:()=>void;const gate=new Promise<void>(resolve=>{complete=resolve;});const deltas:string[]=[];
 sdk.query.mockImplementation((request:{options:Record<string,any>})=>{
  expect(request.options.systemPrompt).toContain('CALLER_SYSTEM');
  expect(request.options.systemPrompt).toContain('client owns task execution');
  expect(request.options.includePartialMessages).toBe(true);
  return (async function*(){
   yield {type:'stream_event',event:{type:'message_start',message:{model:'test'}}};
   yield {type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'text'}}};
   yield {type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'Live'}}};
   yield {type:'assistant',message:{model:'test',content:[{type:'thinking',thinking:'not output'}]}};
   await gate;
   yield {type:'assistant',message:{model:'test',content:[{type:'text',text:'Live'}]}};
   yield {type:'result',subtype:'success',is_error:false,result:'Live'};
  })();
 });
 const pending=runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',systemPrompt:'CALLER_SYSTEM',onText:text=>{deltas.push(text);complete();},tools:[],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 const result=await pending;expect(deltas).toEqual(['Live']);expect(result.text).toBe('Live');expect(result.failed).toBe(false);
});
it.each([['429 您的使用量已超出频率限制，将在稍后重置 (private-request-id)','rate_limit_error'],['401 Unauthorized Bearer secret','authentication_error'],['403 unapproved channel (11128)','source_policy_blocked']])('preserves SDK thrown upstream failures without leaking their messages: %s',async(message,errorCode)=>{
 sdk.query.mockImplementation(()=>(async function*(){throw Object.assign(new Error(message),{name:'ExecutionError'});})());
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Use tools',tools:[],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(result).toMatchObject({failed:true,errorCode,calls:[]});expect(JSON.stringify(result)).not.toMatch(/private-request|secret|频率限制/);
});

it('preserves a deferred client tool when the real SDK throws the max-turn result',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){
  await sdk.callbacks[0]!({step:1});
  yield {type:'assistant',message:{model:'test',content:[],usage:{input_tokens:5,output_tokens:2}}};
  throw Object.assign(new Error('Maximum turns reached'),{name:'ExecutionError',subtype:'error_max_turns',errors:['Maximum turns reached']});
 })());
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixture',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(result).toMatchObject({failed:false,calls:[{name:'read_fixture',arguments:'{"step":1}'}],usage:{input_tokens:5,output_tokens:2}});
});
it('does not accept a max-turn failure without a deferred client proposal',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){throw Object.assign(new Error('Maximum turns reached'),{name:'ExecutionError',subtype:'error_max_turns'});})());
 await expect(runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',tools:[],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'})).rejects.toThrow('Maximum turns reached');
});

it('closes a silent SDK transport on cancellation without waiting for another model event',async()=>{
 let unblock!:()=>void;const idle=new Promise<void>(resolve=>{unblock=resolve;});const close=vi.fn(unblock);
 sdk.query.mockImplementation(()=>Object.assign((async function*(){await idle;})(),{transport:{close}}));
 const controller=new AbortController();
 const pending=runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',tools:[],signal:controller.signal,cwd:'/tmp',configDir:'/tmp'});
 const outcome=pending.then(()=> 'resolved',()=> 'cancelled');
 try{controller.abort();expect(close).toHaveBeenCalled();expect(await Promise.race([outcome,new Promise(r=>setTimeout(()=>r('hung'),100))])).toBe('cancelled');}
 finally{unblock();await outcome;}
});

it('ignores SDK control replies only after their own transport closes',async()=>{
 const {ProcessTransport}=await import('../packages/codebuddy-runtime/node_modules/@tencent-ai/agent-sdk/lib/transport/process-transport.js');
 const transport=new ProcessTransport({});
 sdk.query.mockImplementation(()=>Object.assign((async function*(){yield {type:'result',subtype:'success',is_error:false,result:'OK'};})(),{transport}));
 // A live transport error must still be visible.
 expect(()=>transport.sendControlResponse('live',{})).toThrow('Transport not started');
 await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',tools:[],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(()=>transport.sendControlResponse('late',{})).not.toThrow();
 expect(()=>transport.sendControlErrorResponse('late','closed')).not.toThrow();
});

it('does not create a CLI query for an already cancelled request',async()=>{
 const controller=new AbortController();controller.abort();
 sdk.query.mockImplementation(()=>(async function*(){})());
 await expect(runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',tools:[],signal:controller.signal,cwd:'/tmp',configDir:'/tmp'})).rejects.toThrow();
 expect(sdk.query).not.toHaveBeenCalled();
});
it('prevents SDK delayed startup from resurrecting a closed request',async()=>{
 const {ProcessTransport}=await import('../packages/codebuddy-runtime/node_modules/@tencent-ai/agent-sdk/lib/transport/process-transport.js');
 const transport=new ProcessTransport({});const spawn=vi.spyOn(transport,'start').mockImplementation(()=>{});
 let ready!:()=>void;const gate=new Promise<void>(resolve=>{ready=resolve;});
 sdk.query.mockImplementation(()=>Object.assign((async function*(){await gate;transport.start();})(),{transport}));
 const controller=new AbortController();
 const pending=runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'hello',tools:[],signal:controller.signal,cwd:'/tmp',configDir:'/tmp'});
 controller.abort();ready();
 await expect(pending).rejects.toThrow();expect(spawn).not.toHaveBeenCalled();
});

it('preserves proposals when CLI reports its turn limit as error_during_execution',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){
  await sdk.callbacks[0]!({step:7});
  yield {type:'assistant',message:{model:'test',content:[],usage:{input_tokens:7,output_tokens:3}}};
  throw Object.assign(new Error('Max turns (1) exceeded'),{name:'ExecutionError',subtype:'error_during_execution',errors:['Max turns (1) exceeded']});
 })());
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixture',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(result).toMatchObject({failed:false,calls:[{name:'read_fixture',arguments:'{"step":7}'}]});
});

const completeToolTurn=(names=['mcp__token_flow__client_0'])=>[
 {type:'stream_event',event:{type:'message_start',message:{model:'test',usage:{input_tokens:20,output_tokens:0,cache_read_input_tokens:5}}}},
 ...names.flatMap((name,index)=>[
  {type:'stream_event',event:{type:'content_block_start',index,content_block:{type:'tool_use',id:`use_${index}`,name,input:{}}}},
  {type:'stream_event',event:{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:'{"step":'}}},
  {type:'stream_event',event:{type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:'7}'}}},
  {type:'stream_event',event:{type:'content_block_stop',index}},
 ]),
 {type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:8}}},
 {type:'stream_event',event:{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{input_tokens:0,output_tokens:0}}},
 {type:'stream_event',event:{type:'message_stop'}},
];
it('hands off the whole validated streamed tool turn before SDK follow-up inference',async()=>{
 let followup=false,closed=false;
 sdk.query.mockImplementation(()=> (async function*(){try{
  for(const message of completeToolTurn(['mcp__token_flow__client_0','mcp__token_flow__client_1']))yield message;
  followup=true;throw new Error('SDK entered follow-up inference');
 }finally{closed=true;}})());
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixtures',tools:['first','second'].map(name=>({name,parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}})),signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(followup).toBe(false);expect(closed).toBe(true);expect(result).toMatchObject({failed:false,calls:[{name:'first',arguments:'{"step":7}'},{name:'second',arguments:'{"step":7}'}],usage:{input_tokens:20,output_tokens:8,cache_read_input_tokens:5}});
});

it.each(['unknown','invalid_args','unfinished','wrong_model','parallel','stream_error','truncated'] as const)('rejects %s streamed tools instead of declaring a completed handoff',async fault=>{
 const events:any[]=completeToolTurn(fault==='parallel'?['mcp__token_flow__client_0','mcp__token_flow__client_0']:fault==='unknown'?['Bash']:undefined);
 if(fault==='invalid_args')events.find(m=>m.event.delta?.partial_json==='7}').event.delta.partial_json='"not-an-integer"}';
 if(fault==='unfinished')events.splice(events.findIndex(m=>m.event.type==='content_block_stop'),1);
 if(fault==='wrong_model')events[0].event.message.model='wrong';
 if(fault==='truncated')events.find(m=>m.event.delta?.stop_reason==='tool_use').event.delta.stop_reason='max_tokens';
 if(fault==='stream_error')events.splice(events.length-1,0,{type:'stream_event',event:{type:'error',error:{message:'synthetic'}}});
 sdk.query.mockImplementation(()=>(async function*(){for(const event of events)yield event;})());
 await expect(runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixture',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],parallelToolCalls:fault==='parallel'?false:undefined,signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'})).rejects.toThrow();
});
it('does not return a streamed proposal twice when the MCP callback was already delivered',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){await sdk.callbacks[0]!({step:7});for(const event of completeToolTurn())yield event;})());
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixture',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(result.calls).toHaveLength(1);expect(result.failed).toBe(false);
 // A late callback during shutdown cannot append to the handed-off result.
 await sdk.callbacks[0]!({step:8});expect(result.calls).toHaveLength(1);
});
it('does not hide unrelated errors mixed with an incorrectly tagged turn limit',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){await sdk.callbacks[0]!({step:7});throw Object.assign(new Error('Max turns (1) exceeded'),{name:'ExecutionError',subtype:'error_during_execution',errors:['Max turns (1) exceeded','upstream disconnected']});})());
 await expect(runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Read fixture',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'})).rejects.toThrow();
});

const idleInput=(controller:AbortController)=>({token:'fixture',region:'china' as const,model:'test',prompt:'same history',tools:[{name:'read_fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}}],signal:controller.signal,cwd:'/tmp',configDir:'/tmp'});
function silentQuery(events:any[]){
 let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
 return Object.assign((async function*(){for(const event of events)yield event;await wait;})(),{transport:{close:()=>release()}});
}
const thinkingStart=[
 {type:'stream_event',event:{type:'message_start',message:{model:'test',usage:{input_tokens:10,output_tokens:0}}}},
 {type:'stream_event',event:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}},
 {type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'fixture'}}},
];
it('recovers a silent first thinking turn once with the same request and no duplicated tools',async()=>{
 vi.useFakeTimers();const controller=new AbortController();let pending:Promise<any>|undefined;
 sdk.query.mockImplementationOnce(()=>silentQuery(thinkingStart)).mockImplementationOnce(()=>(async function*(){for(const event of completeToolTurn())yield event;})());
 try{
  pending=runOfficialSDK(idleInput(controller));await vi.advanceTimersByTimeAsync(60001);
  expect(sdk.query).toHaveBeenCalledTimes(2);
  expect(sdk.query.mock.calls[1]![0].prompt).toBe(sdk.query.mock.calls[0]![0].prompt);
  expect(sdk.query.mock.calls[1]![0].options.env.CODEBUDDY_AUTH_TOKEN).toBe('fixture');
  expect(sdk.query.mock.calls[1]![0].options.model).toBe('test');
  expect(await pending).toMatchObject({failed:false,calls:[{name:'read_fixture',arguments:'{"step":7}'}]});
 }finally{controller.abort();await pending?.catch(()=>{});vi.useRealTimers();}
});
it.each(['text','tool'] as const)('does not replay a stalled turn after %s begins',async kind=>{
 vi.useFakeTimers();const controller=new AbortController();
 const started=kind==='text'?[
  {type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'text',text:''}}},
  {type:'stream_event',event:{type:'content_block_delta',index:1,delta:{type:'text_delta',text:'already visible'}}},
 ]:[{type:'stream_event',event:{type:'content_block_start',index:1,content_block:{type:'tool_use',name:'mcp__token_flow__client_0',input:{}}}}];
 sdk.query.mockImplementation(()=>silentQuery([...thinkingStart,...started]));
 const outcome=runOfficialSDK(idleInput(controller)).then(()=>null,error=>error);
 try{await vi.advanceTimersByTimeAsync(60001);expect(await outcome).toMatchObject({name:'SDKIdleError'});expect(sdk.query).toHaveBeenCalledTimes(1);}
 finally{controller.abort();await outcome;vi.useRealTimers();}
});
it('bounds thinking-only silence recovery to one retry',async()=>{
 vi.useFakeTimers();const controller=new AbortController();sdk.query.mockImplementation(()=>silentQuery(thinkingStart));
 const outcome=runOfficialSDK(idleInput(controller)).then(()=>null,error=>error);
 try{await vi.advanceTimersByTimeAsync(120001);expect(await outcome).toMatchObject({name:'SDKIdleError'});expect(sdk.query).toHaveBeenCalledTimes(2);}
 finally{controller.abort();await outcome;vi.useRealTimers();}
});
it('does not retry when the caller cancels the thinking turn',async()=>{
 vi.useFakeTimers();const controller=new AbortController();sdk.query.mockImplementation(()=>silentQuery(thinkingStart));
 const outcome=runOfficialSDK(idleInput(controller)).then(()=>null,error=>error);
 try{await vi.advanceTimersByTimeAsync(30000);controller.abort();await outcome;await vi.advanceTimersByTimeAsync(60001);expect(sdk.query).toHaveBeenCalledTimes(1);}
 finally{controller.abort();await outcome;vi.useRealTimers();}
});
it.each([true,false])('uses nonempty model progress, not keepalives, for the idle clock (progress=%s)',async realProgress=>{
 vi.useFakeTimers();const controller=new AbortController();let stopped=false,close!:()=>void;const cancelled=new Promise<void>(resolve=>{close=()=>{stopped=true;resolve();};});
 sdk.query.mockImplementationOnce(()=>Object.assign((async function*(){
  for(const event of thinkingStart)yield event;
  for(let i=0;i<2;i++){
   await Promise.race([new Promise(r=>setTimeout(r,40000)),cancelled]);if(stopped)return;
   if(realProgress)yield {type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'progress'}}};
   else {yield {type:'system',subtype:'keepalive'};yield {type:'stream_event',event:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:''}}};}
  }
  for(const event of completeToolTurn())yield event;
 })(),{transport:{close}})).mockImplementationOnce(()=>(async function*(){for(const event of completeToolTurn())yield event;})());
 const outcome=runOfficialSDK(idleInput(controller));
 try{await vi.advanceTimersByTimeAsync(80001);expect((await outcome).failed).toBe(false);expect(sdk.query).toHaveBeenCalledTimes(realProgress?1:2);}
 finally{controller.abort();await outcome.catch(()=>{});vi.useRealTimers();}
});

it('passes the account endpoint to CLI initialization instead of relying on the international default',async()=>{
 sdk.query.mockImplementation(()=>(async function*(){yield {type:'result',subtype:'success',is_error:false,result:'ok'};})());
 await runOfficialSDK({token:'fixture',region:'international',endpoint:'https://www.workbuddy.ai',model:'test',prompt:'Reply ok',tools:[],signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(sdk.query.mock.calls[0]![0].options).toMatchObject({environment:'external',endpoint:'https://www.workbuddy.ai'});
});
