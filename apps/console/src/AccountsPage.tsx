import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { GatewayUsage } from '../../../packages/core/src/gateway-activity';
import { QuotaDetails } from './QuotaDetails';
import { modelLabel } from './model-label';
import { usageOf, usageText } from './flow-model';
import { loginNames, useNativeLogin, type LoginProvider } from './native-login';
import { Icon } from './Icons';
import { ProviderIcon } from './ProviderIcon';
import type { Notify } from './notify';

const importable=new Set(['doubao','trae','workbuddy','zcode']);
const pendingStates=['starting','waiting_for_browser','verifying'];
const tabKey='token-flow.accounts.provider';

function navigateTabs(event:KeyboardEvent<HTMLDivElement>){
 const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));
 const index=tabs.indexOf(event.target as HTMLButtonElement);
 if(index<0||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
 event.preventDefault();
 const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
 tabs[next]?.focus();tabs[next]?.click();
}

export type AccountActions={
 refresh:(provider:string)=>Promise<void>;
 connect:(provider:string)=>Promise<void>;
 importLocal:(provider:string)=>Promise<void>;
 login:(action:'open'|'cancel'|'callback',data:{id:string;redirectURL?:string})=>Promise<void>;
 toggle:(id:string,enabled:boolean)=>Promise<void>;
 remove:(id:string)=>Promise<void>;
};

function LoginProgress({local,disabled,actions}:{local:LocalAgentSnapshot;disabled:boolean;actions:AccountActions}){
 const login=local.login;const [callback,setCallback]=useState('');const [dismissed,setDismissed]=useState('');
 useEffect(()=>setCallback(''),[login?.id,login?.status]);
 if(!login||login.status==='completed'||login.status==='idle'||dismissed===login.id)return null;
 const pending=pendingStates.includes(login.status);
 const label=local.providers.find(p=>p.id===login.provider)?.label??login.provider;
 return <div className="tfLogin" role="status">
  <div className="tfLoginHead"><strong>{label}{pending?' · 等待授权':''}</strong>{!pending&&<button className="textButton" onClick={()=>setDismissed(login.id)}>关闭</button>}</div>
  <p>{login.message}</p>
  {pending&&login.flow==='device'&&login.userCode&&<p className="tfCode">设备码 <b className="mono">{login.userCode}</b></p>}
  {pending&&<div className="tfRow">
   <button disabled={disabled||!login.url} onClick={()=>void actions.login('open',{id:login.id})}>打开授权页</button>
   <button disabled={disabled} onClick={()=>void actions.login('cancel',{id:login.id})}>取消</button>
  </div>}
  {pending&&login.flow==='callback'&&<details><summary>浏览器无法打开回调地址？</summary>
   <form className="tfInline" onSubmit={event=>{event.preventDefault();const value=callback;setCallback('');void actions.login('callback',{id:login.id,redirectURL:value});}}>
    <input type="url" required autoComplete="off" spellCheck={false} aria-label="完整回调地址" placeholder="粘贴授权后地址栏里的完整 localhost 地址" value={callback} onChange={event=>setCallback(event.target.value)}/>
    <button disabled={disabled||!callback.trim()||login.status==='verifying'}>提交</button>
   </form>
  </details>}
  {!pending&&<button disabled={disabled} onClick={()=>void actions.connect(login.provider)}>重新连接</button>}
 </div>;
}

