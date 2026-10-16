import type {ReactNode} from 'react';
import {useEffect,useState} from 'react';
import {requestJSON} from './request';
import {ProviderIcon} from './ProviderIcon';
import {FlowDialog} from './FlowDialog';
import {sourceOptions} from './source-options';
import {qualifiedModelLabel as modelLabel} from './model-label';
import {claudeDesktopModel} from '../../shared/claude-desktop-models';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import type {Notify} from './notify';
type Status={revision:string;connected:boolean;mode:string;backup:{state:string}|null;selections:{model:string;sourceId:string}[];unavailableReason:string;pids:number[];automaticRestart:boolean;installation:{installed:boolean;version?:string};message?:string};
type Action='connect'|'restore'|'restart';
const post=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
export function ClaudeDesktopPanel({clientTabs,local,notify}:{clientTabs?:ReactNode;local:LocalAgentSnapshot;notify:Notify}){
 const [status,setStatus]=useState<Status>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [action,setAction]=useState<Action>();const [selection,setSelection]=useState('');
 const refresh=async()=>{try{const state=await requestJSON<Status>('/api/claude-desktop');setStatus(state);setError('');return state;}catch(e){setError(e instanceof Error?e.message:'无法读取 Claude 桌面配置');throw e;}};
 useEffect(()=>{void refresh().catch(()=>{});const timer=setInterval(()=>void refresh().catch(()=>{}),5000);return()=>clearInterval(timer);},[]);
 const models=sourceOptions(local).flatMap(a=>a.models.filter(claudeDesktopModel).map(model=>({model,sourceId:a.id,label:a.provider==='api'?modelLabel(local,model):`${a.label} · ${modelLabel(local,model)}`})));
 const selected=status?.selections[0];
 const value=selection||(selected?JSON.stringify({model:selected.model,sourceId:selected.sourceId}):'');
 const present=models.some(m=>JSON.stringify({model:m.model,sourceId:m.sourceId})===value);
 const apply=async()=>{if(!action||busy)return;setBusy(true);try{
  const current=await refresh();const body=action==='restart'?{}:{revision:current.revision,...(action==='connect'?{selections:[JSON.parse(value)]}:{})};
  const result=await requestJSON<Status>(`/api/claude-desktop/${action}`,post(body),600000);await refresh();setAction(undefined);notify({kind:'ok',text:result.message??'Claude 桌面配置已处理。'});
 }catch(e){notify({kind:'error',text:e instanceof Error?e.message:'操作未完成'});}finally{setBusy(false);}};
 const blocked=busy||!status||!!status.unavailableReason;
 return <section className="tfPanel" aria-label="Claude 独立桌面版">
  <header className="tfPanelHead"><ProviderIcon provider="claude" size={30}/><div><div className="tfAgentTitle"><h2>Claude 独立桌面版</h2>{clientTabs}</div><p className="tfHint">{status?.connected?'已接入 TokenFlow':status?.mode==='3p'?'已配置第三方模型':'未接入'}{status?.installation.version?` · ${status.installation.version}`:''}</p></div><div className="tfRow">
   {status?.backup&&<button disabled={blocked} onClick={()=>setAction('restore')}>恢复接入前配置</button>}
   {status?.automaticRestart&&<button disabled={busy||!status.installation.installed&&!status.pids.length} onClick={()=>setAction('restart')}>重启桌面版</button>}
  </div></header>
  {error&&<p className="tfError" role="alert">{error}<button onClick={()=>void refresh().catch(()=>{})}>重试</button></p>}
  {status?.unavailableReason&&<p className="tfHint">{status.unavailableReason}</p>}
  {status&&!status.installation.installed&&!status.pids.length&&<p className="tfHint">尚未确认桌面版安装位置。<a href="https://claude.ai/download" target="_blank" rel="noreferrer">下载官方 Claude</a>；安装后先打开一次再重试。</p>}
  <div className="tfAgentSection"><h3>桌面模型</h3>
   <label>默认模型<select aria-label="Claude 桌面默认模型" value={value} disabled={blocked} onChange={e=>setSelection(e.target.value)}><option value="">选择账号与模型</option>{value&&!present&&<option value={value}>{status?.selections[0]?.model??'已选择模型'}（暂不可用）</option>}{models.map(m=><option key={`${m.sourceId}/${m.model}`} value={JSON.stringify({model:m.model,sourceId:m.sourceId})}>{m.label}</option>)}</select></label>
   <button className="primary" disabled={blocked||!value} onClick={()=>setAction('connect')}>{status?.connected?'替换桌面模型':'接入桌面版'}</button>
   {!models.length&&<p className="tfHint">尚无可用的 Claude 模型，请先在账号授权或 API 来源中添加。</p>}
  </div>
  <FlowDialog open={!!action} title={action==='connect'?'应用桌面模型':action==='restore'?'恢复桌面原配置':'重启 Claude 桌面版'} busy={busy} onClose={()=>setAction(undefined)}>
   <p>{status?.automaticRestart?'请先保存工作。将退出 Claude 桌面版，完成后重新打开。':'请先手动退出 Claude 桌面版，保存配置后重新打开。'}</p>
   <footer><button disabled={busy} onClick={()=>setAction(undefined)}>取消</button><button className="primary" disabled={busy} onClick={()=>void apply()}>{busy?'正在处理…':'继续'}</button></footer>
  </FlowDialog>
 </section>;
}
