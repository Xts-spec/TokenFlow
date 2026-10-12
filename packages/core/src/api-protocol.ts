import { providerSchema } from './providers.js';
import { RunnerCoreError } from './errors.js';

export type SourceProtocol='responses'|'chat'|'messages';
const PATHS:Record<SourceProtocol,string>={responses:'responses',chat:'chat/completions',messages:'messages'};
const ENDPOINT_SUFFIX=/\/(?:chat\/completions|responses|messages|models)\/?$/;
const bad=(message:string,code='api_source_invalid')=>new RunnerCoreError(message,{statusCode:400,code});

/** Cheap shape checks that never touch the network. */
export function validateQuickSource(input:{baseURL:string;apiKey?:string;model:string}){
 const trimmed=input.baseURL.trim().replace(ENDPOINT_SUFFIX,'').replace(/\/+$/,'');
 const url=providerSchema.shape.baseURL.safeParse(trimmed);
 if(!url.success)throw bad(url.error.issues[0]?.message??'请输入完整的 API 地址，例如 https://api.example.com/v1。');
 const key=input.apiKey?.trim();
 if(key!==undefined&&(!key||key.length>4096||/\s/.test(key)))throw bad('API Key 格式不正确：不能为空、包含空白或换行。');
 const models=[...new Set(input.model.split(/[\n,，]/).map(m=>m.trim()).filter(Boolean))];
 if(!models.length)throw bad('请填写模型名称。');
 if(models.length>50||models.some(m=>m.length>200||/[\x00-\x1f\x7f]/.test(m)))throw bad('模型名称格式不正确：每个最多 200 个字符，且不能含控制字符。');
 return {baseURL:url.data,models};
}

type Probe={ok:boolean;status:number|null;message:string};
const clip=(value:string,key:string)=>(key.length>=8?value.split(key).join('***'):value).replace(/\s+/g,' ').slice(0,160);
async function readLimited(response:Response,limit=256*1024){
 const reader=response.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();break;}chunks.push(value);}
 return Buffer.concat(chunks).toString('utf8');
}
const shapes:Record<SourceProtocol,(json:Record<string,unknown>)=>boolean>={
 responses:json=>json.object==='response'||Array.isArray(json.output),
 chat:json=>Array.isArray(json.choices),
 messages:json=>json.type==='message'||Array.isArray(json.content),
};
function request(protocol:SourceProtocol,model:string,key:string,tokenField='max_tokens'):{headers:Record<string,string>;body:Record<string,unknown>}{
 const prompt='Reply OK only.';
 if(protocol==='responses')return {headers:{Authorization:`Bearer ${key}`},body:{model,input:prompt,max_output_tokens:16,store:false}};
 if(protocol==='chat')return {headers:{Authorization:`Bearer ${key}`},body:{model,messages:[{role:'user',content:prompt}],[tokenField]:16}};
 return {headers:{'x-api-key':key,'anthropic-version':'2023-06-01'},body:{model,max_tokens:16,messages:[{role:'user',content:prompt}]}};
}
async function probe(protocol:SourceProtocol,base:string,key:string,model:string,signal:AbortSignal):Promise<Probe>{
 for(const tokenField of protocol==='chat'?['max_tokens','max_completion_tokens']:['']){
  const {headers,body}=request(protocol,model,key,tokenField||undefined);
  let response:Response;
  try{response=await fetch(`${base}/${PATHS[protocol]}`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),redirect:'error'});}
  catch{return {ok:false,status:null,message:signal.aborted?'已取消验证。':'无法连接或超时，请检查网络和 API 地址。'};}
  const text=await readLimited(response).catch(()=> '');
  let json:Record<string,unknown>={};try{json=JSON.parse(text);}catch{/* Non-JSON bodies are a mismatch, not a crash. */}
  if(response.ok)return shapes[protocol](json)?{ok:true,status:response.status,message:''}:{ok:false,status:response.status,message:'返回内容不是该协议的格式。'};
  const error=json.error as {message?:unknown}|string|undefined;
  const message=clip(typeof error==='string'?error:typeof error?.message==='string'?error.message:typeof json.message==='string'?json.message:'',key);
  // Some newer models only accept the other token-limit field; try it once before giving up on Chat.
  if(protocol==='chat'&&response.status===400&&tokenField==='max_tokens'&&/max_completion_tokens|max_tokens/.test(message))continue;
  // Rate limits prove the endpoint exists and the key is recognised.
  if(response.status===429)return {ok:true,status:429,message};
  return {ok:false,status:response.status,message};
 }
 return {ok:false,status:400,message:''};
}

/** Sends one tiny request per candidate protocol until one answers in the expected shape. */
export async function detectProtocol(input:{baseURL:string;apiKey:string;model:string},signal:AbortSignal=new AbortController().signal):Promise<{protocol:SourceProtocol;baseURL:string}>{
 const {baseURL,models}=validateQuickSource(input);const model=models[0];
 const hinted=/anthropic|claude/i.test(`${baseURL} ${model}`);
 const order:SourceProtocol[]=hinted?['messages','chat','responses']:['responses','chat','messages'];
 // A bare host such as https://api.example.com usually means /v1.
 const bases=new URL(baseURL).pathname.replace(/\/+$/,'')===''?[`${baseURL}/v1`,baseURL]:[baseURL];
 const failures:Probe[]=[];
 for(const base of bases)for(const protocol of order){
  const result=await probe(protocol,base,input.apiKey.trim(),model,signal);
  if(result.ok)return {protocol,baseURL:base};
  if(result.status===null)throw bad(result.message,'api_source_unreachable');
  failures.push(result);
 }
 const auth=failures.find(f=>f.status===401||f.status===403);
 if(auth)throw bad(`API Key 无效或没有权限（HTTP ${auth.status}）。${auth.message}`,'api_source_auth');
 const rejected=failures.find(f=>f.status===400||f.status===422);
 if(rejected)throw bad(`接口已响应但拒绝了请求，请检查模型名称。${rejected.message}`,'api_source_rejected');
 throw bad('没有找到可用的接口。请检查 URL（通常以 /v1 结尾）；支持 OpenAI Responses、Chat Completions 和 Anthropic Messages。','api_source_not_found');
}

export function sourceNameFromURL(baseURL:string){
 const url=new URL(baseURL);
 if(['127.0.0.1','localhost','[::1]'].includes(url.hostname))return `本机 ${url.port||'服务'}`.slice(0,80);
 return url.hostname.replace(/^(?:api|www)\./,'').slice(0,80);
}
