import {TracePanel} from './TracePanel';
import { useEffect, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { AgentTarget } from './connection-evidence';
import type { GatewayOverview } from './gateway-overview';
import { requestJSON } from './request';
import { qualifiedModelLabel } from './model-label';
import type { UsageData } from './usage-data';
import { formatTokens } from './usage-model';

const recordStates:Record<string,string>={applied:'使用中',prepared:'写入未完成',restored:'已切走'};


export function ActivityPane({local,overview,usage}:{local:LocalAgentSnapshot;overview:GatewayOverview;usage:UsageData}){
 const {activity,error}=overview;
 const [targets,setTargets]=useState<AgentTarget[]>();
 useEffect(()=>{void requestJSON<{targets:AgentTarget[]}>('/api/a2a').then(value=>setTargets(value.targets)).catch(()=>{});},[]);
 const records=targets?.flatMap(target=>target.backups.map(record=>({target,record}))).sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt)).slice(0,30);
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
   {records?.length?<ul className="tfLog">{records.map(({target,record})=><li key={record.id}>
    <span>{new Date(record.createdAt).toLocaleString()}</span>
    <span>{target.name}</span>
    <code>{qualifiedModelLabel(local,record.model)}</code>
    <span>{recordStates[record.state]}</span>
   </li>)}</ul>:<p className="tfHint">{records?'还没有切换记录。':'正在读取…'}</p>}
  </section>
 </div>;
}
