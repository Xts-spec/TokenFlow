import {TracePanel} from './TracePanel';
import { useEffect, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { AgentTarget } from './connection-evidence';
import type { GatewayOverview } from './gateway-overview';
import { requestJSON } from './request';
import { qualifiedModelLabel } from './model-label';
import type { UsageData } from './usage-data';
import { formatTokens } from './usage-model';
import type { SwitchFailure } from '../../../packages/core/src/switch-journal';

const recordStates:Record<string,string>={applied:'使用中',prepared:'写入未完成',restored:'已切走'};
const failureActions:Record<string,string>={connect:'接入网关',restore:'切回官方','official-switch':'切换官方账号','official-restore':'还原官方账号','migration-restore':'恢复旧对话'};
const agentNames:Record<string,string>={codex:'Codex',claude:'Claude Code',workbuddy:'WorkBuddy',qoder:'Qoder',deepseek:'DeepSeek Harness',pi:'Pi Agent',antigravity:'Antigravity'};

export function ActivityPane({local,overview,usage}:{local:LocalAgentSnapshot;overview:GatewayOverview;usage:UsageData}){
 const {activity,error}=overview;
 const [targets,setTargets]=useState<AgentTarget[]>();
 const [failures,setFailures]=useState<SwitchFailure[]>();
 useEffect(()=>{let live=true;const load=()=>requestJSON<{targets:AgentTarget[];switchFailures?:SwitchFailure[]}>('/api/a2a').then(value=>{if(live){setTargets(value.targets);setFailures(value.switchFailures??[]);}}).catch(()=>{});void load();const timer=setInterval(()=>void load(),4000);return()=>{live=false;clearInterval(timer);};},[]);
 const records=targets&&[...targets.flatMap(target=>target.backups.map(record=>({id:record.id,at:record.createdAt,name:target.name,model:qualifiedModelLabel(local,record.model),detail:'',state:recordStates[record.state]??record.state,bad:false}))),...(failures??[]).map(failure=>({id:failure.id,at:failure.at,name:targets.find(target=>target.id===failure.target)?.name??agentNames[failure.target]??failure.target,model:failure.model?qualifiedModelLabel(local,failure.model):'—',detail:`${failureActions[failure.action]??failure.action}：${failure.message}`,state:'失败',bad:true}))].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,30);
 return <div className="tfPage">
  <header className="tfPageHead"><h1>活动</h1></header>
  {error&&<p className="tfError" role="alert">{error}</p>}
  <TracePanel range={usage.range}/>
  <section className="tfPanel" aria-label="最近请求">
   <header className="tfPanelHead"><div><h2>最近请求</h2></div></header>
   {activity?.recent.length?<ul className="tfLog">{activity.recent.map(item=><li key={item.id}>
    <span>{new Date(item.startedAt).toLocaleTimeString()}</span>
    <span>{item.agent}</span>
    <code>{qualifiedModelLabel(local,item.model)}</code>
    <span title="输入 / 输出（括号内为缓存读取）">{item.inputTokens==null?'—':formatTokens(item.inputTokens)} / {item.outputTokens==null?'—':formatTokens(item.outputTokens)}{item.cachedTokens?` (${formatTokens(item.cachedTokens)})`:''}</span>
    <b className={item.status>=400?'bad':'good'}>{item.status}</b>
   </li>)}</ul>:<p className="tfHint">{activity?'还没有请求。':'正在读取…'}</p>}
  </section>
  <section className="tfPanel" aria-label="切换记录">
   <header className="tfPanelHead"><div><h2>切换记录</h2></div></header>
   {records?.length?<ul className="tfLog tfSwitchLog">{records.map(record=><li key={record.id}>
    <span>{new Date(record.at).toLocaleString()}</span>
    <span>{record.name}</span>
    <code>{record.model}</code>
    <span className="tfSwitchMsg" title={record.detail}>{record.detail||'—'}</span>
    <span className={record.bad?'bad':undefined}>{record.state}</span>
   </li>)}</ul>:<p className="tfHint">{records?'还没有切换记录。':'正在读取…'}</p>}
  </section>
 </div>;
}
