import { useCallback, useEffect, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { AgentConnections } from '../../../packages/core/src/agent-connections';
import { requestJSON } from './request';
import { sourceOptions } from './source-options';

export type LoginProvider='codex'|'claude'|'antigravity';
export const loginNames:Record<LoginProvider,string>={codex:'Codex',claude:'Claude Code',antigravity:'Antigravity'};
type Status={revision:string;email?:string|null;accountId?:string|null;model?:string|null;pids:number[];backup:{state:string}|null;gatewayConnected:boolean;
 accounts:{id:string;email?:string|null;accountId?:string|null;switchable:boolean;reason:string}[]};
export type LoginAccount={id:string;label:string;remaining:number|null;models:string[];switchable:boolean;reason:string;current:boolean};

const post=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const base=(provider:LoginProvider)=>provider==='codex'?'/api/codex-accounts':`/api/native-accounts/${provider}`;
const usable=(provider:LoginProvider,models:string[])=>provider==='codex'?models.filter(m=>!/(?:gpt-image-|codex-auto-review)/.test(m)):models;

/** The client's own login (not token-flow): which pooled account it is signed in as, and switching between them. */
export function useNativeLogin(provider:LoginProvider,local:LocalAgentSnapshot){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');
 const refresh=useCallback(async()=>{try{setStatus(await requestJSON<Status>(base(provider)));setError('');}catch(e){setError(e instanceof Error?e.message:'读取失败');}},[provider]);
 const pooled=sourceOptions(local).filter(a=>a.provider===provider);
 const version=pooled.map(a=>a.id).join(',');
 useEffect(()=>{setStatus(undefined);void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>clearInterval(timer);},[refresh,version]);

 const accounts:LoginAccount[]=pooled.map(a=>{
  const credential=status?.accounts.find(item=>item.id===a.id);
  const current=!!status&&!status.gatewayConnected&&!!credential&&(provider==='codex'?!!status.accountId&&credential.accountId===status.accountId&&(!credential.email||!status.email||credential.email===status.email):!!status.email&&credential.email===status.email);
  return {id:a.id,label:a.label,remaining:a.remaining,models:usable(provider,a.models),switchable:!!credential?.switchable,reason:credential?.reason??'',current};
 });
 const current=accounts.find(a=>a.current);

 // A client routed through token-flow ignores its own login, so switching first restores its original config.
 const releaseGateway=async()=>{
  if(provider==='antigravity')return;
  const targets=(await requestJSON<{targets:Awaited<ReturnType<AgentConnections['status']>>}>('/api/a2a')).targets;
  const target=targets.find(t=>t.id===provider);
  if(target?.connection)await requestJSON('/api/a2a/restore',post({id:target.connection.id,revision:target.revision,allowRunning:true}),600000);
 };
 const switchTo=async(id:string,restartCodex=false)=>{
  const account=accounts.find(a=>a.id===id);if(!account)throw new Error('账号已不可用，请刷新。');
  let latest=await requestJSON<Status>(base(provider));
  const preferred=`${provider}/${latest.model}`;
  const model=account.models.includes(preferred)?preferred:account.models[0];
  // Only Codex can switch while running; check before releasing the gateway so a refused switch keeps the Agent connected.
  if(provider!=='codex'&&latest.pids.length)throw new Error(`请先完全退出 ${loginNames[provider]}，再切换本机登录。`);
  if(provider!=='antigravity'&&!model)throw new Error('这个账号还没有可用模型，请先刷新账号。');
  const released=latest.gatewayConnected;
  if(released&&provider!=='codex'){await releaseGateway();latest=await requestJSON<Status>(base(provider));}
  const body=provider==='codex'?{revision:latest.revision,allowRunning:true,restartCodex,sourceId:id,model}:provider==='claude'?{revision:latest.revision,sourceId:id,...(model?{model}:{})}:{revision:latest.revision,sourceId:id};
  setStatus(await requestJSON<Status>(`${base(provider)}/switch`,post(body),provider==='codex'?600000:20000));
  return released?`已先断开 token-flow 接入，${loginNames[provider]} 现在直接使用自己的登录。`:'';
 };
 const restore=async()=>{
  const latest=await requestJSON<Status>(base(provider));
  setStatus(await requestJSON<Status>(`${base(provider)}/restore`,post(provider==='codex'?{revision:latest.revision,allowRunning:true}:{revision:latest.revision}),provider==='codex'?600000:20000));
 };
 return {status,error,accounts,current,refresh,switchTo,restore};
}
