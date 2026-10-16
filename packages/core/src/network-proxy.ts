import {randomBytes} from 'node:crypto';
import {Server} from 'proxy-chain';
import {EnvHttpProxyAgent, getGlobalDispatcher, setGlobalDispatcher} from 'undici';
import {safeFailure} from './login/diagnostics.js';

export type SystemProxyResolver=(url:string)=>Promise<string>;
export type NetworkSnapshot={mode:'system'|'environment'|'direct';loopback:'direct';routes:Array<{at:string;host:string;route:'system_proxy'|'environment_proxy'|'direct';protocol?:string;error?:string}>};
const proxyVariables=['http_proxy','HTTP_PROXY','https_proxy','HTTPS_PROXY','all_proxy','ALL_PROXY','no_proxy','NO_PROXY'] as const;

export function isLoopback(hostname:string){
  const host=hostname.toLowerCase().replace(/^\[|\]$/g,'').replace(/\.$/,'');
  return host==='localhost'||host.endsWith('.localhost')||host==='::1'||/^127\./.test(host)||/^::ffff:7f[0-9a-f]{2}:/.test(host)||host.startsWith('::ffff:127.');
}

function proxyURL(value:string){
  const url=new URL(value.includes('://')?value:`http://${value}`);
  if(!['http:','https:','socks:','socks4:','socks4a:','socks5:','socks5h:'].includes(url.protocol)||!url.hostname||url.pathname!=='/'&&url.pathname!==''||url.search||url.hash)throw new Error('代理地址无效，请检查网络代理设置。');
  return url.href;
}

/** undefined means no environment override; an empty string means explicitly direct. */
export function environmentProxy(url:URL,env:NodeJS.ProcessEnv):string|undefined{
  if(isLoopback(url.hostname))return '';
  const bypass=(env.no_proxy||env.NO_PROXY||'').toLowerCase().split(/[\s,]+/).filter(Boolean);
  const hostname=url.hostname.toLowerCase(),port=url.port||(url.protocol==='https:'?'443':'80');
  for(const entry of bypass){
    if(entry==='*')return '';
    const match=entry.match(/^(.*):(\d+)$/),host=(match?match[1]:entry).replace(/^\*?\./,'');
    if(match&&match[2]!==port)continue;
    if(hostname===host||hostname.endsWith(`.${host}`))return '';
  }
  const scheme=url.protocol==='https:'?'https':'http';
  const value=env[`${scheme}_proxy`]||env[`${scheme.toUpperCase()}_PROXY`]||env.all_proxy||env.ALL_PROXY;
  return value?proxyURL(value.trim()):undefined;
}

/** Chromium resolves OS proxy settings, PAC and per-domain bypass rules. */
export function systemProxy(result:string){
  for(const entry of result.split(';')){
    const [kind,address]=entry.trim().split(/\s+/);
    if(kind==='DIRECT')return '';
    const scheme=({PROXY:'http',HTTP:'http',HTTPS:'https',SOCKS:'socks4',SOCKS4:'socks4',SOCKS5:'socks5h'} as Record<string,string>)[kind];
    if(scheme&&address)return proxyURL(`${scheme}://${address}`);
  }
  throw new Error('无法识别系统代理设置，请检查代理软件。');
}

export async function createNetworkProxy(resolveSystemProxy?:SystemProxyResolver,environment:NodeJS.ProcessEnv=process.env){
  // Keep the original proxy settings separate from the authenticated internal bridge.
  const env=Object.fromEntries(proxyVariables.map(name=>[name,environment[name]]));
  const password=randomBytes(32).toString('hex');
  const routes:NetworkSnapshot['routes']=[];
  const mode:NetworkSnapshot['mode']=proxyVariables.filter(name=>!name.toLowerCase().startsWith('no_')).some(name=>env[name])?'environment':resolveSystemProxy?'system':'direct';
  const remember=(entry:NetworkSnapshot['routes'][number])=>{routes.push(entry);if(routes.length>30)routes.shift();};
  const server=new Server({host:'127.0.0.1',port:0,verbose:false,prepareRequestFunction:async({request,username,password:provided,hostname,port,isHttp})=>{
    if(username!=='tokenflow'||provided!==password)return {requestAuthentication:true};
    const host=hostname.includes(':')?`[${hostname.replace(/^\[|\]$/g,'')}]`:hostname;
    const url=new URL(isHttp?request.url!:`https://${host}:${port}/`);
    if(isLoopback(url.hostname))return {};
    const entry:NetworkSnapshot['routes'][number]={at:new Date().toISOString(),host:url.hostname,route:'direct'};
    try{
      let upstream=environmentProxy(url,env);
      if(upstream)entry.route='environment_proxy';
      if(upstream===undefined&&resolveSystemProxy){
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{
        const result=await Promise.race([resolveSystemProxy(url.href),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('系统代理读取超时')),5000);})]);
        upstream=systemProxy(result);
        if(upstream)entry.route='system_proxy';
      }finally{clearTimeout(timer);}
      }
      if(upstream)entry.protocol=new URL(upstream).protocol.replace(':','');
      remember(entry);
      return {upstreamProxyUrl:upstream||undefined,customTag:entry};
    }catch(error){entry.error=safeFailure(error).code;remember(entry);throw new Error('Network proxy resolution failed');}
  }});
  // Never log raw proxy errors, request URLs or authorization headers.
  server.on('requestFailed',()=>{});
  server.on('tunnelConnectFailed',({customTag,response})=>{if(customTag&&routes.includes(customTag))customTag.error=response?.statusCode===407?'proxy_auth':'proxy_tunnel';});
  await server.listen();
  const url=`http://tokenflow:${password}@127.0.0.1:${server.port}`;
  let dispatcher:EnvHttpProxyAgent|undefined;
  let previous:ReturnType<typeof getGlobalDispatcher>|undefined;
  return {
    url,
    snapshot:():NetworkSnapshot=>({mode,loopback:'direct',routes:structuredClone(routes)}),
    installFetch(){
      if(dispatcher)return;
      previous=getGlobalDispatcher();
      dispatcher=new EnvHttpProxyAgent({httpProxy:url,httpsProxy:url,noProxy:'localhost,127.0.0.1,[::1]',proxyTunnel:false});
      setGlobalDispatcher(dispatcher);
    },
    async close(){
      if(dispatcher&&getGlobalDispatcher()===dispatcher&&previous)setGlobalDispatcher(previous);
      await dispatcher?.destroy();
      await server.close(true);
    },
  };
}
