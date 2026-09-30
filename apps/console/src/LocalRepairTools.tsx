import { useEffect, useState } from 'react';
import type { LocalMaintenance } from '../../../packages/core/src/local-maintenance';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceSelection } from '../../../packages/core/src/gateway-maintenance';
import type { Target } from '../../../packages/core/src/agent-connections';

export type LocalRepairSnapshot=ReturnType<LocalMaintenance['snapshot']>;
async function request<T>(path:string,body?:unknown):Promise<T>{const response=await fetch(path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw new Error(data.error?.message??data.error??'本地操作失败');return data;}
const targetNames={codex:'Codex CLI',claude:'Claude Code',workbuddy:'WorkBuddy',qoder:'Qoder'};
const statusNames={running:'执行中',completed:'检查 / 执行结束',failed:'未完成',stopped:'已停止，保留部分结果',interrupted:'上次退出时未完成'};
const checkNames:Record<string,string>={configuration:'配置与备份',processes:'运行进程',ports:'网关端口',installation:'安装来源与版本',network:'指定来源网络'};

export function LocalRepairTools({local,target:contextTarget,selection,onSelection,modelBusy}:{local:LocalAgentSnapshot;target?:Target;selection?:MaintenanceSelection;onSelection:(value:MaintenanceSelection)=>Promise<void>;modelBusy:boolean}){
 const [state,setState]=useState<LocalRepairSnapshot>();const [target,setTarget]=useState<Target>('codex');const [source,setSource]=useState('');const [direct,setDirect]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [acknowledge,setAcknowledge]=useState(false);
 const selectedTarget=contextTarget??target;
 useEffect(()=>{let live=true;const refresh=()=>request<LocalRepairSnapshot>('/api/maintenance/local').then(next=>{if(live)setState(next);}).catch(()=>{if(live)setError('本地维修状态暂时无法读取。');});void refresh();const timer=setInterval(()=>void refresh(),1500);return()=>{live=false;clearInterval(timer);};},[]);
 useEffect(()=>setAcknowledge(false),[state?.plan?.id]);
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{await fn();}catch(error){setError(error instanceof Error?error.message:'本地操作失败');}finally{setBusy(false);}};
 const sources=local.apiSources?.filter(s=>s.enabled)??[];
 const directChoices=sources.filter(s=>s.hasKey&&s.protocol==='responses').flatMap(s=>s.models.map(model=>({sourceId:s.id,model:`api-${s.id}/${model}`,label:`${s.name} · ${model}`})));
 const last=state?.runs[0];const locked=busy||!!state?.active;
 return <section className="localRepairTools" aria-label="本地诊断与升级">
  <div className="sectionTitle"><div><h2>本地诊断</h2><p className="hint">不需要维修模型；转接服务停止时仍可检查和还原。检查结束不代表客户端调用成功。</p></div></div>
  <div className="localRepairFields">
   {!contextTarget&&<label>检查对象<select value={target} disabled={locked} onChange={e=>setTarget(e.target.value as Target)}>{Object.entries(targetNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>}
   <label>可选网络检查<select value={source} disabled={locked} onChange={e=>setSource(e.target.value)}><option value="">仅本地检查</option>{sources.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
  </div>
  <div className="buttons"><button disabled={locked} onClick={()=>void act(async()=>setState(await request('/api/maintenance/local/diagnose',{target:selectedTarget,...(source?{sourceId:source}:{})})))}>运行本地诊断</button><button disabled={locked||selectedTarget!=='codex'} onClick={()=>void act(async()=>{await request('/api/maintenance/local/upgrade-plan',{});setState(await request('/api/maintenance/local'));})}>检查 Codex 升级</button>{selectedTarget==='codex'&&<button className="textButton" disabled={busy} onClick={()=>void act(async()=>{const result=await request<{url:string;opened:boolean}>('/api/maintenance/local/documentation',{});if(!result.opened)window.open(result.url,'_blank','noopener,noreferrer');})}>官方更新说明</button>}{state?.active&&<button onClick={()=>void act(async()=>setState(await request('/api/maintenance/local/stop',{})))}>停止本地任务</button>}</div>
  {(error||state?.warning)&&<p className="banner error" role="alert">{error||state?.warning}</p>}
  {last&&<details className="localRepairEvidence" open={!!state?.active}><summary>{last.title} · {statusNames[last.status]}</summary><small>{new Date(last.startedAt).toLocaleString()}</small>{last.steps.map((step,index)=><div key={index}><strong>{checkNames[step.name]??step.name} · {{passed:'已取得证据',failed:'未完成',skipped:'未执行',running:'执行中'}[step.status]}</strong><p>{step.message}</p>{step.data!==undefined&&<pre>{JSON.stringify(step.data,null,2)}</pre>}</div>)}</details>}
  {state?.plan&&<article className="repairProposal" aria-label="Codex 升级方案"><h3>Codex CLI {state.plan.currentVersion} → {state.plan.nextVersion}</h3><p>{state.plan.impact}</p><p>{state.plan.rollback}</p><details><summary>安装路径、执行参数与前置条件</summary><pre>{JSON.stringify({installation:state.plan.installation,command:state.plan.command,configurationRevision:state.plan.configurationRevision,expiresAt:state.plan.expiresAt},null,2)}</pre></details><label className="scopeCheck"><input type="checkbox" checked={acknowledge} disabled={locked} onChange={e=>setAcknowledge(e.target.checked)}/>已查看影响，确认升级这个 npm 全局 CLI</label><button className="primary" disabled={locked||modelBusy||!acknowledge} onClick={()=>void act(async()=>setState(await request('/api/maintenance/local/upgrade',{id:state.plan!.id,approve:true})))}>同意并升级</button><p className="hint">必须人工确认。执行前重新核对安装、配置和进程；检测到运行任务时拒绝升级。</p></article>}
  <details className="directRepairChoice"><summary>备用维修通道{selection?.channel==='direct'?' · 已启用':''}</summary><p className="hint">明确选择已保存的 Responses API 模型，通过备用通道调用。保留权限、额度和用量记录；每次应用运行累计上限为 32,000 tokens，不会自动切换来源。</p><label>备用 API 模型<select value={direct} onChange={e=>setDirect(e.target.value)} disabled={modelBusy||locked}><option value="">请选择</option>{directChoices.map(value=><option value={value.model} key={value.model}>{value.label}</option>)}</select></label><button disabled={!direct||modelBusy||locked} onClick={()=>void act(async()=>{const chosen=directChoices.find(c=>c.model===direct);if(chosen)await onSelection({sourceId:chosen.sourceId,model:chosen.model,channel:'direct'});})}>使用此备用模型</button>{selection?.channel==='direct'&&<p role="status">当前维修已使用备用通道；切回常规通道请使用下方“更换维修模型”。</p>}{!directChoices.length&&<p className="hint">先在模型来源保存一个 Responses API 来源及模型。</p>}</details>
 </section>;
}
