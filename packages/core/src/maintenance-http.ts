import {z} from 'zod';
import {targetSchema} from './agent-connections.js';

export const modelProbeInput=z.object({sourceId:z.string().regex(/^[a-f0-9]{24}$/).optional(),model:z.string().min(1).max(300).optional(),target:targetSchema.optional(),protocol:z.enum(['responses','messages','chat/completions']).optional()}).strict();
export type ModelProbeInput=z.infer<typeof modelProbeInput>;
export type ProbeProtocol='responses'|'messages'|'chat/completions';
/** Classify known transport codes only. Never return error messages, URLs or credentials. */
export function networkFailure(error:unknown):'dns'|'tls'|'connection_refused'|'connection_reset'|'timeout'|'network_unknown'{
 let value=error;
 for(let i=0;i<5&&value&&typeof value==='object';i++){
  const e=value as {code?:unknown;name?:unknown;cause?:unknown};const code=String(e.code??'');
  if(['ENOTFOUND','EAI_AGAIN','EAI_FAIL'].includes(code))return 'dns';
  if(/^(CERT_|ERR_TLS_|ERR_SSL_)/.test(code)||['UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_GET_ISSUER_CERT_LOCALLY'].includes(code))return 'tls';
  if(code==='ECONNREFUSED')return 'connection_refused';
  if(['ECONNRESET','EPIPE','UND_ERR_SOCKET'].includes(code))return 'connection_reset';
  if(['ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT'].includes(code)||e.name==='TimeoutError')return 'timeout';
  value=e.cause;
 }
 return 'network_unknown';
}
const knownCodes=new Set(['source_policy_blocked','a2a_source_policy_blocked','source_unavailable','model_unavailable','api_model_unavailable','model_not_allowed','key_quota_error','source_cooldown','region_not_supported','upstream_idle_timeout','upstream_timeout','authentication_error','invalid_request_error','unsupported_feature','upstream_protocol_error','source_model_error','provider_error']);
function failureKind(status:number,code:string|undefined){
 if(status>=300&&status<400)return 'redirect';
 if(code==='source_policy_blocked'||code==='a2a_source_policy_blocked')return 'source_policy';
 if(code==='region_not_supported')return 'region_restriction';
 if(code==='source_unavailable'||code==='model_unavailable'||code==='api_model_unavailable'||code==='source_cooldown')return 'source_unavailable';
 if(code==='upstream_idle_timeout'||code==='upstream_timeout'||status===408||status===504)return 'timeout';
 if(status===401||code==='authentication_error')return 'authentication';
 if(status===403||code==='model_not_allowed')return 'permission';
 if(status===429||code==='key_quota_error')return 'rate_or_quota';
 if(status===404)return 'model_or_endpoint';
 if(status===400||status===422||code==='invalid_request_error'||code==='unsupported_feature')return 'request_compatibility';
 if(status>=500)return 'upstream_or_gateway';
 return 'response_error';
}

/** Fixed, tiny streaming request. The caller supplies only a trusted local transport. */
export async function probeModelHTTP(protocol:ProbeProtocol,model:string,request:(body:object,signal:AbortSignal)=>Promise<Response>,signal:AbortSignal,timeoutMs=30000){
 const started=Date.now();let httpStatus:number|undefined,headersMs:number|undefined,firstOutputMs:number|undefined,bytes=0,outputChars=0,complete=false,failed=false,code:string|undefined;
 const timeout=AbortSignal.timeout(timeoutMs),combined=AbortSignal.any([signal,timeout]);
 const body=protocol==='responses'?{model,input:'Reply OK only.',stream:true,store:false,max_output_tokens:128}:protocol==='messages'?{model,messages:[{role:'user',content:'Reply OK only.'}],stream:true,max_tokens:128}:{model,messages:[{role:'user',content:'Reply OK only.'}],stream:true,max_tokens:128};
 const evidence=(category:string)=>({passed:category==='passed',category,protocol,httpStatus,headersMs,firstOutputMs,durationMs:Date.now()-started,deadlineMs:timeoutMs,outputChars,complete,...(code?{code}:{}),scope:'固定短文本请求，最多 128 输出 Token；可能计入来源用量。未验证长对话、工具、图片、客户端登录或原 Key。',interpretation:category==='upstream_or_gateway'?'收到网关或上游错误；仅凭 HTTP 状态不能断定供应商故障。':category==='timeout'?'诊断时限内未完成；结合响应阶段与网络检查判断，不能据此断定供应商故障。':undefined});
 const output=(text:unknown)=>{if(typeof text==='string'&&text.length){firstOutputMs??=Date.now()-started;outputChars+=text.length;}};
 const event=(value:any)=>{
  if(value?.error||value?.response?.error||value?.type==='response.failed'||value?.type==='error'){failed=true;const candidate=value?.error?.code??value?.error?.type??value?.response?.error?.code;code=knownCodes.has(candidate)?candidate:undefined;}
  if(protocol==='responses'){
   if(value?.type==='response.output_text.delta')output(value.delta);
   if(value?.type==='response.completed'||value?.status==='completed'){
    complete=true;if(!outputChars)for(const item of (value.response??value).output??[])for(const part of item.content??[])if(part.type==='output_text')output(part.text);
   }
   if(value?.type==='response.incomplete'||value?.status==='incomplete')failed=true;
  }else if(protocol==='messages'){
   if(value?.delta?.type==='text_delta')output(value.delta.text);
   if(value?.type==='message_stop')complete=true;
   if(value?.type==='message'&&value.stop_reason){complete=true;for(const part of value.content??[])if(part.type==='text')output(part.text);}
  }else{
   for(const choice of value?.choices??[]){output(choice.delta?.content??choice.message?.content);if(choice.finish_reason)complete=true;}
  }
 };
 try{
  combined.throwIfAborted();const response=await request(body,combined);httpStatus=response.status;headersMs=Date.now()-started;
  const reader=response.body?.getReader();if(!reader)return evidence(response.ok?'incomplete':failureKind(response.status,code));
  const decoder=new TextDecoder(),sse=(response.headers.get('content-type')??'').includes('text/event-stream');let pending='';
  const frame=(text:string)=>{const data=text.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');if(!data||data==='[DONE]')return;try{event(JSON.parse(data));}catch{failed=true;}};
  try{
   while(true){combined.throwIfAborted();const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024)return evidence('response_limit');pending+=decoder.decode(part.value,{stream:true});
    if(sse){pending=pending.replace(/\r\n/g,'\n');let end;while((end=pending.indexOf('\n\n'))>=0){frame(pending.slice(0,end));pending=pending.slice(end+2);}}
   }
   pending+=decoder.decode();if(sse){if(pending.trim())frame(pending);}else{try{event(JSON.parse(pending));}catch{failed=true;}}
  }finally{await reader.cancel().catch(()=>{});}
  if(!response.ok||failed)return evidence(failureKind(response.ok?200:response.status,code));
  return evidence(complete&&outputChars?'passed':'incomplete');
 }catch(error){return evidence(signal.aborted?'cancelled':timeout.aborted?'timeout':networkFailure(error));}
}
