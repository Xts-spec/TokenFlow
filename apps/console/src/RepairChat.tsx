import { useEffect, useRef, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain, MaintenanceReadiness, MaintenanceSelection } from '../../../packages/core/src/gateway-maintenance';
import type { RepairProposal } from '../../../packages/core/src/maintenance-approval';
import type { LocalMaintenance } from '../../../packages/core/src/local-maintenance';
import { requestJSON } from './request';
import { modelLabel } from './model-label';
import { ModelPicker } from './ModelPicker';
import type { Choice } from './flow-model';
import { Icon } from './Icons';
import type { Target } from '../../../packages/core/src/agent-connections';

export type RepairSession={id:number;chain?:MaintenanceChain};
type Snapshot={status:string;selection?:MaintenanceSelection;readiness?:MaintenanceReadiness;chain?:MaintenanceChain;messages:{role:string;text:string}[];liveText?:string;proposal?:RepairProposal;channelWarning?:string};
type Plan=ReturnType<LocalMaintenance['snapshot']>['plan'];
const targetNames:Record<string,string>={codex:'Codex',claude:'Claude Code',workbuddy:'WorkBuddy',qoder:'Qoder'};
const suggestions=['检查网络和代理设置','模型调用失败，帮我看看','Agent 连不上 token-flow'];
const proposalStates:Record<string,string>={reviewing:'审核中…',executing:'正在执行…',completed:'已执行',rejected:'已取消',failed:'执行失败'};
const call=<T=Snapshot,>(path:string,body:unknown={},method='POST')=>requestJSON<T>(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const get=<T=Snapshot,>(path:string)=>requestJSON<T>(path);

/** Resident bottom-right chat: hiding it keeps the conversation; a new session id starts a fresh one. */
export function RepairChat({local,session,open,onToggle,onNew}:{local:LocalAgentSnapshot;session?:RepairSession;open:boolean;onToggle:(open:boolean)=>void;onNew:()=>void}){
 const log=useRef<HTMLDivElement>(null);
 const [state,setState]=useState<Snapshot>({status:'idle',messages:[]});const [plan,setPlan]=useState<Plan>();
 const [prompt,setPrompt]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [picking,setPicking]=useState(false);
 const [ready,setReady]=useState(true);
 const [editing,setEditing]=useState(false);const [configPicking,setConfigPicking]=useState(false);
 const [configTarget,setConfigTarget]=useState<Target>('codex');const [configChoice,setConfigChoice]=useState<Choice>();
 const [targets,setTargets]=useState<{id:Target;connection:({id:string}&Choice)|null}[]>([]);
 const pending=useRef<MaintenanceChain|null>(null);
 const resetting=useRef(false);

 useEffect(()=>{
  let live=true;
  const refresh=async()=>{if(resetting.current)return;const [next,localState]=await Promise.all([get<Snapshot>('/api/maintenance'),get<{plan?:Plan}>('/api/maintenance/local')]);if(live&&!resetting.current){setState(next);setPlan(localState.plan);}};
  void refresh().catch(()=>{});
  const timer=setInterval(()=>void refresh().catch(()=>{}),open?1500:6000);return()=>{live=false;clearInterval(timer);};
 },[open]);
 useEffect(()=>{
  if(!session)return;let live=true;resetting.current=true;setReady(false);setError('');setPrompt('');pending.current=null;
  void (async()=>{
   const current=await get<Snapshot>('/api/maintenance');
   if(current.status==='running'||current.readiness?.status==='checking')await call('/api/maintenance/stop');
   const fresh=await call<Snapshot>('/api/maintenance/reset');
   if(!live)return;pending.current=session.chain??null;setState(fresh);setPlan(undefined);setReady(true);
  })().catch(e=>{if(live){setError(e instanceof Error?e.message:'无法开始新的维修');setReady(true);}}).finally(()=>{resetting.current=false;});
  return()=>{live=false;};
 },[session?.id]);
 useEffect(()=>{if(open)log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'});},[open,state.messages.length,state.liveText,state.proposal?.status]);

 const thinking=state.status==='running';const checking=state.readiness?.status==='checking';
 const proposalBusy=['reviewing','executing'].includes(state.proposal?.status??'');
 const canSend=ready&&!!state.selection&&!thinking&&!checking&&!proposalBusy&&!busy;
 const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
 const send=(text:string,chain=state.chain)=>act(async()=>{setState(await call<Snapshot>('/api/maintenance/run',{...(chain?{chain}:{}),prompt:text}));setPrompt('');});

 // Opened from a broken Agent: start checking as soon as a model is ready.
 useEffect(()=>{
  const chain=pending.current;
  if(!chain||!canSend||state.readiness?.status==='failed')return;
  pending.current=null;void send(`帮我检查 ${targetNames[chain.target]??chain.target} 的接入，找出问题并修好。`,chain);
 },[canSend,state.readiness?.status]);

 const gatewayDown=local.state!=='running';
 const directOnly=(choice:Choice)=>gatewayDown&&!local.apiSources?.some(s=>s.id===choice.sourceId&&s.protocol==='responses');
 const pick=(choice:Choice)=>void act(async()=>{
  const direct=gatewayDown&&local.apiSources?.some(s=>s.id===choice.sourceId&&s.protocol==='responses');
  setState(await call<Snapshot>('/api/maintenance',{...choice,...(direct?{channel:'direct'}:{})},'PUT'));
 });
 const chain=state.chain??session?.chain;
 const selected=state.selection?{sourceId:state.selection.sourceId,model:state.selection.model}:undefined;
 const attention=thinking||checking||proposalBusy||state.proposal?.status==='pending';
 const editConfiguration=()=>void act(async()=>{
  const data=await get<{targets:typeof targets}>('/api/a2a');setTargets(data.targets);
  const target=chain?.target??'codex';const connection=data.targets.find(t=>t.id===target)?.connection;
  setConfigTarget(target);setConfigChoice(chain?.sourceId&&chain.model?{sourceId:chain.sourceId,model:chain.model}:connection??undefined);setEditing(true);
 });
 const proposeConfiguration=()=>void act(async()=>{
  if(!configChoice)return;const connection=targets.find(t=>t.id===configTarget)?.connection;
  await call('/api/maintenance/propose',{rewrite:true,chain:{target:configTarget,...configChoice,...(connection?{connectionId:connection.id}:{})}});
  setState(await get('/api/maintenance'));setEditing(false);
 });
 const endpoint=`${location.origin}${configTarget==='claude'?'':configTarget==='workbuddy'?'/v1/chat/completions':'/v1'}`;

 return <>
  {!open&&<button className={`tfRepairFab ${attention?'busy':''}`} aria-label="打开维修师傅" onClick={()=>onToggle(true)}><Icon name="wrench" size={18}/><span>维修师傅</span></button>}
  <section className="tfRepair" hidden={!open} aria-labelledby="repair-title" onKeyDown={event=>{if(event.key==='Escape'&&!picking)onToggle(false);}}>
   <header className="tfRepairHead">
    <div><h2 id="repair-title">维修师傅</h2>{chain&&<small>{targetNames[chain.target]}{chain.model?` · ${modelLabel(local.models,chain.model)}`:''}</small>}</div>
    <button className={`tfModelChip ${state.selection?'':'warn'}`} disabled={busy||thinking||checking||proposalBusy} onClick={()=>setPicking(true)}>{state.selection?modelLabel(local.models,state.selection.model):'选择维修模型'}<Icon name="chevron" size={12} style={{transform:'rotate(90deg)'}}/></button>
    <button className="textButton" disabled={busy||!ready} title="清空对话，重新开始" onClick={onNew}>新对话</button>
    <button className="iconButton" aria-label="收起" onClick={()=>onToggle(false)}><Icon name="close" size={16}/></button>
   </header>
   {checking&&<p className="tfRepairNote">正在连接维修模型…</p>}
   {state.readiness?.status==='failed'&&<p className="tfRepairNote bad">{state.readiness.message}<button className="textButton" onClick={()=>setPicking(true)}>换一个模型</button></p>}
   {state.channelWarning&&<p className="tfRepairNote bad">{state.channelWarning}</p>}
   <div className="tfRow tfRepairNote"><button disabled={busy||thinking||checking||proposalBusy||state.proposal?.status==='pending'} onClick={editConfiguration}>修改 Agent 配置</button><small>接口地址 · Key · 模型</small></div>
   {editing&&<section className="tfFix" aria-label="修改 Agent 配置">
    <label>Agent <select aria-label="配置目标 Agent" value={configTarget} onChange={event=>{const target=event.target.value as Target;setConfigTarget(target);setConfigChoice(targets.find(t=>t.id===target)?.connection??undefined);}}>{Object.entries(targetNames).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
    <p><button disabled={busy} onClick={()=>setConfigPicking(true)}>{configChoice?modelLabel(local.models,configChoice.model):'选择来源和模型'}</button></p>
    <p>接口地址将更新为 <code>{endpoint}</code></p>
    <p>自动生成此来源和模型专用的新 Key，写入成功后撤销旧 Key。外部 API 请先在“API 接口”保存，再在这里选择。</p>
    <small>先预览改动，确认后备份并写入。重启 Agent 后加载新配置。</small>
    <div className="tfRow"><button className="primary" disabled={busy||!configChoice} onClick={proposeConfiguration}>生成修改方案</button><button disabled={busy} onClick={()=>setEditing(false)}>取消</button></div>
   </section>}

   <div className="tfChat" ref={log} aria-live="polite">
    {!state.messages.length&&!thinking&&<div className="tfChatEmpty">
     <Icon name="message" size={26}/>
     {!state.selection?<><p>先选一个维修模型，就可以开始对话。</p><button className="primary" onClick={()=>setPicking(true)}>选择维修模型</button></>
     :chain&&pending.current?<p>马上开始检查…</p>
     :<><p>遇到什么问题？</p><div className="tfChips">{suggestions.map(text=><span className="tfChip" key={text}><button disabled={!canSend} onClick={()=>void send(text)}>{text}</button></span>)}</div></>}
    </div>}
    {state.messages.map((message,index)=>message.role==='tool'
     ?<details key={index} className="tfTool"><summary>已执行检查 · {message.text.split(/[:：\n]/)[0].slice(0,28)}</summary><pre>{message.text}</pre></details>
     :<div key={index} className={`tfBubble ${message.role}`}>{message.text}</div>)}
    {thinking&&<div className="tfBubble assistant live">{state.liveText||'正在检查…'}</div>}
    {state.status==='completed'&&state.chain&&!state.proposal&&<div className="tfChips"><span className="tfChip"><button disabled={busy} onClick={()=>void act(async()=>{const result=await call<{needed?:boolean;message?:string}>('/api/maintenance/propose',{chain:state.chain});setState(await get('/api/maintenance'));if(result.needed===false)setError(result.message??'当前配置不需要修改。');})}>生成修复方案</button></span></div>}
    {state.proposal&&<article className="tfFix" aria-label="修复方案">
     <strong>{state.proposal.title}</strong>
     {state.proposal.reason&&<p>{state.proposal.reason}</p>}
     <details><summary>查看要执行的改动</summary><pre>{state.proposal.code}</pre></details>
     {state.proposal.status==='pending'?<div className="tfRow">
      <button className="primary" disabled={busy} onClick={()=>void act(async()=>{await call('/api/maintenance/approve',{id:state.proposal!.id,approve:true});setState(await get('/api/maintenance'));})}>同意并执行</button>
      <button disabled={busy} onClick={()=>void act(async()=>{await call('/api/maintenance/approve',{id:state.proposal!.id,approve:false});setState(await get('/api/maintenance'));})}>不用了</button>
     </div>:<small>{proposalStates[state.proposal.status]}</small>}
    </article>}
    {plan&&<article className="tfFix" aria-label="Codex 升级">
     <strong>升级 Codex CLI {plan.currentVersion} → {plan.nextVersion}</strong>
     <p>{plan.impact}</p>
     <div className="tfRow"><button className="primary" disabled={busy||thinking} onClick={()=>void act(async()=>{await call('/api/maintenance/local/upgrade',{id:plan.id,approve:true});setPlan(undefined);})}>同意升级</button></div>
    </article>}
   </div>

   {error&&<p className="tfRepairNote bad" role="alert">{error}</p>}
   <form className="tfComposer" onSubmit={event=>{event.preventDefault();if(canSend&&prompt.trim())void send(prompt.trim());}}>
    <textarea rows={2} value={prompt} maxLength={8000} placeholder={state.selection?'描述问题，或继续追问…':'先选择维修模型'} disabled={!state.selection} onChange={event=>setPrompt(event.target.value)}
     onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(canSend&&prompt.trim())void send(prompt.trim());}}}/>
    {thinking?<button type="button" onClick={()=>void act(async()=>{setState(await call<Snapshot>('/api/maintenance/stop'));})}>停止</button>
    :<button className="primary" disabled={!canSend||!prompt.trim()} aria-label="发送"><Icon name="send" size={16}/></button>}
   </form>
  </section>
  <ModelPicker open={picking} title="维修模型" local={local} current={selected} isDisabled={directOnly} onPick={pick} onClose={()=>setPicking(false)}/>
  <ModelPicker open={configPicking} title="Agent 的来源和模型" local={local} current={configChoice} onPick={choice=>setConfigChoice(choice)} onClose={()=>setConfigPicking(false)}/>
 </>;
}
