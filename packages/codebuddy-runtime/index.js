import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {query,createSdkMcpServer,tool} from '@tencent-ai/agent-sdk';
import {fromJSONSchema} from 'zod';

// Separate workspace dependency keeps the SDK's Zod 4 peer out of the app's Zod 3.
const require=createRequire(import.meta.url);
const cli=resolve(require.resolve('@tencent-ai/agent-sdk'),'../../cli/bin/codebuddy').replace(/\.asar([/\\])/g,'.asar.unpacked$1');

export async function runOfficialSDK(input){
 const calls=[];const names=new Map();
 const definitions=input.tools.map((t,i)=>{
  const name=`client_${i}`;names.set(`mcp__token_flow__${name}`,t);
  const schema=fromJSONSchema(t.parameters);
  if(!schema.shape)throw new Error('Client tool must have an object schema');
  return tool(name,`Client tool ${t.name}. ${t.description??''}`,schema.shape,args=>{
   // These callbacks only propose client work. Reject additional proposals
   // before recording them when the caller requires sequential execution.
   if(input.parallelToolCalls===false&&calls.length)return {isError:true,content:[{type:'text',text:'Only one client tool call is permitted this turn. This tool did not execute; wait for the client result before requesting it again.'}]};
   calls.push({name:t.name,arguments:JSON.stringify(args),custom:t.custom});
   // Never execute caller tools here. maxTurns=1 ends the SDK after this turn;
   // the actual tool result arrives in the caller's next request.
   return {content:[{type:'text',text:'Deferred to the client. The tool has not executed yet.'}]};
  });
 });
 const mcp=definitions.length?createSdkMcpServer({name:'token_flow',tools:definitions}):undefined;
 const env=Object.fromEntries(Object.keys(process.env).filter(k=>/^(CODEBUDDY|ANTHROPIC|OPENAI|WORKBUDDY)_/.test(k)).map(k=>[k,undefined]));
 Object.assign(env,{CODEBUDDY_AUTH_TOKEN:input.token,CODEBUDDY_INTERNET_ENVIRONMENT:input.region==='china'?'internal':'public',CODEBUDDY_CONFIG_DIR:input.configDir,...(process.versions.electron?{ELECTRON_RUN_AS_NODE:'1'}:{})});
 const abortController=new AbortController();const cancel=()=>abortController.abort();input.signal.addEventListener('abort',cancel,{once:true});if(input.signal.aborted)cancel();
 let text='',usage,result,actualModel=input.model;let q,child;
 const prompt=input.images?.length?(async function*(){yield {type:'user',session_id:'',parent_tool_use_id:null,message:{role:'user',content:[{type:'text',text:input.prompt},...input.images]}};})():input.prompt;
 try{
  q=query({prompt,options:{pathToCodebuddyCode:cli,executable:process.execPath,env,environment:input.region==='china'?'internal':'external',model:input.model,cwd:input.cwd,settingSources:[],tools:[],mcpServers:mcp?{token_flow:mcp}:{},strictMcpConfig:true,persistSession:false,maxTurns:1,abortController,stderr:()=>{},canUseTool:async(name,args)=>names.has(name)?{behavior:'allow',updatedInput:args}:{behavior:'deny',message:'Only caller-provided tools are permitted'}}});
  for await(const message of q){
   // SDK 0.3.276 closes asynchronously. Retain only its owned child handle so
   // temporary session files are removed after the CLI has finished flushing.
   child??=q.transport?.process;
   if(message.type==='assistant'){
    actualModel=message.message.model;usage=message.message.usage??usage;
    text+=message.message.content.filter(c=>c.type==='text').map(c=>c.text).join('');
   }
   if(message.type==='result'){result=message;usage=message.usage??usage;if(!text&&message.result)text=message.result;}
  }
  if(input.signal.aborted)throw new Error('SDK request cancelled');
  // A deferred tool call intentionally reaches the one-turn limit.
  const failed=!result||result.is_error&&!(calls.length&&result.subtype==='error_max_turns');
  const errors=JSON.stringify(result?.errors??[]);
  const errorCode=/11128|unapproved channel/i.test(errors)?'source_policy_blocked':/401|unauthorized|invalid.*token/i.test(errors)?'authentication_error':/429|rate.limit/i.test(errors)?'rate_limit_error':undefined;
  return {text:calls.length?'':text,calls,usage,model:actualModel,failed,errorCode};
 }finally{
  input.signal.removeEventListener('abort',cancel);child??=q?.transport?.process;
  // Iteration already closes the SDK transport. return() means interrupt in
  // SDK 0.3.276 and can wait for a control reply after shutdown.
  q?.transport?.close();
  if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(done=>{
   const timer=setTimeout(()=>child.kill('SIGKILL'),8000);child.once('close',()=>{clearTimeout(timer);done();});
  });
  await mcp?.instance.close().catch(()=>{});
 }
}
