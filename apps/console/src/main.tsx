import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import { requestJSON } from './request';
import { visibleLocalAgent } from './provider-visibility';
import { Icon, type IconName } from './Icons';
import { ApiInflow } from './ApiInflow';
import { AgentsPage, savedAgentTab } from './AgentsPage';
import { AccountsPage, type AccountActions } from './AccountsPage';
import { KeyOutflow } from './KeyOutflow';
import { ActivityPane } from './ActivityPane';
import {UsageOverview} from './UsageOverview';
import { SettingsPane } from './SettingsPane';
import { RepairChat, type RepairSession } from './RepairChat';
import { useGatewayOverview } from './gateway-overview';
import { useUsage } from './usage-data';
import type { Notice } from './notify';
import {Notifications} from './Notifications';
import './style.css';
import './flow.css';

type View='accounts'|'apis'|'agents'|'proxy'|'activity'|'usage'|'settings';
const empty:LocalAgentSnapshot={state:'stopped',loginState:'idle',port:8317,logs:[],accounts:[],models:[],accountError:undefined,lastError:undefined,quotas:{},quotaBusy:false,providers:[],login:undefined};
const post=(body:unknown={})=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
const gatewayText:Record<string,string>={stopped:'网关已停止',starting:'网关启动中…',stopping:'网关停止中…',failed:'网关启动失败'};
const saved:[View,string,IconName][]=[['accounts','账号授权','user'],['apis','API 接口','plug']];
const used:[View,string,IconName][]=[['agents','本地 Agent','model'],['proxy','API 代理','shield']];
const secondary:[View,string,IconName][]=[['usage','用量总览','tokens'],['activity','活动','history'],['settings','设置','sliders']];