/** Authorized accounts with their quota up front, plus switching the client's own login where it has one. */
export function AccountsPage({local,usage,disabled,actions,notify}:{local:LocalAgentSnapshot;usage:GatewayUsage[];disabled:boolean;actions:AccountActions;notify:Notify}){
 const logins:Record<LoginProvider,ReturnType<typeof useNativeLogin>>={codex:useNativeLogin('codex',local),claude:useNativeLogin('claude',local),antigravity:useNativeLogin('antigravity',local)};
 const [tab,setTab]=useState(()=>{try{return localStorage.getItem(tabKey)??'codex';}catch{return 'codex';}});
 const [selectedAccounts,setSelectedAccounts]=useState<Record<string,string>>({});
 const [modelsOpen,setModelsOpen]=useState('');const [refreshing,setRefreshing]=useState('');
 const [open,setOpen]=useState('');const [switching,setSwitching]=useState(false);const lock=useRef(false);
 const loginPending=!!local.login&&pendingStates.includes(local.login.status);
 const locked=disabled||switching||!!refreshing||loginPending||['starting','stopping'].includes(local.state);
 const providers=local.providers.map(provider=>({...provider,accounts:local.accounts.filter(a=>a.provider===provider.id&&(!a.unavailable||a.retryable||provider.id==='cursor'))}));
 const provider=providers.find(p=>p.id===tab)??providers[0];
 const login=provider&&provider.id in loginNames?logins[provider.id as LoginProvider]:undefined;
 const account=provider?.accounts.find(a=>a.id===selectedAccounts[provider.id])??provider?.accounts.find(a=>a.id===login?.current?.id)??provider?.accounts[0];
 const chooseProvider=(id:string)=>{setTab(id);try{localStorage.setItem(tabKey,id);}catch{/* Only remembers the open platform. */}};
 // Follow a newly started authorization once; manual platform browsing stays available afterwards.
 useEffect(()=>{if(local.login&&pendingStates.includes(local.login.status))chooseProvider(local.login.provider);},[local.login?.id]);
 const switchLogin=async(provider:LoginProvider,id:string,label:string)=>{
  if(lock.current)return;lock.current=true;setSwitching(true);
  try{const note=await logins[provider].switchTo(id);notify({kind:'ok',text:`${loginNames[provider]} 本机登录已切换到 ${label}，重新打开 ${loginNames[provider]} 生效。${note}`});}
  catch(error){notify({kind:'error',text:error instanceof Error?error.message:'切换失败'});}
  finally{await logins[provider].refresh();lock.current=false;setSwitching(false);}
 };

 return <div className="tfPage">
  <header className="tfPageHead tfAccountsHead"><h1>账号授权</h1></header>
  <div className="tfProviderTabs" role="tablist" aria-label="授权平台" onKeyDown={navigateTabs}>
   {providers.map(item=><button key={item.id} id={`provider-tab-${item.id}`} role="tab" aria-selected={provider?.id===item.id} aria-controls={`provider-panel-${item.id}`} tabIndex={provider?.id===item.id?0:-1} onClick={()=>chooseProvider(item.id)}>
    <ProviderIcon provider={item.id}/><span>{item.label}</span>
    {!!item.accounts.length&&<small>{item.accounts.length}<span className="srOnly"> 个已授权账号</span></small>}
   </button>)}
  </div>
  <LoginProgress local={local} disabled={disabled||switching} actions={actions}/>
  {!provider&&<p className="tfHint">正在读取授权平台…</p>}
  {provider&&<section id={`provider-panel-${provider.id}`} role="tabpanel" aria-labelledby={`provider-tab-${provider.id}`} className="tfProviderPanel">
   <header className="tfProviderHead">
    <ProviderIcon provider={provider.id} size={40}/>
    <div><div className="tfProviderTitle"><h2>{provider.label}</h2><button className="textButton tfProviderRefresh" aria-label={`刷新 ${provider.label} 账号、模型和额度`} title="只刷新此平台的账号、模型和额度" disabled={locked||local.state!=='running'} onClick={()=>void (async()=>{if(lock.current)return;lock.current=true;setRefreshing(provider.id);try{await actions.refresh(provider.id);await login?.refresh();}catch(error){notify({kind:'error',text:error instanceof Error?error.message:'刷新失败，请重试'});}finally{lock.current=false;setRefreshing('');}})()}><Icon name="refresh" size={14}/>{refreshing===provider.id?'正在刷新…':'刷新'}</button></div><p>{provider.hint}</p></div>
    <div className="tfRow">
     {importable.has(provider.id)&&<button disabled={locked} onClick={()=>void actions.importLocal(provider.id)}>从本机导入</button>}
     <button className="primary" disabled={locked} onClick={()=>void actions.connect(provider.id)}><Icon name="plus" size={14}/>添加 {provider.label} 账号</button>
    </div>
   </header>
   {login?.status&&!login.current&&login.status.email&&<p className="tfHint">本机登录：{login.status.email}</p>}
   {!account?<div className="tfAccountEmpty">
    <Icon name="user" size={28}/><h3>还没有 {provider.label} 账号</h3>
    <p>{local.state==='running'?'点击上方添加账号，完成授权后即可查看模型和额度。':'网关启动后显示已授权的账号，也可以点击上方添加账号。'}</p>
   </div>:<>
    <div className="tfAccountTabs" role="tablist" aria-label={`${provider.label} 已授权账号`} onKeyDown={navigateTabs}>
     {provider.accounts.map(item=><button key={item.id} id={`account-tab-${item.id}`} role="tab" aria-selected={account.id===item.id} aria-controls={`account-panel-${item.id}`} tabIndex={account.id===item.id?0:-1} onClick={()=>setSelectedAccounts(previous=>({...previous,[provider.id]:item.id}))}>
      <Icon name="user" size={14}/><span title={item.label}>{item.label}</span>
      {login?.accounts.some(a=>a.id===item.id&&a.current)?<b className="tfUsing">本机登录中</b>:item.disabled?<small>已停用</small>:null}
     </button>)}
    </div>
    {(()=>{
     const quota=local.quotas[account.id];const native=login?.accounts.find(a=>a.id===account.id);
     const expanded=open===account.id;
     const providerUsage=usageOf(usage,row=>row.model.startsWith(`${provider.id}/`));
     return <div id={`account-panel-${account.id}`} role="tabpanel" aria-labelledby={`account-tab-${account.id}`} className={`tfAccountDetail ${account.disabled?'off':''}`}>
      <div className="tfAccountTop">
       <span className="tfRowText"><strong>{account.label}</strong><small>{account.models?.length??0} 个模型{account.disabled?' · 已停用':''}</small></span>
       {native?.current&&<b className="tfUsing">本机登录中</b>}
      </div>
      {account.modelError&&<small className="tfWarn">{account.modelError}</small>}
      {account.retryable&&<small className="tfHint">上次请求暂时失败，可稍后重试。</small>}
      {quota&&!account.disabled?<QuotaDetails quota={quota} label={account.label} compact/>:<small className="tfHint">{account.disabled?'已停用，不参与调用':'额度暂未提供'}</small>}
      {modelsOpen===account.id&&<div className="tfAccountModels" id={`models-${account.id}`}>
       <h3>支持的模型</h3><p className="tfHint">额度见上方账号信息；这里展示该账号最近获取的模型目录。</p>
       {account.models?.length?<ul aria-label={`${account.label} 支持的模型`}>{account.models.map(id=><li key={id}><strong>{modelLabel(local.models,id)}</strong><code>请求 ID：{id}</code></li>)}</ul>:<p className="tfHint">尚未获取到模型，请启用账号后刷新。</p>}
      </div>}
      {expanded&&<div className="tfUsage"><strong>Token 使用</strong><span>{usageText(providerUsage)}</span><small>按 {provider.label} 模型统计，同类账号合计</small></div>}
      <div className="tfCardFoot">
       {login&&native&&!native.current&&<button disabled={locked||!native.switchable} title={native.switchable?`把 ${loginNames[provider.id as LoginProvider]} 自己的登录换成这个账号`:native.reason} onClick={()=>void switchLogin(provider.id as LoginProvider,account.id,account.label)}>{switching?'正在切换…':'设为本机登录'}</button>}
       <button className="textButton" aria-expanded={modelsOpen===account.id} aria-controls={`models-${account.id}`} onClick={()=>setModelsOpen(modelsOpen===account.id?'':account.id)}>{modelsOpen===account.id?'收起模型':`查看模型（${account.models?.length??0}）`}</button>
       <button className="textButton" onClick={()=>setOpen(expanded?'':account.id)}>{expanded?'收起':'详情'}</button>
       <label className="toggle" title={account.disabled?'启用':'停用'}><input type="checkbox" checked={!account.disabled} disabled={locked||local.state!=='running'} onChange={()=>void actions.toggle(account.id,account.disabled)}/><span>启用</span></label>
       <button className="textButton danger" disabled={locked||local.state!=='running'} onClick={()=>{if(window.confirm(`删除账号 ${account.label} 的登录凭据？`))void actions.remove(account.id);}}>删除</button>
      </div>
      {login?.error&&<p className="tfWarn">本机登录状态读取失败：{login.error}</p>}
      {login&&native&&!native.current&&!native.switchable&&native.reason&&<p className="tfHint">{native.reason}</p>}
     </div>;
    })()}
   </>}
   {login?.status?.backup&&<div className="tfRow"><button className="textButton" disabled={locked} onClick={()=>void (async()=>{if(lock.current)return;lock.current=true;setSwitching(true);try{await login.restore();notify({kind:'ok',text:`${provider.label} 已恢复切换前的本机登录。`});}catch(error){notify({kind:'error',text:error instanceof Error?error.message:'恢复失败'});}finally{await login.refresh();lock.current=false;setSwitching(false);}})()}>恢复切换前的本机登录</button></div>}
  </section>}
 </div>;
}
