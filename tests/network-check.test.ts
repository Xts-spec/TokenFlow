import {expect,it,vi} from 'vitest';
import {checkNetwork,networkTargets} from '../packages/core/src/network-check.js';
import {safeFailure,loginFailure} from '../packages/core/src/login/diagnostics.js';
import {gatewayDiagnostics} from '../apps/console/src/gateway-diagnostics.js';
import {CLIProxyManager} from '../packages/core/src/cliproxy.js';

it('checks app and real-gateway paths separately and never sends account credentials to public endpoints',async()=>{
  const calls:Array<{url:string;init:RequestInit|undefined}>=[],logs:string[]=[];
  const fetcher:typeof fetch=async(input,init)=>{
    const url=String(input);calls.push({url,init});
    if(url.includes('/api-call')){
      const body=JSON.parse(String(init?.body));expect(body).toEqual({method:'HEAD',url:expect.any(String),header:{},data:''});
      expect(networkTargets.some(t=>t.url===body.url)).toBe(true);
      return Response.json({status_code:403,body:'must-not-copy-this-body',header:{}});
    }
    return new Response(null,{status:url.includes('127.0.0.1')?200:401});
  };
  const report=await checkNetwork({port:8317,key:'internal-key',managementKey:'private-management-key',fetch:fetcher,log:line=>logs.push(line)});
  expect(report.results).toHaveLength(7);expect(report.results.every(r=>r.reachable)).toBe(true);
  expect(report.results.filter(r=>r.via==='gateway').every(r=>r.httpStatus===403&&r.code==='http_response')).toBe(true);
  for(const {url,init} of calls.filter(c=>!c.url.includes('127.0.0.1'))){expect(init?.headers).toBeUndefined();expect(init?.method).toBe('HEAD');expect(init?.credentials).toBe('omit');expect(url).not.toContain('?');}
  expect(JSON.stringify({report,logs})).not.toMatch(/must-not-copy|private-management|internal-key/);
  expect(logs).toHaveLength(9);
});

it('reports DNS, TLS and transport timeouts without reflecting raw upstream data',async()=>{
  const fetcher:typeof fetch=async(input,init)=>{
    if(String(input).includes('/api-call'))return Response.json({error:'token exchange request failed: x509: unknown authority secret-token https://auth.openai.com/?code=secret-code'},{status:502});
    if(String(input).includes('127.0.0.1'))return new Response(null,{status:200});
    throw new Error('fetch failed',{cause:new Error('getaddrinfo ENOTFOUND private-host secret-token')});
  };
  const logs:string[]=[];
  const report=await checkNetwork({port:8317,key:'key',managementKey:'management',fetch:fetcher,log:s=>logs.push(s)});
  expect(report.results.filter(r=>r.via==='app').every(r=>!r.reachable&&r.code==='dns')).toBe(true);
  expect(report.results.filter(r=>r.via==='gateway').every(r=>!r.reachable&&r.code==='tls')).toBe(true);
  expect(JSON.stringify({report,logs})).not.toMatch(/secret-|private-host|code=/);
  expect(safeFailure('context deadline exceeded')).toMatchObject({code:'timeout'});
  expect(safeFailure('未知密钥类型')).toMatchObject({code:'credential_store_key'});
  expect(loginFailure('Failed to exchange authorization code for tokens: token exchange failed with status 403: {"token":"secret"}','callback')).toMatchObject({stage:'token_exchange',code:'http',httpStatus:403});
  expect(loginFailure('Failed to save authentication tokens','device_poll').stage).toBe('saving_credentials');
});

it('bounds hung probes and does not treat proxy bridge errors as an origin response',async()=>{
  const fetcher:typeof fetch=async(input,init)=>{
    if(String(input).includes('/api-call'))return Response.json({status_code:595,body:'',header:{}});
    return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('timeout')),{once:true}));
  };
  const report=await checkNetwork({port:8317,key:'key',managementKey:'management',fetch:fetcher,timeoutMs:10,log:()=>{}});
  expect(report.results.every(r=>!r.reachable)).toBe(true);
  expect(report.results.filter(r=>r.via==='gateway').every(r=>r.code==='proxy_transport')).toBe(true);
  expect(report.results.filter(r=>r.via!=='gateway').every(r=>r.code==='timeout')).toBe(true);
});

it('copies diagnostic state without account email, OAuth URLs or user codes',()=>{
  const manager=new CLIProxyManager('/unused','/unused','never-copy-key');
  const local=manager.snapshot();
  local.accounts.push({id:'private-id',provider:'codex',label:'private@example.test',status:'active',disabled:false,unavailable:false});
  local.login={id:'private-session',provider:'codex',flow:'callback',status:'failed',message:'交换凭据失败',url:'https://auth.openai.com/?state=private-state',userCode:'private-code',diagnostic:{stage:'token_exchange',code:'timeout',reason:'连接超时'}};
  const copied=JSON.stringify(gatewayDiagnostics(local,'test','win32'));
  expect(copied).toContain('token_exchange');expect(copied).toContain('"codex":1');
  expect(copied).not.toMatch(/private-|private@|never-copy/);
});
