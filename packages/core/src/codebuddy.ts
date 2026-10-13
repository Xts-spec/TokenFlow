import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {runOfficialSDK,type SDKInput,type SDKResult} from '@token-flow/codebuddy-runtime';
import {parseCursorInput,cursorResponse} from './cursor-protocol.js';

const credentialSchema=z.object({type:z.literal('workbuddy'),access_token:z.string().optional(),jwt:z.string().optional(),domain:z.string().optional(),disabled:z.boolean().optional()});
export function workbuddySDKCredential(raw:unknown){
 const value=credentialSchema.parse(raw);const token=value.access_token||value.jwt;
 if(!token||value.disabled)throw new Error('WorkBuddy credential unavailable');
 const domain=(value.domain??'copilot.tencent.com').replace(/^https:\/\//,'').replace(/\/$/,'');
 if(!['copilot.tencent.com','www.codebuddy.cn','www.workbuddy.ai','www.codebuddy.ai'].includes(domain))throw new Error('Unknown WorkBuddy region');
 return {token,region:domain.endsWith('.ai')?'international' as const:'china' as const};
}

export function parseCodeBuddyInput(path:string,body:unknown){
 const raw=z.record(z.unknown()).parse(body);const images:unknown[]=[];
 // The SDK takes a conversation prompt and native image blocks, not an HTTP
 // inference body. Preserve the transcript and caller tool identities as data.
 const normalize=(value:unknown):unknown=>{
  if(Array.isArray(value))return value.map(normalize);
  if(!value||typeof value!=='object')return value;
  const v=value as Record<string,unknown>;
  if(['image','image_url','input_image'].includes(String(v.type))){
   let block:unknown;
   if(v.type==='image')block={type:'image',source:v.source};
   else {const url=typeof v.image_url==='string'?v.image_url:(v.image_url as {url?:string})?.url;
    if(typeof url!=='string')throw new Error('Invalid image');
    const match=/^data:(image\/[\w.+-]+);base64,([\s\S]+)$/.exec(url);
    block={type:'image',source:match?{type:'base64',media_type:match[1],data:match[2]}:{type:'url',url}};
   }
   images.push(block);return {type:'text',text:`[Attached image ${images.length}]`};
  }
  return Object.fromEntries(Object.entries(v).map(([k,item])=>[k,normalize(item)]));
 };
 const fields=['model','stream','input','messages','instructions','system','tools','tool_choice','parallel_tool_calls','max_tokens','max_output_tokens','max_completion_tokens','reasoning','reasoning_effort'];
 const normalized=Object.fromEntries(fields.filter(k=>raw[k]!==undefined).map(k=>[k,normalize(raw[k])]));
 // Responses Lite carries additional declarations inside input. They are tool
 // definitions, not historical conversation turns. Top-level declarations win.
 const declarations=normalized.tools===undefined?[]:z.array(z.unknown()).parse(normalized.tools);
 if(path==='responses'&&Array.isArray(normalized.input))normalized.input=normalized.input.filter(item=>{
  if(item&&typeof item==='object'&&item.type==='additional_tools'){
   declarations.push(...z.array(z.unknown()).parse(item.tools));return false;
  }
  return true;
 });
 const toolIdentities=new Map<string,{name:string;namespace?:string}>();
 const entries=new Map<string,{tool:Record<string,unknown>;fn:Record<string,unknown>;name:string;namespace?:string;base:string}>();
 const identity=(name:string,namespace?:string)=>JSON.stringify([namespace??null,name]);
 const collect=(tools:unknown[],namespace?:string):void=>{
  for(const [index,value] of tools.entries()){
   const tool=z.record(z.unknown()).parse(value);
   if(tool.type==='namespace'){collect(z.array(z.unknown()).parse(tool.tools),z.string().parse(tool.name));continue;}
   const fn=z.record(z.unknown()).parse(tool.function??tool);
   const parsedName=z.string().min(1).safeParse(fn.name);if(!parsedName.success)throw new z.ZodError(parsedName.error.issues.map(issue=>({...issue,path:['tools',index,'name',...issue.path]})));const name=parsedName.data;
   const key=identity(name,namespace);
   if(!entries.has(key))entries.set(key,{tool,fn,name,namespace,base:namespace?`${namespace}__${name}`:name});
  }
 };
 collect(declarations);
 const bases=new Map<string,number>();for(const entry of entries.values())bases.set(entry.base,(bases.get(entry.base)??0)+1);
 const reserved=new Set(bases.keys());const aliases=new Map<string,string>();
 normalized.tools=[...entries].map(([key,{tool,fn,name,namespace,base}])=>{
  let alias=base;
  if(bases.get(base)!==1||base.length>128){
   let nonce=0;
   do{alias=`tf_${createHash('sha256').update(`${key}:${nonce++}`).digest('hex').slice(0,40)}`;}while(reserved.has(alias));
  }
  reserved.add(alias);aliases.set(key,alias);toolIdentities.set(alias,{name,namespace});
  const adapted={...fn,name:alias,...(alias!==base?{description:`Client tool ${JSON.stringify({name,namespace})}. ${typeof fn.description==='string'?fn.description:''}`}:{})};
  return tool.function?{...tool,function:adapted}:adapted;
 });
 const choice=normalized.tool_choice as {namespace?:string;name?:string;function?:{name:string}}|undefined;
 if(choice&&typeof choice==='object'){
  const name=choice.function?.name??choice.name;
  const alias=name&&aliases.get(identity(name,choice.namespace));
  if(alias)normalized.tool_choice=choice.function?{...choice,function:{...choice.function,name:alias}}:{...choice,name:alias};
 }

 const parsed=parseCursorInput(path,normalized);
 return {...parsed,images,toolIdentities};
}

/** Every request is scoped to the selected account. No local SDK tools or fallback account. */
export class WorkBuddySDKProvider {
 private active=new Set<AbortController>();private closed=false;
 private pending=new Set<Promise<void>>();
 constructor(private root:string,private credential:(sourceId:string,model:string)=>Promise<unknown>,private run:(input:SDKInput)=>Promise<SDKResult>=runOfficialSDK){}
 async close(){this.closed=true;for(const c of this.active)c.abort();await Promise.allSettled([...this.pending]);}
 async response(sourceId:string,path:string,body:unknown,signal:AbortSignal){
  let input:ReturnType<typeof parseCodeBuddyInput>;
  try{input=parseCodeBuddyInput(path,body);}catch(error){
   const fields=error instanceof z.ZodError?[...new Set(error.issues.map(issue=>issue.path.join('.')).filter(path=>/^[a-zA-Z][a-zA-Z0-9_.]{0,100}$/.test(path)))].slice(0,5):[];
   return Response.json({error:{type:'invalid_request_error',code:'workbuddy_invalid_request',fields,message:'WorkBuddy SDK 无法处理此请求格式，请检查消息、图片和工具定义。'}},{status:400});
  }
  if(!input.stream)return this.buffered(sourceId,path,body,signal,input);
  const controller=new AbortController(),cancel=()=>controller.abort();signal.addEventListener('abort',cancel,{once:true});if(signal.aborted)cancel();
  const encoder=new TextEncoder();let closed=false;
  const stream=new ReadableStream<Uint8Array>({start:output=>{
   const send=(text:string)=>{if(!closed)output.enqueue(encoder.encode(text));};
   const failed=(error:{type?:string;code?:string;message?:string})=>{
    const detail={code:error.code??error.type??'workbuddy_sdk_error',message:error.message??'WorkBuddy SDK 请求未完成。'};
    if(path==='responses')send(`event: response.failed\ndata: ${JSON.stringify({type:'response.failed',sequence_number:0,response:{id:`resp_workbuddy_${randomUUID().replaceAll('-','')}`,object:'response',created_at:Math.floor(Date.now()/1000),status:'failed',model:input.model,output:[],error:detail}})}\n\n`);
    else send(`event: error\ndata: ${JSON.stringify({type:'error',error:{type:detail.code,message:detail.message}})}\n\n`);
   };
   send(': codebuddy-sdk\n\n');const heartbeat=setInterval(()=>send(': waiting\n\n'),10000);
   void (async()=>{try{
    const response=await this.buffered(sourceId,path,body,controller.signal,input);
    if(!response.ok){const value=await response.json();failed(value.error);}
    else if(response.body){const reader=response.body.getReader();try{for(;;){const chunk=await reader.read();if(chunk.done)break;if(!closed)output.enqueue(chunk.value);}}finally{reader.releaseLock();}}
   }catch{if(!controller.signal.aborted)failed({type:'workbuddy_sdk_error',message:'WorkBuddy SDK 连接中断，请重试。'});}
   finally{clearInterval(heartbeat);signal.removeEventListener('abort',cancel);if(!closed){closed=true;output.close();}}
   })();
   controller.signal.addEventListener('abort',()=>{clearInterval(heartbeat);if(!closed){closed=true;output.close();}},{once:true});
  },cancel:()=>{closed=true;controller.abort();}});
  return new Response(stream,{headers:{'Content-Type':'text/event-stream','X-Token-Flow-Transport':'codebuddy-agent-sdk'}});
 }
 private async buffered(sourceId:string,path:string,body:unknown,signal:AbortSignal,input:ReturnType<typeof parseCodeBuddyInput>){
  if(!input.model.startsWith('workbuddy/'))throw new Error('WorkBuddy model scope mismatch');
  const controller=new AbortController();const abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted||this.closed)abort();this.active.add(controller);
  let finish!:()=>void;const pending=new Promise<void>(done=>{finish=done;});this.pending.add(pending);
  const deadline=setTimeout(()=>controller.abort(),240000);
  let directory:string|undefined;
  try{
   const credential=workbuddySDKCredential(await this.credential(sourceId,input.model));
   if(controller.signal.aborted)throw new Error('Cancelled');
   await mkdir(join(this.root,'workbuddy-sdk-runs'),{recursive:true,mode:0o700});directory=await mkdtemp(join(this.root,'workbuddy-sdk-runs','request-'));
   const cwd=join(directory,'workspace'),configDir=join(directory,'config');await mkdir(cwd);await mkdir(configDir,{mode:0o700});
   const model=input.model.slice('workbuddy/'.length).toLowerCase();
   const result=await this.run({...credential,model,prompt:input.prompt,images:input.images,tools:input.tools,parallelToolCalls:input.parallel_tool_calls,signal:controller.signal,cwd,configDir});
   if(controller.signal.aborted)throw new Error('Cancelled');
   if(result.failed&&result.errorCode==='source_policy_blocked')return Response.json({error:{type:'invalid_request_error',code:'a2a_source_policy_blocked',message:'WorkBuddy SDK upstream rejected the invocation channel (11128).'}},{status:400});
   if(result.failed&&result.errorCode==='authentication_error')return Response.json({error:{type:'authentication_error',message:'WorkBuddy 登录已失效，请重新授权所选账号。'}},{status:401});
   if(result.failed&&result.errorCode==='rate_limit_error')return Response.json({error:{type:'rate_limit_error',message:'WorkBuddy 来源限流，请稍后重试。'}},{status:429});
   if(result.failed||model!=='auto'&&result.model.toLowerCase()!==model)throw new Error('SDK request failed or model changed');
   if(input.required&&!result.calls.length)throw new Error('Required tool missing');
   if(input.parallel_tool_calls===false&&result.calls.length>1)throw new Error('SDK violated the single client tool limit');
   const calls=result.calls.map(call=>({...call,...input.toolIdentities.get(call.name),id:`call_${randomUUID().replaceAll('-','')}`}));
   // SDK input_tokens is already inclusive of cache read/write, unlike the
   // Anthropic wire format. Keep it inclusive for gateway accounting.
   const usage=result.usage?{input_tokens:result.usage.input_tokens,output_tokens:result.usage.output_tokens,cached_tokens:result.usage.cache_read_input_tokens??0,cache_write_tokens:result.usage.cache_creation_input_tokens??0}:undefined;
   const response=cursorResponse(path,input.model,result.text,usage,input.stream,calls,'workbuddy');
   response.headers.set('X-Token-Flow-Transport','codebuddy-agent-sdk');return response;
  }catch{return Response.json({error:{type:controller.signal.aborted?'request_cancelled':'workbuddy_sdk_error',message:controller.signal.aborted?'请求已取消。':'WorkBuddy 官方 SDK 请求未完成，请检查所选账号、模型和网络后重试。'}},{status:controller.signal.aborted?499:502});}
  finally{clearTimeout(deadline);signal.removeEventListener('abort',abort);this.active.delete(controller);try{if(directory)await rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:100});}finally{this.pending.delete(pending);finish();}}
 }
}
