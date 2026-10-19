import {safeFailure} from './login/diagnostics.js';
// Only known categories cross the gateway boundary. Never return raw provider
// messages: they can contain request content or credentials.
const known:Record<string,{message:string;type:string;wireMessage?:string}>={
 workbuddy_sdk_failed:{type:'provider_error',message:'WorkBuddy 官方 SDK 或上游请求失败，请稍后重试。'},
 workbuddy_output_failed:{type:'upstream_protocol_error',message:'WorkBuddy 返回的模型或工具调用不符合本次请求。'},
 workbuddy_credential_failed:{type:'authentication_error',message:'无法读取 WorkBuddy 账号授权，请检查账号状态。'},
 workbuddy_setup_failed:{type:'provider_error',message:'WorkBuddy 本地请求准备失败，请检查目录权限和空间。'},
 workbuddy_timeout:{type:'timeout_error',message:'WorkBuddy 请求超过等待时限，请稍后重试或缩短对话。'},
 a2a_parallel_tools_violated:{type:'upstream_protocol_error',message:'来源返回了多个工具调用，与本次单工具调用要求不符。'},
 a2a_invalid_request:{type:'invalid_request_error',message:'来源拒绝了本次请求的参数或工具定义。账号和模型配置仍保留；请检查请求兼容性，重新登录不能修复此类参数错误。',wireMessage:'The source rejected request parameters.'},
 a2a_source_policy_blocked:{type:'source_policy_blocked',message:'WorkBuddy 拒绝了本次请求所属的调用渠道（错误 11128：未获批准的调用渠道）。这是来源端的渠道授权错误；重写本地接口、Key 或重新登录不能解除。其他测试会话成功不代表当前客户端已恢复。',wireMessage:'The source rejected this invocation channel under its security policy.'},
 a2a_structured_output_unsupported:{type:'unsupported_feature',message:'该来源暂不支持严格 JSON 或 JSON Schema 输出。请使用普通文本，或选择支持结构化输出的来源。',wireMessage:'Structured output is not supported by this source adapter.'},
 a2a_server_tool_unsupported:{type:'unsupported_feature',message:'该来源支持客户端函数工具，暂不支持服务端内置工具。请关闭内置网页搜索等服务端工具，或选择支持它们的来源。',wireMessage:'This source supports client function/custom tools only; server-side or unknown tool types are not supported.'},
};
export function upstreamError(status:number,body:string):{code?:string;type:string;message:string}{
 let parsed:{error?:{code?:string;message?:string;fields?:unknown}}|undefined;try{parsed=JSON.parse(body);}catch{/* Non-JSON provider response. */}
 const code=typeof parsed?.error?.code==='string'?parsed.error.code:undefined;const message=typeof parsed?.error?.message==='string'?parsed.error.message:'';
 if(code==='workbuddy_invalid_request'){const fields=Array.isArray(parsed?.error?.fields)?parsed.error.fields.filter((field:unknown)=>typeof field==='string'&&/^(?:tools|input|messages|reasoning|model|stream|instructions|system|tool_choice|parallel_tool_calls|max_tokens|max_output_tokens|max_completion_tokens|reasoning_effort)(?:\.(?:[0-9]+|name|type|content|parameters|summary|effort))*$/.test(field)).slice(0,5):[];return {code,type:'invalid_request_error',message:`WorkBuddy 请求格式不兼容${fields.length?`（字段：${fields.join('、')}）`:''}。请保留此错误用于排查；切换账号或重写配置不能修复请求格式。`};}
 const entry=code&&Object.hasOwn(known,code)?[code,known[code]] as const:Object.entries(known).find(([,value])=>message===value.wireMessage);
 if(entry)return {code:entry[0],type:entry[1].type,message:entry[1].message};
 if(message.includes('User location is not supported for the API use'))return {code:'region_not_supported',type:'region_not_supported',message:'所选账号的上游服务不支持当前地区使用 API。请查看提供商的地区支持说明；重新登录不能解决此限制。'};
 if(status>=500&&/auth_unavailable|cooling down/.test(message))return {code:'source_cooldown',type:'source_unavailable',message:'所选来源因最近的上游错误暂时无法接收请求。网关会保留账号和模型配置；请稍后重试，持续失败时检查来源的实际调用错误。'};
 if(status>=500&&/^(qoder|workbuddy): (model response reported an error|upstream reported an error)/.test(message))return {code:'source_model_error',type:'provider_error',message:'来源服务在模型响应中返回错误，本次调用未完成。接口配置不代表调用成功；请缩短对话后重试或选择其他模型。'};
 const network=safeFailure(message);
 if(status>=500&&['tls','dns','timeout','connection_refused','connection_closed','proxy_auth','proxy'].includes(network.code))return {code:'upstream_'+network.code,type:'provider_error',message:`上游连接失败：${network.reason}。请检查系统代理、分流和 DNS；尚不能据此判断账号授权失效。`};
 return {type:'provider_error',message:`上游模型请求失败（HTTP ${status}）。请检查该来源的调用记录；重写客户端配置不一定能解决。`};
}
export async function readUpstreamError(response:Response){
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>65536)return '';chunks.push(part.value);}return Buffer.concat(chunks).toString('utf8');}
 finally{await reader.cancel().catch(()=>{});}
}