function App(){
 const [view,setView]=useState<View>('agents');
 const [local,setLocal]=useState<LocalAgentSnapshot>(empty);
 const [notice,setNotice]=useState<Notice>();
 const [busy,setBusy]=useState(false);const lock=useRef(false);
 const [repair,setRepair]=useState<RepairSession>();const [repairOpen,setRepairOpen]=useState(false);
 const [selectedAgent,setSelectedAgent]=useState(savedAgentTab);
 const [warnings,setWarnings]=useState<string[]>([]);
 const overview=useGatewayOverview();
 const usage=useUsage(view!=='settings');
 const firstLoad=useRef(true);

 const refresh=useCallback(async()=>{
  const next=visibleLocalAgent(await requestJSON<LocalAgentSnapshot>('/api/local-agent'));setLocal(next);
  // Nothing to use yet: start where models are added.
  if(firstLoad.current&&next.state==='running'){firstLoad.current=false;if(!next.models.length)setView('accounts');}
 },[]);
 useEffect(()=>{
  void refresh().catch(error=>setNotice({kind:'error',text:error.message}));
  void requestJSON<{credentialWarnings?:string[]}>('/api/settings').then(s=>setWarnings(s.credentialWarnings??[])).catch(()=>{});
  const timer=setInterval(()=>void refresh().catch(()=>{}),1500);return()=>clearInterval(timer);
 },[refresh]);
 const dismissNotice=useCallback(()=>setNotice(undefined),[]);
 useEffect(()=>{document.querySelector('main')?.scrollTo(0,0);},[view]);
 const openRepair=useCallback((chain:MaintenanceChain)=>{setRepair({id:Date.now(),chain});setRepairOpen(true);},[]);
 useEffect(()=>{const open=()=>setRepairOpen(true);window.addEventListener('token-flow:open-repair',open);return()=>window.removeEventListener('token-flow:open-repair',open);},[]);

 // One request at a time: gateway changes must not overlap.
 const act=async(work:()=>Promise<LocalAgentSnapshot|void>,success?:string)=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const next=await work();if(next)setLocal(visibleLocalAgent(next));if(success)setNotice({kind:'ok',text:success});await refresh();}
  catch(error){setNotice({kind:'error',text:error instanceof Error?error.message:String(error)});}
  finally{lock.current=false;setBusy(false);}
 };
 const command=(action:string)=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/${action}`,post()));
 const accounts:AccountActions={
  refresh:provider=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/providers/${provider}/refresh`,post(),300000),`${local.providers.find(item=>item.id===provider)?.label??provider} 账号、模型和额度已刷新。`),
  connect:provider=>command(provider),
  importLocal:provider=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/import-local/${provider}`,post()),'已导入本机账号。'),
  login:(action,data)=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/login/${action}`,post(data))),
  toggle:(id,enabled)=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/accounts/${id}`,post({enabled}))),
  remove:id=>act(()=>requestJSON<LocalAgentSnapshot>(`/api/local-agent/accounts/${id}`,{method:'DELETE'}),'账号已删除。'),
 };
 const gatewayDown=local.state!=='running';
 const calls=overview.activity?.recent??[];
 // Keys bound to a source are the ones token-flow writes into Agent configs itself.
 const exported=overview.keys.filter(key=>key.exported||(!key.sourceId&&!key.modelSources));
 const platform=(window as Window&{desktop?:{platform:string}}).desktop?.platform;
 const navButton=([id,label,icon]:[View,string,IconName])=><button key={id} className={view===id?'on':''} aria-current={view===id?'page':undefined} onClick={()=>setView(id)}><Icon name={icon} size={16}/>{label}</button>;

 return <div className={`tf ${platform==='darwin'?'nativeMac':''}`}>
  {platform==='darwin'&&<div className="tfTitlebar" aria-hidden="true"/>}
  <aside className="tfSide">
   <div className="tfBrand"><img src="/logo.svg" alt="" width="24" height="24"/>token-flow<i className={`dot ${local.state==='running'?'ok':local.state==='failed'?'bad':''}`} title={gatewayText[local.state]??'网关运行中'}/></div>
   <nav aria-label="主导航">
    <small className="tfNavGroup">已保存</small>{saved.map(navButton)}
    <small className="tfNavGroup">使用</small>{used.map(navButton)}
   </nav>
   <nav aria-label="更多" className="tfSideFoot">{secondary.map(navButton)}</nav>
  </aside>
  <main className="tfMain">
   {view==='accounts'&&<AccountsPage local={local} usage={usage} disabled={busy} actions={accounts} notify={setNotice}/>}
   {view==='apis'&&<div className="tfPage tfApiPage"><ApiInflow local={local} usage={usage} onChange={refresh} notify={setNotice}/></div>}
   {view==='agents'&&<AgentsPage local={local} calls={calls} usage={usage} notify={setNotice} onRepair={openRepair} onAgent={setSelectedAgent}/>}
   {view==='proxy'&&<div className="tfPage tfProxyPage"><KeyOutflow local={local} keys={exported} usage={usage} reload={overview.reload} notify={setNotice}/></div>}
   {view==='activity'&&<ActivityPane local={local} overview={overview} usage={usage}/>}
   {view==='usage'&&<div className="tfPage tfSettingsPage"><UsageOverview usage={usage} local={local}/></div>}
   {view==='settings'&&<SettingsPane local={local} disabled={busy} onAction={command}/>}
  </main>
  <Notifications notice={notice} onDismiss={dismissNotice} warnings={warnings} onDismissWarning={text=>setWarnings(value=>value.filter(item=>item!==text))} gateway={gatewayDown?{text:`${gatewayText[local.state]??'网关未运行'}${local.state==='failed'&&local.lastError?`：${local.lastError}`:''}`,canStart:['stopped','failed'].includes(local.state),busy,onStart:()=>void command('start')}:undefined}/>
  <RepairChat local={local} session={repair} selectedAgent={selectedAgent} open={repairOpen} onToggle={setRepairOpen} onNew={()=>setRepair({id:Date.now()})}/>
 </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
