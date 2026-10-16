import {hasNativeLogin} from './native-login-visibility';
import {UsageFold} from './UsagePanel';
import type {UsageData} from './usage-data';
import type {ReactNode} from 'react';
import {OfficialAccountIdentity,UnpooledNativeAccount} from './OfficialAccountIdentity';
import {useState} from 'react';
import {NativeLoginStatus} from './NativeLoginStatus';
import {useOfficialLoginConfirm} from './OfficialLoginConfirm';
import {loginNames,type LoginProvider,type useNativeLogin} from './native-login';
import type {Notify} from './notify';
import {requestJSON} from './request';
import {ProviderIcon} from './ProviderIcon';

export function DesktopOfficialPanel({clientTabs,provider,login,notify,usage}:{usage:UsageData;clientTabs?:ReactNode;provider:LoginProvider;login:ReturnType<typeof useNativeLogin>;notify:Notify}){
 const [busy,setBusy]=useState(false),confirm=useOfficialLoginConfirm(),name=loginNames[provider];
 const change=async(id?:string)=>{if(!await confirm.confirm(name,!id))return;setBusy(true);try{if(id)await login.switchTo(id);else await login.restore();notify({kind:'ok',text:`${name} 已${id?'切换账号':'恢复原登录'}并重新打开。`});}catch(error){notify({kind:'error',text:error instanceof Error?error.message:'切换失败'});}finally{await login.refresh();setBusy(false);}};
 const restart=async()=>{setBusy(true);try{await requestJSON('/api/a2a/restart',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({target:provider})},600000);notify({kind:'ok',text:`${name} 已重新打开。`});}catch(error){notify({kind:'error',text:error instanceof Error?error.message:'重启失败'});}finally{setBusy(false);}};
 return <section className="tfPanel">{confirm.dialog}
  <header className="tfPanelHead"><ProviderIcon provider="workbuddy" size={30}/><div><div className="tfAgentTitle"><h2>{name}</h2>{clientTabs}</div><UsageFold loaded={usage.loaded} error={usage.error} onRetry={usage.reload} title={`${name} 用量`} rows={usage.allRows.filter(row=>row.target===provider)} range="today"/></div><button className="textButton" disabled={busy} onClick={()=>void restart()}>重新打开</button></header>
  {hasNativeLogin(login)&&<div className="tfAgentColumns"><section className="tfAgentSection" aria-label="官方登录账号">
   <header className="tfAgentSectionHead"><h3>官方登录账号</h3><NativeLoginStatus name={name} login={login}>{login.status?.backup&&<button className="textButton" disabled={busy} onClick={()=>void change()}>恢复原登录</button>}</NativeLoginStatus></header>
   {login.accounts.length||login.nativeLabel?<ul className="tfLines"><UnpooledNativeAccount provider={provider} login={login}/>{login.accounts.map(account=><li key={account.id} className={account.current?'on':''}><div className="tfLine">
    <button className="tfLineMain" aria-pressed={account.current} disabled={busy||account.current||!account.switchable} title={account.reason||undefined} onClick={()=>void change(account.id)}>
     <OfficialAccountIdentity provider={provider} account={account}/>
    </button>
   </div></li>)}</ul>:<p className="tfHint">还没有 WorkBuddyAI 账号</p>}
  </section></div>}
 </section>;
}
