import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {query,createSdkMcpServer,tool} from '@tencent-ai/agent-sdk';
import {fromJSONSchema,z} from 'zod';

const modelTransportPrompt = 'Continue the caller conversation supplied in the user input. Follow the caller system instructions below. You provide model responses and client tool proposals only. The client owns task execution and executes every proposed tool. Do not act as a separate coding agent, access local files, or claim a tool executed before its result appears in the supplied history. Historical tool calls are not new requests. Output the continuation, not an explanation of the transcript.';

// Separate workspace dependency keeps the SDK's Zod 4 peer out of the app's Zod 3.
const require=createRequire(import.meta.url);
const cli=resolve(require.resolve('@tencent-ai/agent-sdk'),'../../cli/bin/codebuddy').replace(/\.asar([/\\])/g,'.asar.unpacked$1');

// Codex app tools may use top-level unions or keywords Zod cannot convert.
// Those still accept any object; the model reads the original schema instead.
function clientSchema(parameters){
 try{const schema=fromJSONSchema(parameters);if(schema.shape)return {schema,note:''};}catch{}
 return {schema:z.looseObject({}),note:` Parameters JSON Schema: ${JSON.stringify(parameters)}`};
}

function sourceErrorCode(message){
 return /\b11128\b|unapproved channel/i.test(message)?'source_policy_blocked':/\b401\b|unauthorized|invalid.*token/i.test(message)?'authentication_error':/\b429\b|rate.limit/i.test(message)?'rate_limit_error':undefined;
}

function reachedTurnLimit(value){
 if(value?.subtype==='error_max_turns')return true;
 const errors=value?.errors??[value?.message];
 return value?.subtype==='error_during_execution'&&Array.isArray(errors)&&errors.length>0&&errors.every(error=>typeof error==='string'&&/^Max(?:imum)? turns(?: \(\d+\))? (?:exceeded|reached)$/i.test(error));
}
function streamUsage(previous,next){
 const usage={...previous};
 for(const key of ['input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens'])if(Number.isFinite(next?.[key])&&next[key]>=0)usage[key]=Math.max(usage[key]??0,next[key]);
 return usage;
}

class SDKIdleError extends Error {
 constructor(retryable){super('SDK model stream made no progress for 60000ms');this.name='SDKIdleError';this.retryable=retryable;}
}

export async function runOfficialSDK(input){
 const started=Date.now();
 for(let attempt=0;;attempt++){
  try{return await runSDKAttempt(input);}
  catch(error){
   // Only internal thinking may be discarded. Never replay visible text, any
   // tool proposal, an upstream error, or caller cancellation. Cleanup of the
   // previous CLI completes before another attempt uses the same input.
   if(attempt||!(error instanceof SDKIdleError)||!error.retryable||input.signal.aborted)throw error;
   input.onDiagnostic?.({event:'idle_retry',elapsedMs:Date.now()-started});
  }
 }
}

