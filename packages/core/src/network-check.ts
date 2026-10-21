import {safeFailure} from './login/diagnostics.js';

export const networkTargets=[
  {id:'codex-auth',label:'Codex 授权服务',url:'https://auth.openai.com/.well-known/openid-configuration'},
  {id:'codex-api',label:'Codex 账号服务',url:'https://chatgpt.com/backend-api/wham/usage'},
  {id:'cursor-api',label:'Cursor 模型服务',url:'https://api2.cursor.sh/'},
  {id:'qoder-api',label:'Qoder 模型服务',url:'https://api2.qoder.sh/'},
  {id:'workbuddy-auth',label:'WorkBuddy 国内版授权服务',url:'https://copilot.tencent.com/login'},
  {id:'workbuddy-international-auth',label:'WorkBuddy 国际版授权服务',url:'https://www.workbuddy.ai/login'},
] as const;
export type NetworkCheckResult={target:string;host:string;via:'local'|'app'|'gateway';reachable:boolean;elapsedMs:number;httpStatus?:number;code:string;message:string};
export type NetworkCheckReport={checkedAt:string;results:NetworkCheckResult[]};
type Options={port:number;key:string;managementKey:string;signal?:AbortSignal;fetch?:typeof fetch;timeoutMs?:number;log:(message:string)=>void};

async function smallJSON(response:Response):Promise<Record<string,unknown>>{
  const reader=response.body?.getReader();if(!reader)return {};
  let text='',size=0;const decoder=new TextDecoder();
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>32768)throw new Error('Diagnostic response too large');text+=decoder.decode(value,{stream:true});}return JSON.parse(text+decoder.decode());}
  finally{await reader.cancel().catch(()=>{});}
}

/** Fixed public endpoints only. No OAuth attempt, account token, cookies or model call. */
export async function checkNetwork(options:Options):Promise<NetworkCheckReport>{
  const fetcher=options.fetch??fetch,checkedAt=new Date().toISOString();
  options.log('网络检查开始：检测本机网关、应用出站和网关出站；不使用账号凭据。');
  const probe=async(target:string,url:string,via:NetworkCheckResult['via']):Promise<NetworkCheckResult>=>{
    const started=Date.now(),timeout=AbortSignal.timeout(options.timeoutMs??10000),signal=options.signal?AbortSignal.any([options.signal,timeout]):timeout;
    const base={target,host:new URL(url).hostname,via};
    let result:NetworkCheckResult;
    try{
      let status:number;
      if(via==='gateway'){
        const response=await fetcher(`http://127.0.0.1:${options.port}/v0/management/api-call`,{method:'POST',headers:{authorization:`Bearer ${options.managementKey}`,'content-type':'application/json'},body:JSON.stringify({method:'HEAD',url,header:{},data:''}),signal,redirect:'error'});
        const data=await smallJSON(response);
        if(!response.ok)throw new Error(typeof data.error==='string'?data.error:`Local gateway HTTP ${response.status}`);
        if(typeof data.status_code!=='number'||!Number.isInteger(data.status_code)||data.status_code<100||data.status_code>599)throw new Error('Invalid diagnostic response');
        status=data.status_code;
      }else{
        const response=await fetcher(url,{method:via==='local'?'GET':'HEAD',...(via==='local'?{headers:{authorization:`Bearer ${options.key}`}}:{}),credentials:'omit',signal,redirect:'manual'});
        status=response.status;await response.body?.cancel();
      }
      const bridgeError=status>=590&&status<=599;
      result={...base,reachable:!bridgeError,elapsedMs:Date.now()-started,httpStatus:status,code:bridgeError?'proxy_transport':status>=400?'http_response':'reachable',message:bridgeError?'本机代理桥接失败，尚未取得目标服务响应':via==='local'?(status===200?'本机网关已响应并通过认证':'本机网关已响应，但接口或认证异常'):status>=400?'目标服务已返回 HTTP 响应；状态可能来自权限限制或防护页面，不能据此判断授权成功':'目标服务已响应；仅验证连通性，未验证账号授权'};
    }catch(error){const failure=safeFailure(timeout.aborted?'timeout':options.signal?.aborted?'check cancelled':error);result={...base,reachable:false,elapsedMs:Date.now()-started,code:failure.code,message:failure.reason,...(failure.httpStatus?{httpStatus:failure.httpStatus}:{})};}
    const route=via==='local'?'本机':via==='app'?'应用出站':'网关出站';
    options.log(`网络检查 · ${target} · ${route} · ${result.reachable?'已响应':'未连通'}${result.httpStatus?` HTTP ${result.httpStatus}`:''} · ${result.elapsedMs}ms · ${result.code} · ${result.message}`);
    return result;
  };
  const results=await Promise.all([probe('本机网关',`http://127.0.0.1:${options.port}/v1/models`,'local'),...networkTargets.flatMap(target=>[probe(target.label,target.url,'app'),probe(target.label,target.url,'gateway')])]);
  options.log(`网络检查完成：${results.filter(r=>r.reachable).length}/${results.length} 条链路收到响应。HTTP 401/403 仅表示已收到响应，不代表授权可用。`);
  return {checkedAt,results};
}
