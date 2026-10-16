import type {MaintenanceContext} from '../../../packages/core/src/maintenance-conversations';
import {LoadingSkeleton,LoadError} from './LoadingState';
import type {ActivityTrace} from '../../../packages/core/src/activity-traces';
import {TracePanel} from './TracePanel';
import { useEffect, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { AgentTarget } from './connection-evidence';
import type { GatewayOverview } from './gateway-overview';
import { requestJSON } from './request';
import { readForSession } from './session-read';
import { qualifiedModelLabel } from './model-label';
import type { UsageData } from './usage-data';
import { formatTokens } from './usage-model';
import type { SwitchFailure } from '../../../packages/core/src/switch-journal';

const recordStates:Record<string,string>={applied:'使用中',prepared:'写入未完成',restored:'已切走'};
const failureActions:Record<string,string>={connect:'接入网关',restore:'切回官方','official-switch':'切换官方账号','official-restore':'还原官方账号','migration-restore':'恢复旧对话'};
const agentNames:Record<string,string>={codex:'Codex',claude:'Claude Code',workbuddy:'WorkBuddy',qoder:'Qoder',deepseek:'DeepSeek Harness',pi:'Pi Agent',antigravity:'Antigravity'};

export function ActivityPane({local,overview,usage,onContext}:{onContext?:(context:MaintenanceContext)=>void;local:LocalAgentSnapshot;overview:GatewayOverview;usage:UsageData}){
 const {error}=overview;
 const [recentLoaded,setRecentLoaded]=useState(false),[retryRecent,setRetryRecent]=useState(0),[retryRecords,setRetryRecords]=useState(0),[recordsError,setRecordsError]=useState('');
 const [origin,setOrigin]=useState<'all'|'native'|'gateway'>('all'),[recent,setRecent]=useState<ActivityTrace[]>([]),[recentError,setRecentError]=useState('');
 useEffect(()=>{let live=true;setRecentLoaded(false);setRecent([]);setRecentError('');const load=async()=>{try{const result=await requestJSON<{records:ActivityTrace[]}>(`/api/activity/traces?days=0&limit=30&origin=${origin}`);if(live){setRecent(result.records);setRecentLoaded(true);setRecentError('');}}catch{if(live)setRecentError('暂时无法读取最近调用');}};void load();const timer=setInterval(()=>void load(),5000);return()=>{live=false;clearInterval(timer);};},[origin,retryRecent]);
 const [targets,setTargets]=useState<AgentTarget[]>();
 const [failures,setFailures]=useState<SwitchFailure[]>();
 useEffect(()=>{let live=true;const load=()=>readForSession('agent-targets',()=>requestJSON<{targets:AgentTarget[];switchFailures?:SwitchFailure[]}>('/api/a2a'),retryRecords>0).then(value=>{if(live){setTargets(value.targets);setFailures(value.switchFailures??[]);setRecordsError('');}}).catch(()=>{if(live)setRecordsError('暂时无法读取切换记录');});void load();return()=>{live=false;};},[retryRecords]);
 const records=targets&&[...targets.flatMap(target=>target.backups.map(record=>({id:record.id,at:record.createdAt,name:target.name,model:qualifiedModelLabel(local,record.model),detail:'',state:recordStates[record.state]??record.state,bad:false}))),...(failures??[]).map(failure=>({id:failure.id,at:failure.at,name:targets.find(target=>target.id===failure.target)?.name??agentNames[failure.target]??failure.target,model:failure.model?qualifiedModelLabel(local,failure.model):'—',detail:`${failureActions[failure.action]??failure.action}：${failure.message}`,state:'失败',bad:true}))].sort((a,b)=>b.at.localeCompare(a.at)).slice(0,30);
 return <div className="tfPage tfActivityPage">
  <header className="tfPageHead"><h1>活动</h1></header>
  {error&&<LoadError message={error} retry={overview.reload}/>}
  <TracePanel onContext={onContext} range={usage.range} includeNative origin={origin} onOriginChange={setOrigin}/>
  <section className="tfPanel" aria-label="最近请求">
   <header className="tfPanelHead"><div><h2>最近请求</h2></div></header>
   {recentError&&<LoadError message={recentError} retry={()=>setRetryRecent(n=>n+1)}/>}
   {!recentLoaded&&!recentError?<LoadingSkeleton label="正在加载最近请求"/>:recent.length?<ul className="tfLog">{recent.map(item=><li key={item.id}>
    <span>{new Date(item.startedAt).toLocaleTimeString()}</span>
    <span>{item.origin==='native'?'本机直连':'经 TokenFlow'} · {item.agent}</span>
    <code>{qualifiedModelLabel(local,item.model)}</code>
    <span title="输入 / 输出（括号内为缓存读取）">{item.inputTokens==null?'—':formatTokens(item.inputTokens)} / {item.outputTokens==null?'—':formatTokens(item.outputTokens)}{item.cachedTokens?` (${formatTokens(item.cachedTokens)})`:''}</span>
    <b className={item.status>=400?'bad':'good'}>{item.statusKnown===false?'未记录状态':item.status}</b>
   </li>)}</ul>:<p className="tfHint">{recentLoaded?'还没有此来源的请求。':''}</p>}
  </section>
  <section className="tfPanel" aria-label="切换记录">
   <header className="tfPanelHead"><div><h2>切换记录</h2></div></header>
   {recordsError&&<LoadError message={recordsError} retry={()=>setRetryRecords(n=>n+1)}/>}
   {!records&&!recordsError?<LoadingSkeleton label="正在加载切换记录"/>:records?.length?<ul className="tfLog tfSwitchLog">{records.map(record=><li key={record.id}>
    <span>{new Date(record.at).toLocaleString()}</span>
    <span>{record.name}</span>
    <code>{record.model}</code>
    <span className="tfSwitchMsg" title={record.detail}>{record.detail||'—'}</span>
    <span className={record.bad?'bad':undefined}>{record.state}</span>
   </li>)}</ul>:<p className="tfHint">{records?'还没有切换记录。':''}</p>}
  </section>
 </div>;
}