async function runSDKAttempt(input){
 const started=Date.now();
 const diagnostic=(event,details={})=>input.onDiagnostic?.({event,elapsedMs:Date.now()-started,...details});
 if(input.signal.aborted){diagnostic('closed');throw new Error('SDK request cancelled');}
 let idleTimer,stalled=false,exposed=false;
 const calls=[];const names=new Map();const schemas=new Map();let accepting=true;
 const definitions=input.tools.map((t,i)=>{
  const name=`client_${i}`;names.set(`mcp__token_flow__${name}`,t);
  const {schema,note}=clientSchema(t.parameters);schemas.set(`mcp__token_flow__${name}`,schema);
  return tool(name,`Client tool ${t.name}. ${t.description??''}${note}`,schema,args=>{
   // These callbacks only propose client work. Reject additional proposals
   // before recording them when the caller requires sequential execution.
   if(!accepting||input.parallelToolCalls===false&&calls.length)return {isError:true,content:[{type:'text',text:'Only one client tool call is permitted this turn. This tool did not execute; wait for the client result before requesting it again.'}]};
   exposed=true;calls.push({name:t.name,arguments:JSON.stringify(args),custom:t.custom});
   // Never execute caller tools here. maxTurns=1 is a fallback limit;
   // the actual tool result arrives in the caller's next request.
   return {content:[{type:'text',text:'Deferred to the client. The tool has not executed yet.'}]};
  });
 });
 const mcp=definitions.length?createSdkMcpServer({name:'token_flow',tools:definitions}):undefined;
 const env=Object.fromEntries(Object.keys(process.env).filter(k=>/^(CODEBUDDY|ANTHROPIC|OPENAI|WORKBUDDY|ACC_PRODUCT)_/.test(k)).map(k=>[k,undefined]));
 // CLI cloud discovery precedes the late --endpoint option. Set its early
 // authoritative endpoint too, so an overseas token never discovers another region.
 Object.assign(env,{ACC_PRODUCT_CONFIG_V3:JSON.stringify({endpoint:input.endpoint??(input.region==='china'?'https://copilot.tencent.com':'https://www.codebuddy.ai')}),CODEBUDDY_AUTH_TOKEN:input.token,CODEBUDDY_INTERNET_ENVIRONMENT:input.region==='china'?'internal':'public',CODEBUDDY_CONFIG_DIR:input.configDir,...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})});
 let q,child;
 const abortController=new AbortController();const cancel=()=>{abortController.abort();child??=q?.transport?.process;q?.transport?.close();};input.signal.addEventListener('abort',cancel,{once:true});if(input.signal.aborted)cancel();
 // Model events, not CLI status/keepalive traffic, reset this watchdog.
 // SDK 0.3.276 otherwise allows 20 minutes of stream silence, beyond the
 // gateway's unchanged 240-second total budget (including this retry).
 const progress=()=>{clearTimeout(idleTimer);idleTimer=setTimeout(()=>{stalled=true;diagnostic('model_idle',{toolCalls:calls.length});cancel();},60000);idleTimer.unref?.();};
 let text='',usage,result,actualModel=input.model;let streamed=false;let streamModel;let partial='';const blockTypes=new Map(),toolBlocks=new Map();let turnUsage={},handedOff=false,turnTruncated=false;
 const prompt=input.images?.length?(async function*(){yield {type:'user',session_id:'',parent_tool_use_id:null,message:{role:'user',content:[{type:'text',text:input.prompt},...input.images]}};})():input.prompt;
 try{
  q=query({prompt,options:{pathToCodebuddyCode:cli,executable:process.execPath,env,environment:input.region==='china'?'internal':'external',endpoint:input.endpoint,model:input.model,cwd:input.cwd,systemPrompt:[modelTransportPrompt,input.systemPrompt].filter(Boolean).join('\n\n'),includePartialMessages:true,settingSources:[],tools:[],mcpServers:mcp?{token_flow:mcp}:{},strictMcpConfig:true,persistSession:false,maxTurns:1,abortController,stderr:line=>{const value=String(line);if(/retry|retrying|429|timeout|ECONN|EOF/i.test(value))diagnostic('stderr',{category:/429/.test(value)?'rate_limit':/retry/i.test(value)?'retry':/timeout/i.test(value)?'timeout':'transport'});},canUseTool:async(name,args)=>names.has(name)?{behavior:'allow',updatedInput:args}:{behavior:'deny',message:'Only caller-provided tools are permitted'}}});
  // SDK 0.3.276 dispatches MCP requests without awaiting them. Its close()
  // rejects pending MCP work; the catch then tries to reply to the dead CLI,
  // creating an unhandled rejection that terminates the entire gateway.
  // Discard only replies to this request's closed transport. Live failures
  // remain errors, and no global rejection handler hides unrelated bugs.
  const transport=q.transport;
  // connect() awaits CLI version discovery before start(). Cancellation can close
  // the transport during that await; SDK 0.3.276 otherwise spawns a new child
  // on the closed transport and then waits for initialization/forced cleanup.
  const start=transport?.start;
  if(typeof start==='function')transport.start=function(...args){
   if(this.closed||input.signal.aborted)throw new Error('SDK request cancelled');
   return start.apply(this,args);
  };
  for(const method of ['sendControlResponse','sendControlErrorResponse']){
   const send=transport?.[method];
   if(typeof send==='function')transport[method]=function(...args){if(this.closed)return;return send.apply(this,args);};
  }
  if(input.signal.aborted)cancel();
  diagnostic('started');
  for await(const message of q){
   if(['system','assistant','result'].includes(message.type))diagnostic(message.type,{subtype:message.type==='result'?message.subtype:undefined});
   // SDK 0.3.276 closes asynchronously. Retain only its owned child handle so
   // temporary session files are removed after the CLI has finished flushing.
   child??=q.transport?.process;
   if(message.type==='stream_event'){
    const event=message.event;
    if(event.type==='message_start'&&!idleTimer)progress();
    if(event.type==='content_block_delta'&&['text','thinking','partial_json'].some(key=>typeof event.delta?.[key]==='string'&&event.delta[key].length>0))progress();
    if(event.type==='message_start'){streamModel=event.message.model;partial='';blockTypes.clear();toolBlocks.clear();turnUsage=streamUsage({},event.message.usage);turnTruncated=false;}
    if(event.type==='content_block_start'){
     blockTypes.set(event.index,event.content_block.type);
     if(event.content_block.type==='tool_use')exposed=true;
     if(event.content_block.type==='tool_use')toolBlocks.set(event.index,{name:event.content_block.name,input:event.content_block.input,json:'',complete:false});
    }
    if(event.type==='content_block_delta'&&event.delta.type==='input_json_delta'){
     const block=toolBlocks.get(event.index);if(!block)throw new Error('SDK tool delta without a tool block');
     block.json+=event.delta.partial_json;if(block.json.length>16*1024*1024)throw new Error('SDK tool input exceeds limit');
    }
    if(event.type==='content_block_stop'&&toolBlocks.has(event.index))toolBlocks.get(event.index).complete=true;
    if(event.type==='message_delta'){turnUsage=streamUsage(turnUsage,event.usage);if(['max_tokens','model_context_window_exceeded','refusal'].includes(event.delta?.stop_reason))turnTruncated=true;}
    if(event.type==='error')throw new Error('SDK model stream reported an error');
    // The CLI can continue inference after its deferred MCP callback and even
    // mislabel its one-turn limit as error_during_execution. The client owns
    // execution: hand off at the complete model turn, never at a partial block.
    if(event.type==='message_stop'&&toolBlocks.size){
     if(turnTruncated)throw new Error('SDK tool turn did not finish normally');
     if(input.model!=='auto'&&streamModel!==input.model)throw new Error('SDK streaming model mismatch');
     const proposals=[...toolBlocks.values()].map(block=>{
      const tool=names.get(block.name),schema=schemas.get(block.name);
      if(!block.complete||!tool||!schema)throw new Error('SDK incomplete or unknown tool proposal');
      const args=schema.parse(block.json?JSON.parse(block.json):block.input);
      return {name:tool.name,arguments:JSON.stringify(args),custom:tool.custom};
     });
     if(input.parallelToolCalls===false&&proposals.length>1)throw new Error('SDK violated the single client tool limit');
     accepting=false;calls.splice(0,calls.length,...proposals);actualModel=streamModel;
     if(Number.isFinite(turnUsage.input_tokens)&&Number.isFinite(turnUsage.output_tokens))usage=turnUsage;
     text+=partial;partial='';handedOff=true;diagnostic('tool_handoff',{toolCalls:calls.length});break;
    }
    if(event.type==='content_block_delta'&&event.delta.type==='text_delta'&&blockTypes.get(event.index)==='text'){
     if(input.model!=='auto'&&streamModel!==input.model)throw new Error('SDK streaming model mismatch');
     const delta=event.delta.text;if(delta)exposed=true;partial+=delta;streamed=true;input.onText?.(delta);
    }
   }
   if(message.type==='assistant'){
    actualModel=message.message.model;usage=message.message.usage??usage;
    const complete=message.message.content.filter(c=>c.type==='text').map(c=>c.text).join('');
    if(!message.message.content.some(c=>c.type==='text'))continue;
    if(partial&&complete!==partial)throw new Error(`SDK text stream mismatch: partial=${partial.length}, complete=${complete.length}, blocks=${message.message.content.map(c=>c.type).join(',')}`);
    if(complete)exposed=true;
    if(!partial&&complete){if(input.model!=='auto'&&actualModel!==input.model)throw new Error('SDK model mismatch');input.onText?.(complete);}
    text+=complete;partial='';
   }
   if(message.type==='result'){result=message;usage=message.usage??usage;if(!text&&message.result){text=message.result;if(!streamed)input.onText?.(text);}}
  }
  if(input.signal.aborted)throw new Error('SDK request cancelled');
  if(stalled)throw new SDKIdleError(!exposed&&!calls.length);
  // A deferred tool call intentionally reaches the one-turn limit.
  const failed=!handedOff&&(!result||result.is_error&&!(calls.length&&reachedTurnLimit(result)));
  const errors=JSON.stringify(result?.errors??[]);
  const errorCode=sourceErrorCode(errors);
  return {text,calls,usage,model:actualModel,failed,errorCode};
 }catch(error){
  if(stalled&&!input.signal.aborted)throw new SDKIdleError(!exposed&&!calls.length);
  const detail=String(error?.message??'');
  diagnostic('exception',{toolCalls:calls.length,kind:['ExecutionError','CLIStartupError','AbortError','Error'].includes(error?.name)?error.name:'other',subtype:['error_max_turns','error_during_execution'].includes(error?.subtype)?error.subtype:undefined,status:Number(detail.match(/\b(400|401|403|408|429|500|502|503|504)\b/)?.[1])||undefined,category:/text stream mismatch/.test(detail)?'text_mismatch':/model mismatch/.test(detail)?'model_mismatch':/EOF|socket|ECONN|fetch failed/i.test(detail)?'transport':/timeout|timed out/i.test(detail)?'timeout':'other'});
  // The SDK throws ExecutionError for upstream HTTP failures instead of always
  // yielding a result.errors item. Both channels must retain source semantics.
  if(error?.name==='ExecutionError'&&reachedTurnLimit(error)&&calls.length&&!input.signal.aborted)return {text,calls,usage,model:actualModel,failed:false};
  const errorCode=error?.name==='ExecutionError'?sourceErrorCode(String(error.message)):undefined;
  if(!errorCode||input.signal.aborted)throw error;
  return {text,calls:[],usage,model:actualModel,failed:true,errorCode};
 }finally{
  clearTimeout(idleTimer);accepting=false;input.signal.removeEventListener('abort',cancel);child??=q?.transport?.process;
  // Iteration already closes the SDK transport. return() means interrupt in
  // SDK 0.3.276 and can wait for a control reply after shutdown.
  q?.transport?.close();
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(done=>{
   const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('close',()=>{clearTimeout(timer);done();});
  });
  await mcp?.instance.close().catch(()=>{});diagnostic('closed');
 }
}
