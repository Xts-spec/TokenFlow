import { A2APane } from './A2APane';
import { RepairDrawer } from './RepairDrawer';
import { ActivityPane } from './ActivityPane';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { RunRecord } from '@cua-sample/contracts';
import './style.css';
import { Icon } from './Icons';
import type { AgentKind } from './agent-config';
import { AgentConnections } from './AgentConnections';
import { GatewayKeysPane } from './GatewayKeysPane';
import { LocalAgentPane } from './LocalAgentPane';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

type Provider={engine?:'legacy'|'pi';kind:'cliproxy'|'openai'|'custom';baseURL:string;model:string;historyMode:'stateless'|'previous_response_id';reasoning:'off'|'low'|'medium'|'high'};
type Local=LocalAgentSnapshot;
type Probe={responses:boolean;functionCall:boolean;functionOutput:boolean;previousResponseId:boolean;imageInput:boolean;reasoning:boolean;errors:Record<string,string>};
async function api<T>(path:string,body?:unknown,method?:string):Promise<T>{
  const response=await fetch(path,{method:method??(body===undefined?'GET':'POST'),headers:body===undefined?undefined:{'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error??data.message??`HTTP ${response.status}`);return data;
}
const stateNames:Record<string,string>={idle:'空闲',agent_control:'Agent 正在操作',pausing:'等待当前操作结束',human_control:'人工接管',resync:'同步页面状态',running:'运行中',completed:'已完成',failed:'失败',cancelled:'已停止',stopped:'已停止',starting:'启动中'};
function App(){
  const [settingsView,setSettingsView]=useState<'gateway'|'keys'|'repair'|'experimental'|'about'>('gateway');
  const [workbenchView,setWorkbenchView]=useState<'auto'|'manual'>('auto');
  const [manualVisited,setManualVisited]=useState(false);
  const showManual=()=>{setManualVisited(true);setWorkbenchView('manual');};
  const [repairOpen,setRepairOpen]=useState(false);
  const [repairContext,setRepairContext]=useState<MaintenanceChain>();
  const [bubbleHidden,setBubbleHidden]=useState(false);
  const openRepair=(chain?:MaintenanceChain)=>{if(chain)setRepairContext(chain);setRepairOpen(true);};
  const [credentialWarnings,setCredentialWarnings]=useState<string[]>([]);
  const [preferredModel,setPreferredModel]=useState('');
  const [preferredKind,setPreferredKind]=useState<AgentKind>('codex');
  const [historyQuery,setHistoryQuery]=useState('');
  const [historyStatus,setHistoryStatus]=useState('all');
  const [tab,setTab]=useState('workbench');
  useEffect(()=>{document.querySelector('main')?.scrollTo(0,0);},[tab]);
  const [returnAfterLogin,setReturnAfterLogin]=useState<string|null>(null);
  const [error,setError]=useState('');const [busy,setBusy]=useState('');
  const [provider,setProvider]=useState<Provider>({kind:'cliproxy',baseURL:'http://127.0.0.1:8317/v1',model:'',historyMode:'stateless',reasoning:'off'});
  const [apiKey,setApiKey]=useState('');const [hasKey,setHasKey]=useState(false); const [probe,setProbe]=useState<Probe>();const [models,setModels]=useState<{id:string}[]>([]);
  const [local,setLocal]=useState<Local>({state:'stopped',loginState:'idle',port:8317,logs:[],accounts:[],models:[],accountError:undefined,lastError:undefined,quotas:{},quotaBusy:false,providers:[],login:undefined});
  const [history,setHistory]=useState<RunRecord[]>([]);
  const [notice,setNotice]=useState('');
  async function refresh(){
    const results=await Promise.allSettled([
      api<Local>('/api/local-agent').then(setLocal),
    ]);
    const failed=results.find(result=>result.status==='rejected');if(failed?.status==='rejected')throw failed.reason;
  }
  const act=async(label:string,fn:()=>Promise<void>)=>{setBusy(label);setError('');setNotice('');try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy('');}};
  useEffect(()=>{void api<{provider:Provider;hasKey:boolean;probe?:Probe;credentialWarnings?:string[]}>('/api/settings').then(s=>{setProvider(s.provider);setHasKey(s.hasKey);setProbe(s.probe);setCredentialWarnings(s.credentialWarnings??[]);}).catch(e=>setError(e.message));void refresh().catch(e=>setError(e.message));const timer=setInterval(()=>void refresh().catch(()=>{}),1500);return()=>clearInterval(timer);},[]);
  useEffect(()=>{if(returnAfterLogin!==null&&local.login?.status==='completed'&&local.login.id!==returnAfterLogin){setTab('workbench');setReturnAfterLogin(null);}},[local.login?.id,local.login?.status,returnAfterLogin]);
  useEffect(()=>{if(tab==='settings'&&settingsView==='experimental')void api<RunRecord[]>('/api/history').then(setHistory).catch(e=>setError(e.message));},[tab,settingsView]);
  useEffect(()=>{const open=()=>openRepair();window.addEventListener('token-flow:open-repair',open);return()=>window.removeEventListener('token-flow:open-repair',open);},[]);
  const save=async()=>{await api('/api/settings',{provider,...(apiKey?{apiKey}:{})},'PUT');setApiKey('');setHasKey(provider.kind==='cliproxy'||!!apiKey||hasKey);setProbe(undefined);};
  const command=(action:string)=>act(action,async()=>{setLocal(await api(`/api/local-agent/${action}`,{}));});
  const visibleHistory=history.filter(item=>(historyStatus==='all'||item.status===historyStatus)&&`${item.prompt} ${item.model}`.toLocaleLowerCase().includes(historyQuery.trim().toLocaleLowerCase()));
  const desktopPlatform = (window as Window & {desktop?:{platform:string}}).desktop?.platform;
  return <div className={`app ${desktopPlatform==='darwin'?'nativeMac':''}`}>
    <aside className="sidebar">
      <div className="brand"><img className="mark" src="/logo.svg" alt="" width="38" height="38"/><div>token-flow<small>你的模型，流向每个 Agent</small></div></div>
      <button className="newTask" onClick={()=>setTab('sources')}><Icon name="plus"/>添加模型来源</button>
      <span className="navLabel">模型与 Agent</span>
      <nav aria-label="主导航">{([['workbench','workspace','工作台'],['sources','model','模型来源'],['activity','history','活动']] as const).map(([id,icon,name])=><button key={id} className={tab===id?'selected':''} aria-current={tab===id?'page':undefined} onClick={()=>setTab(id)}><Icon name={icon}/>{name}</button>)}</nav>
      <nav className="settingsNav" aria-label="设置导航"><button className={tab==='settings'?'selected':''} aria-current={tab==='settings'?'page':undefined} onClick={()=>setTab('settings')}><Icon name="sliders"/>设置</button></nav>
      <div className="sideStatus"><small><Icon name="plug" size={14}/>本机网关</small><p><i className={local.state==='running'?'dot ok':'dot'}/>服务状态 <b>{stateNames[local.state]??local.state}</b></p><p><i className={local.accounts.some(a=>!a.disabled)?'dot ok':'dot'}/>启用账号 <b>{local.accounts.filter(a=>!a.disabled).length}</b></p><p><i className={local.models.length?'dot ok':'dot'}/>可用模型 <b>{local.models.length}</b></p><div className="foot"><Icon name="shield" size={14}/>厂商凭据仅保存在本机</div></div>
    </aside>
    <main><header className="top"><div className="pageIdentity"><Icon name={tab==='sources'?'model':tab==='activity'?'history':tab==='settings'?'sliders':'workspace'} size={17}/><h1>{{workbench:'工作台',sources:'模型来源',activity:'活动',settings:'设置'}[tab]}</h1><span className="localBadge">token-flow / local</span></div><div className="topActions"><span className="status"><i className={`dot ${local.state==='running'?'ok':''}`}/>网关{stateNames[local.state]??local.state}</span><button onClick={()=>openRepair()}><Icon name="sliders" size={15}/>维修师傅</button></div></header>
      {credentialWarnings.length>0&&<div className="notice credentialWarning" role="alert">{credentialWarnings.map(message=><p key={message}>{message}</p>)}<button onClick={()=>{setTab('settings');setSettingsView('experimental');}}>查看旧接口配置</button><button onClick={()=>setCredentialWarnings([])}>知道了</button></div>}
      {error&&<div className="error" role="alert">{error}<button aria-label="关闭错误" onClick={()=>setError('')}>×</button></div>}
      {notice&&<div className="notice" role="status">{notice}</div>}
      {busy&&<div className="busy" role="status">{busy}…</div>}
      <div hidden={tab!=='workbench'} className="workbenchPanel">
        <div className="modelCenterTabs" role="tablist" aria-label="连接方式">{([['auto','我的 Agent'],['manual','手动配置']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={workbenchView===id} aria-controls={`workbench-${id}`} onClick={()=>id==='manual'?showManual():setWorkbenchView('auto')}>{label}</button>)}</div>
        <div id="workbench-auto" role="tabpanel" aria-label="我的 Agent" hidden={workbenchView!=='auto'}><A2APane local={local} onManual={(kind,model)=>{setPreferredKind(kind??'codex');setPreferredModel(model??'');showManual();}} onAccounts={()=>{setReturnAfterLogin(local.login?.id??'');setTab('sources');}} onMaintenance={openRepair} onKeys={()=>{setTab('settings');setSettingsView('keys');}}/></div>
        <div id="workbench-manual" role="tabpanel" aria-label="手动配置" hidden={workbenchView!=='manual'}>{manualVisited&&<AgentConnections key={`${preferredKind}:${preferredModel}`} local={local} preferredKind={preferredKind} preferredModel={preferredModel} onKeys={()=>{setTab('settings');setSettingsView('keys');}} onAccounts={()=>setTab('sources')}/>}</div>
      </div>
      {tab==='activity'&&<ActivityPane local={local} onRepair={openRepair} onConnection={()=>{setWorkbenchView('auto');setTab('workbench');}}/>}
      {tab==='sources'&&<div className="modelCenterHeading"><div><h2>模型来源</h2><p>授权一次，在工作台选择模型并接入 Agent。每个账号的额度独立显示。</p></div><button onClick={()=>{setTab('workbench');setWorkbenchView('auto');}}>前往工作台 <Icon name="arrow" size={15}/></button></div>}
      {tab==='settings'&&<div className="modelCenterTabs" role="tablist" aria-label="设置分类">{([['gateway','网关与网络'],['keys','客户端访问密钥'],['repair','维修模型与权限'],['about','关于与反馈'],['experimental','实验功能']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={settingsView===id} onClick={()=>setSettingsView(id)}>{label}</button>)}</div>}
      {tab==='settings'&&settingsView==='keys'&&<GatewayKeysPane local={local}/>}
      {tab==='settings'&&settingsView==='repair'&&<section className="settingsIntro"><h2>维修模型与权限</h2><p>在同一个维修会话中选择模型、查看配置变更方案和审批权限。写入与还原继续经过原有备份和外部修改检查。</p><button onClick={()=>openRepair()}>打开维修师傅</button><label className="toggle"><input type="checkbox" checked={!bubbleHidden} onChange={e=>setBubbleHidden(!e.target.checked)}/>显示浮动维修入口</label></section>}
      {tab==='settings'&&settingsView==='experimental'&&<section className="settingsIntro"><h2>旧任务运行时</h2><p>旧浏览器 / 桌面任务接口及运行记录仍保留在后端，尚未拆成独立发行包。这里的接口设置只供旧任务使用；当前不会启动浏览器、申请桌面权限或执行任务。</p></section>}
      {tab==='settings'&&settingsView==='experimental'&&<div className="settings"><section><div className="sectionTitle"><h2>旧任务接口与能力</h2><span>选择接口并验证能力</span></div><p className="hint">这份单例配置仅用于旧浏览器任务运行时，不是可供 Agent 和维修共用的 API 来源。多 API 来源将在后续阶段实现。</p><form onSubmit={e=>{e.preventDefault();void act('保存设置',async()=>{await save();setNotice('设置已保存，请刷新模型并探测能力。');});}}>
        <label>Provider<select value={provider.kind} onChange={e=>{const kind=e.target.value as Provider['kind'];setProvider({...provider,kind,baseURL:kind==='openai'?'https://api.openai.com/v1':`http://127.0.0.1:${local.port}/v1`,model:''});setModels([]);setProbe(undefined);}}><option value="cliproxy">本机网关 · 已连接账号</option><option value="openai">OpenAI</option><option value="custom">Custom · OpenAI-compatible</option></select></label>
        <label>Base URL<input required value={provider.baseURL} disabled={provider.kind==='cliproxy'} onChange={e=>setProvider({...provider,baseURL:e.target.value})}/></label>
        {provider.kind!=='cliproxy'&&<label>API Key <span className="muted">{hasKey?'已保存；留空则保留':''}</span><input type="password" autoComplete="off" value={apiKey} onChange={e=>setApiKey(e.target.value)} placeholder="只写入系统加密存储，不返回明文"/></label>}
        <label>模型 ID<div className="inputAction"><input list="models" required value={provider.model} onChange={e=>setProvider({...provider,model:e.target.value})} placeholder="从当前 Provider 获取或输入准确模型 ID"/><button type="button" disabled={!!busy} onClick={()=>act('读取模型',async()=>{await save();setModels((await api<{data:{id:string}[]}>('/api/providers/models')).data);})}>刷新模型</button></div><datalist id="models">{(provider.kind==='cliproxy'?local.models:models).map(m=><option key={m.id} value={m.id}/>)}</datalist></label>
        <div className="columns"><label>对话历史<select value={provider.historyMode} onChange={e=>setProvider({...provider,historyMode:e.target.value as Provider['historyMode']})}><option value="stateless">无状态 · 发送完整历史</option><option value="previous_response_id">previous_response_id</option></select></label><label>Reasoning<select value={provider.reasoning} onChange={e=>setProvider({...provider,reasoning:e.target.value as Provider['reasoning']})}>{['off','low','medium','high'].map(v=><option key={v}>{v}</option>)}</select></label></div>
        <div className="buttons"><button type="submit" disabled={!!busy}>保存设置</button><button type="button" className="primary" disabled={!!busy||!provider.model} onClick={()=>act('探测模型能力（会请求 Provider）',async()=>{await save();setProbe(await api('/api/providers/probe',{}));})}>保存并探测能力 →</button></div>
      </form></section><section><h2>能力探测</h2><p className="hint">实际请求验证，不由模型名称推断。历史续接和图片为独立能力，失败不等于模型整体不可用。探测会产生少量模型调用。</p>{probe?.responses && !probe.previousResponseId && <p className="hint">此链路未通过 previous_response_id。请将「对话历史」改为 stateless（完整历史回传），保存并重新探测后运行。</p>}<div className="probe">{[['responses','Responses API'],['functionCall','Function Call'],['functionOutput','Function Output'],['previousResponseId','previous_response_id'],['imageInput','Image Input'],['reasoning','Reasoning']].map(([key,label])=><div key={key}><span className="mono">{label}</span><b className={probe?.[key as keyof Probe]===true?'good':''}>{!probe?'未探测':probe.errors[key]?.startsWith('未执行：')?'— 未执行':probe[key as keyof Probe]===true?'✓ 通过':'× 未通过'}</b>{probe?.errors[key]&&<small>{probe.errors[key]}</small>}</div>)}</div><div className="connectionNext"><h2>供其他应用调用</h2><p className="hint">所有已连接账号的可用模型统一由本机网关提供。在「API Keys」创建客户端密钥，勾选允许调用的提供商与模型后即可接入。</p><button onClick={()=>setSettingsView('keys')}>管理客户端 Key →</button></div></section></div>}
      {(tab==='sources'||tab==='settings'&&settingsView==='gateway')&&<LocalAgentPane view={tab==='sources'?'accounts':'gateway'} selectedModel={provider.kind==='cliproxy'?provider.model:''} local={local} disabled={!!busy} onAction={command}
        onGateway={apiKey=>act(apiKey?'保存 API Key':'重新生成 API Key',async()=>{await api('/api/local-agent/gateway',{apiKey:apiKey??''},'PUT');})}
        onLoginAction={(action,data)=>act('处理授权',async()=>{setLocal(await api(`/api/local-agent/login/${action}`,data));})}
        onAccount={(id,enabled)=>act(enabled?'启用账号':'停用账号',async()=>{setLocal(await api(`/api/local-agent/accounts/${id}`,{enabled}));})}
        onDeleteAccount={id=>act('删除账号凭据',async()=>{setLocal(await api(`/api/local-agent/accounts/${id}`,undefined,'DELETE'));setNotice('已成功删除该账号凭据文件。');})}
        onImportLocal={provider=>act('导入本机应用凭据',async()=>{setLocal(await api(`/api/local-agent/import-local/${provider}`,{}));setNotice(`已成功导入本机 ${provider} 账号凭据。`);})}
        onUseModel={async model=>{setPreferredModel(model);showManual();setTab('workbench');}}/>}
      {tab==='settings'&&settingsView==='experimental'&&<section className="history"><div className="sectionTitle"><h2>旧浏览器任务记录</h2><span>{visibleHistory.length} / {history.length} 条记录</span></div><div className="historyFilters"><label><span className="srOnly">搜索历史</span><input type="search" value={historyQuery} onChange={e=>setHistoryQuery(e.target.value)} placeholder="搜索任务内容或模型…"/></label><label><span className="srOnly">任务状态</span><select aria-label="任务状态" value={historyStatus} onChange={e=>setHistoryStatus(e.target.value)}><option value="all">全部状态</option><option value="completed">已完成</option><option value="failed">失败</option><option value="cancelled">已停止</option><option value="running">运行中</option></select></label></div>{!history.length?<div className="empty"><Icon name="history" size={32}/><h2>暂无历史记录</h2></div>:!visibleHistory.length?<div className="empty"><Icon name="history" size={28}/><h2>没有匹配的记录</h2><p>试试其他关键词，或清除筛选条件。</p><button onClick={()=>{setHistoryQuery('');setHistoryStatus('all');}}>清除筛选</button></div>:visibleHistory.map(item=><div className="historyRow" key={item.id}><span className="mono">{new Date(item.startedAt).toLocaleString()}</span><strong>{item.prompt}</strong><span>{item.model}</span><b>{stateNames[item.status]}</b></div>)}</section>}
      {tab==='settings'&&settingsView==='about'&&<section className="history"><div className="sectionTitle"><h2>项目反馈</h2></div><div className="contactList"><p>功能建议和问题反馈可提交到项目仓库。</p><p><a className="contactLink" href="https://github.com/haruinia/token-flow/issues" target="_blank" rel="noreferrer">在 GitHub 提交反馈 ↗</a></p><p className="hint">请勿在公开反馈中附上账号凭据、API Key 或未经脱敏的日志。</p></div></section>}
    </main>
    {!bubbleHidden&&<div className="repairBubble"><button onClick={()=>openRepair()} aria-haspopup="dialog"><Icon name="sliders" size={17}/>维修师傅</button><button className="iconButton" aria-label="隐藏维修气泡" title="仍可从顶部和设置打开" onClick={()=>setBubbleHidden(true)}><Icon name="close" size={14}/></button></div>}
    <RepairDrawer local={local} open={repairOpen} context={repairContext} onClose={()=>setRepairOpen(false)}/>
  </div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
