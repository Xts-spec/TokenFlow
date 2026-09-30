import type { LocalRepairSnapshot } from './LocalRepairTools';
import { useEffect, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import type { RepairProposal } from '../../../packages/core/src/maintenance-approval';
import type { AgentTarget } from './connection-evidence';
import { useGatewayOverview } from './GatewayHome';
import { qualifiedModelLabel } from './model-label';
import { Icon } from './Icons';

type RepairSnapshot={status:string;chain?:MaintenanceChain;proposal?:RepairProposal;messages:{role:string;text:string}[]};
export function ActivityPane({local,onRepair,onConnection}:{local:LocalAgentSnapshot;onRepair:(chain?:MaintenanceChain)=>void;onConnection:()=>void}) {
  const {activity,error:requestError}=useGatewayOverview();
  const [view,setView]=useState<'requests'|'changes'|'repair'>('requests');
  const [targets,setTargets]=useState<AgentTarget[]>();
  const [localRepair,setLocalRepair]=useState<LocalRepairSnapshot>();
  const [repair,setRepair]=useState<RepairSnapshot>();
  const [error,setError]=useState('');
  useEffect(()=>{
    let live=true;
    const refresh=async()=>{
      const values=await Promise.allSettled(['/api/a2a','/api/maintenance','/api/maintenance/local'].map(async path=>{
        const response=await fetch(path);if(!response.ok)throw new Error('活动记录暂时无法读取，请稍后重试。');return response.json();
      }));
      if(!live)return;
      if(values[0].status==='fulfilled')setTargets(values[0].value.targets);
      if(values[1].status==='fulfilled')setRepair(values[1].value);
      if(values[2].status==='fulfilled')setLocalRepair(values[2].value);
      setError(values.some(v=>v.status==='rejected')?'部分记录暂时无法刷新，已显示的记录可能过期。':'');
    };
    void refresh();const timer=setInterval(()=>void refresh(),4000);
    return()=>{live=false;clearInterval(timer);};
  },[]);
  const records=targets?.flatMap(t=>t.backups.map(record=>({target:t,record}))).sort((a,b)=>b.record.createdAt.localeCompare(a.record.createdAt));
  return <div className="activityPage">
    <div className="gatewayHero workbenchHeading"><div><h1>活动</h1><p>模型请求、受管配置备份和当前维修会话。</p></div></div>
    <div className="modelCenterTabs" role="tablist" aria-label="活动分类">{([['requests','模型请求与用量'],['changes','配置记录'],['repair','维修会话']] as const).map(([id,label])=><button key={id} role="tab" aria-selected={view===id} onClick={()=>setView(id)}>{label}</button>)}</div>
    {(error||requestError)&&<p className="banner notice" role="alert">{error||requestError}</p>}
    {view==='requests'&&<section aria-label="模型请求与用量">
      <div className="activityMetrics"><div><span>本次运行调用</span><strong>{activity?.total??'—'}</strong></div><div><span>失败请求</span><strong>{activity?.failed??'—'}</strong></div><div><span>已报告 tokens</span><strong>{activity?.measured?(activity.inputTokens+activity.outputTokens).toLocaleString():'—'}</strong></div></div>
      <p className="hint">{activity?`统计起点：${new Date(activity.since).toLocaleString()}。`:'正在读取统计。'}仅本次服务运行；未报告用量显示「—」，不保存对话内容。</p>
      {activity?.recent.length?<div className="apiCallTable"><div className="apiCallRow apiCallHeader"><span>Agent / 时间</span><span>模型 / 协议</span><span>输入 / 输出 tokens</span><span>结果 / 耗时</span></div>{activity.recent.map(call=><div className="apiCallRow" key={call.id}><span><b>{call.agent}</b><small>{new Date(call.startedAt).toLocaleString()}</small></span><span><code>{qualifiedModelLabel(local,call.model)}</code><small>{call.protocol}</small></span><span>{call.inputTokens?.toLocaleString()??'—'} / {call.outputTokens?.toLocaleString()??'—'}</span><span><b className={call.status>=400?'muted':'good'}>HTTP {call.status}</b><small>{(call.durationMs/1000).toFixed(2)} s</small></span></div>)}</div>:<div className="empty"><Icon name="history" size={24}/><h2>{activity?'暂无网关请求':'正在读取请求记录…'}</h2><p>请求经过网关后，在这里显示真实结果。</p></div>}
    </section>}
    {view==='changes'&&<section aria-label="配置备份记录"><p className="hint">来自已保存的接入备份，显示当前记录状态与创建时间；不包含所有外部修改，也不是完整操作审计。</p>{records?.length?records.map(({target,record})=><article className="activityRecord" key={record.id}><div><strong>{target.name} · {qualifiedModelLabel(local,record.model)}</strong><small>{new Date(record.createdAt).toLocaleString()} · {{applied:'已写入',prepared:'写入未完成',restored:'已还原或被替换'}[record.state]}</small></div><button onClick={onConnection}>查看连接与备份</button></article>):<div className="empty"><h2>{records?'暂无受管配置记录':'正在读取配置记录…'}</h2></div>}</section>}
    {view==='repair'&&<section aria-label="维修会话记录">{localRepair?.runs.map(run=><details className="activityMessage" key={run.id}><summary>{run.title} · {({running:'执行中',completed:'结束',failed:'未完成',stopped:'已停止',interrupted:'中断'} as const)[run.status]} · {new Date(run.startedAt).toLocaleString()}</summary><pre>{JSON.stringify(run.steps,null,2)}</pre></details>)}<p className="hint">本地诊断与升级最多保存 50 条，不包含原始配置、命令输出或对话内容。下面显示同一维修引擎保留的当前会话。新开对话会重置会话，不代表永久维修历史。</p>{repair&&<p className="repairActivityStatus">状态：{({idle:'尚未开始',running:'检查中',completed:'本轮检查已结束',failed:'检查未完成',cancelled:'已停止',stopped:'已停止'} as Record<string,string>)[repair.status]??repair.status}</p>}{repair?.proposal&&<article className="activityRecord"><div><strong>{repair.proposal.title}</strong><small>方案状态：{({pending:'等待审批',reviewing:'审批中',executing:'执行中',completed:'已执行',rejected:'已拒绝',failed:'执行未完成'} as Record<string,string>)[repair.proposal.status]}</small></div></article>}{repair?.messages.length?repair.messages.map((message,index)=><details className="activityMessage" key={index}><summary>{{user:'用户目标',assistant:'维修建议',tool:'工具结果',error:'执行失败'}[message.role]??message.role}</summary><pre>{message.text}</pre></details>):<div className="empty"><h2>{repair?'暂无维修会话':'正在读取维修会话…'}</h2></div>}<button onClick={()=>onRepair(repair?.chain)}>打开维修师傅</button></section>}
  </div>;
}
