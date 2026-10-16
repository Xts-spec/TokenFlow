import { apiModelRoute } from '../../shared/api-endpoint';
import type {MaintenanceContext,MaintenanceConversation} from '../../../packages/core/src/maintenance-conversations';
import {repairPages,repairAgents,repairScopeLabel,repairSuggestions,repairContextForAgent,repairSuggestionPrompt,type RepairPage} from './repair-context';
import { useEffect, useRef, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain, MaintenanceReadiness, MaintenanceSelection } from '../../../packages/core/src/gateway-maintenance';
import type { RepairProposal } from '../../../packages/core/src/maintenance-approval';
import type { LocalMaintenance } from '../../../packages/core/src/local-maintenance';
import { requestJSON } from './request';
import { qualifiedModelLabel as modelLabel } from './model-label';
import { RepairModelMenu } from './RepairModelMenu';
import type { Choice } from './flow-model';
import { Icon } from './Icons';
import type { Target } from '../../../packages/core/src/agent-connections';

export type RepairSession={id:number;chain?:MaintenanceChain;intent?:'codex-history';context?:MaintenanceContext;prompt?:string};
type Snapshot={conversationId?:string;context?:MaintenanceContext;status:string;selection?:MaintenanceSelection;readiness?:MaintenanceReadiness;chain?:MaintenanceChain;messages:{role:string;text:string}[];liveText?:string;proposal?:RepairProposal;channelWarning?:string};
type Plan=ReturnType<LocalMaintenance['snapshot']>['plan'];
const targetNames=repairAgents;
const proposalStates:Record<string,string>={reviewing:'审核中…',executing:'正在执行…',completed:'已执行',rejected:'已取消',failed:'执行失败'};
const call=<T=Snapshot,>(path:string,body:unknown={},method='POST')=>requestJSON<T>(path,{method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const get=<T=Snapshot,>(path:string)=>requestJSON<T>(path);

/** Resident bottom-right chat: hiding it keeps the conversation; a new session id starts a fresh one. */
export function RepairChat({local,session,selectedAgent,page='agents',selectionContext,range,accountContext,open,onToggle,onNew}:{page?:RepairPage;selectionContext?:MaintenanceContext;range?:MaintenanceContext['range'];accountContext?:{provider?:string;sourceId?:string};local:LocalAgentSnapshot;session?:RepairSession;selectedAgent?:string;open:boolean;onToggle:(open:boolean)=>void;onNew:()=>void}){
 const log=useRef<HTMLDivElement>(null);
 const panel=useRef<HTMLElement>(null);const modelButton=useRef<HTMLButtonElement>(null);
 const [state,setState]=useState<Snapshot>({status:'idle',messages:[]});const [plan,setPlan]=useState<Plan>();
 const [prompt,setPrompt]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [picking,setPicking]=useState(false);
 const [ready,setReady]=useState(true);
 const pageContext=():MaintenanceContext=>page==='agents'?repairContextForAgent(selectedAgent,range):page==='accounts'?{page,range,...accountContext}:{range,...selectionContext,page};
 const selectionKey=JSON.stringify(selectionContext);
 const [context,setContext]=useState<MaintenanceContext>(pageContext);
 const repairTarget=context.target??'codex';
 const [historyOpen,setHistoryOpen]=useState(false),[history,setHistory]=useState<Omit<MaintenanceConversation,'messages'>[]>([]),[historyLoading,setHistoryLoading]=useState(false);
 const [past,setPast]=useState<MaintenanceConversation>();
 const composer=useRef<HTMLTextAreaElement>(null);
 const providerLabel=local.providers.find(provider=>provider.id===context.provider)?.label;
 const scopeLabel=repairScopeLabel(context,providerLabel);
 const suggestions=repairSuggestions(context);
 const [targets,setTargets]=useState<{id:Target;connection:({id:string}&Choice)|null}[]>([]);
 const pending=useRef<MaintenanceChain|null>(null);
 const resetting=useRef(false);
 useEffect(()=>{setContext(pageContext());setPast(undefined);setHistoryOpen(false);pending.current=null;},[page,selectedAgent,accountContext?.provider,accountContext?.sourceId,selectionKey,range]);
 useEffect(()=>{if(!open)return;let live=true;void get<{targets:typeof targets}>('/api/a2a').then(result=>{if(live)setTargets(result.targets);}).catch(()=>{});return()=>{live=false;};},[open,selectedAgent]);

 useEffect(()=>{
  let live=true;
  const refresh=async()=>{if(resetting.current)return;const [next,localState]=await Promise.all([get<Snapshot>('/api/maintenance'),get<{plan?:Plan}>('/api/maintenance/local')]);if(live&&!resetting.current){setState(next);setPlan(localState.plan);}};
  void refresh().catch(()=>{});
  const timer=setInterval(()=>void refresh().catch(()=>{}),open?1500:6000);return()=>{live=false;clearInterval(timer);};
 },[open]);
 useEffect(()=>{
  if(!session)return;let live=true;setPast(undefined);setHistoryOpen(false);setContext(session.context??(session.chain?{page:'agents',target:session.chain.target,intent:session.intent}:pageContext()));resetting.current=true;setReady(false);setError('');setPrompt(session.prompt??'');pending.current=null;
  void (async()=>{
   const current=await get<Snapshot>('/api/maintenance');
   if(current.status==='running'||current.readiness?.status==='checking')await call('/api/maintenance/stop');
   const fresh=await call<Snapshot>('/api/maintenance/reset');
   if(!live)return;pending.current=session.chain??null;setState(fresh);setPlan(undefined);setReady(true);
  })().catch(e=>{if(live){setError(e instanceof Error?e.message:'无法开始新的维修');setReady(true);}}).finally(()=>{resetting.current=false;});
  return()=>{live=false;};
 },[session?.id]);
 useEffect(()=>{if(open)log.current?.scrollTo({top:log.current.scrollHeight,behavior:'smooth'});},[open,state.messages.length,state.liveText,state.proposal?.status]);

 useEffect(()=>{
  if(!open){setPicking(false);return;}
  const outside=(event:PointerEvent)=>{
   if(!(event.target instanceof Element)||panel.current?.contains(event.target)||event.target.closest('.tfRepairModelMenu,dialog[open]')||document.querySelector('dialog[open]'))return;
   setPicking(false);onToggle(false);
  };
  document.addEventListener('pointerdown',outside);return()=>document.removeEventListener('pointerdown',outside);
 },[open,onToggle]);

 const thinking=state.status==='running';const checking=state.readiness?.status==='checking';
 const proposalBusy=['reviewing','executing'].includes(state.proposal?.status??'');
 const connection=targets.find(target=>target.id===repairTarget)?.connection;
 const contextualChain:MaintenanceChain|undefined=context.page!=='agents'?undefined:session?.chain?.target===repairTarget?session.chain:connection?{target:repairTarget,sourceId:connection.sourceId,model:connection.model,connectionId:connection.id}:{target:repairTarget};
 const defaultModel=contextualChain?.sourceId&&contextualChain.model?{sourceId:contextualChain.sourceId,model:contextualChain.model}:undefined;
 const selected=state.selection?{sourceId:state.selection.sourceId,model:state.selection.model}:defaultModel;
 const canSend=ready&&!!selected&&!thinking&&!checking&&!proposalBusy&&!busy;
 const act=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{setBusy(false);}};
 const interfaceAgent=context.page==='agents'?repairTarget:undefined;
 const send=(text:string,chain=contextualChain)=>act(async()=>{
  if(!state.selection&&selected){
   let next=await call<Snapshot>('/api/maintenance',selected,'PUT');setState(next);
   const deadline=Date.now()+90000;
   while(next.readiness?.status==='checking'){
    if(Date.now()>=deadline)throw new Error('维修模型检测尚未完成，请等待状态更新后再发送。');
    await new Promise(resolve=>setTimeout(resolve,500));
    next=await requestJSON<Snapshot>('/api/maintenance');setState(next);
    if(next.selection?.sourceId!==selected.sourceId||next.selection?.model!==selected.model)throw new Error('维修模型已变更，请确认后重新发送。');
   }
   if(next.readiness?.status!=='ready')throw new Error(next.readiness?.message??'维修模型尚不可用，请重新选择。');
  }
  setState(await call<Snapshot>('/api/maintenance/run',{...(chain?{chain}:{}),interfaceAgent,context,prompt:text}));setPrompt('');
 });

 // Opened from a broken Agent: start checking as soon as a model is ready. The floating button does not set a chain, so it waits for the user.
 useEffect(()=>{
  const chain=pending.current;
  if(!chain||!canSend||state.readiness?.status==='failed')return;
  pending.current=null;void send(session?.intent==='codex-history'?'请检查 Codex 旧对话的当前来源和模型、官方登录状态、成功与失败的切换记录及迁移备份。先明确当前配置和用户最近请求的切换目标是否一致，再说明哪些旧对话不匹配、推荐怎样修复。证据不足请说明，不要自动切回官方或改成另一个模型；需要修改时生成可审批方案。':`帮我检查 ${targetNames[chain.target]??chain.target} 的接入。请结合预检里最近的切换失败和当前界面选中的 Agent 定位原因并修好。`,chain);
 },[canSend,state.readiness?.status]);

 const gatewayDown=local.state!=='running';
 const directOnly=(choice:Choice)=>gatewayDown&&!local.apiSources?.some(s=>s.id===choice.sourceId&&apiModelRoute(s,choice.model).protocol==='responses');
 const pick=(choice:Choice)=>void act(async()=>{
  const direct=gatewayDown&&local.apiSources?.some(s=>s.id===choice.sourceId&&apiModelRoute(s,choice.model).protocol==='responses');
  setState(await call<Snapshot>('/api/maintenance',{...choice,...(direct?{channel:'direct'}:{})},'PUT'));
 });
  const attention=thinking||checking||proposalBusy||state.proposal?.status==='pending';

 const showHistory=async()=>{
  setPicking(false);setPast(undefined);setHistoryOpen(true);setHistoryLoading(true);setError('');
  try{const result=await get<{conversations:typeof history}>('/api/maintenance/history');setHistory(result.conversations);}catch(e){setError(e instanceof Error?e.message:'无法读取历史对话');}finally{setHistoryLoading(false);}
 };
 const resumePast=()=>past&&void act(async()=>{
  resetting.current=true;
  try{const next=await call<Snapshot>(`/api/maintenance/history/${past.id}/resume`);setState(next);setContext(next.context??(next.chain?{page:'agents',target:next.chain.target}:pageContext()));pending.current=null;setPast(undefined);setHistoryOpen(false);setPrompt('');setPlan(undefined);}finally{resetting.current=false;}
 });
 const targetControl=<span className="tfRepairScope"><select aria-label="维修对象" value={context.page==='agents'?`agent:${repairTarget}`:context.page} disabled={thinking||busy||checking||proposalBusy} onChange={event=>{
  pending.current=null;const value=event.target.value;setPrompt('');
  setContext(value.startsWith('agent:')?{page:'agents',target:value.slice(6) as Target}:value===page?pageContext():value==='accounts'?{page:'accounts',...accountContext}:{page:value as RepairPage});
 }}><optgroup label="本地 Agent">{Object.entries(targetNames).map(([id,name])=><option key={id} value={`agent:${id}`}>{name}</option>)}</optgroup><optgroup label="TokenFlow">{Object.entries(repairPages).filter(([id])=>id!=='agents').map(([id,name])=><option key={id} value={id}>{id==='accounts'&&providerLabel?`${providerLabel} 账号授权`:name}</option>)}</optgroup></select><Icon name="chevron" size={12}/></span>;
 const shownMessages=past?.messages??state.messages;
 return <>
  {!open&&<button className={`tfRepairFab ${attention?'busy':''}`} aria-label="打开维修师傅" aria-expanded={false} aria-controls="tf-repair-panel" onClick={()=>onToggle(true)}><span className="tfRepairFabLabel" aria-hidden="true">维修师傅</span><Icon name="wrench" size={18}/></button>}
  <section id="tf-repair-panel" ref={panel} className="tfRepair" hidden={!open} aria-labelledby="repair-title" onKeyDown={event=>{if(event.key==='Escape'&&!picking)onToggle(false);}}>
   <header className="tfRepairHead">
    <div className="tfRepairIdentity"><h2 id="repair-title">维修师傅</h2>
     <button ref={modelButton} aria-label="选择维修模型" title={selected?modelLabel(local,selected.model):'选择维修模型'} aria-haspopup="dialog" aria-expanded={picking} className={`tfModelChip ${selected?'':'warn'}`} disabled={busy||thinking||checking||proposalBusy} onClick={()=>setPicking(value=>!value)}><span>{selected?modelLabel(local,selected.model):'选择维修模型'}</span><Icon name="chevron" size={12}/></button>
    </div>
    <div className="tfRepairHeadActions">
     <button className="textButton" disabled={busy||thinking||checking||proposalBusy||!ready} title="开始新对话，当前记录会保留" onClick={onNew}><Icon name="plus" size={14}/>新对话</button>
     <button className="iconButton" aria-label="历史对话" title="历史对话" aria-expanded={historyOpen} onClick={()=>historyOpen?(setHistoryOpen(false),setPast(undefined)):void showHistory()}><Icon name="history" size={16}/></button>
     <button className="iconButton" aria-label="收起" onClick={()=>onToggle(false)}><Icon name="close" size={16}/></button>
    </div>
   </header>
   {checking&&<p className="tfRepairNote">正在连接维修模型…</p>}
   {state.readiness?.status==='failed'&&<p className="tfRepairNote bad">{state.readiness.message}<button className="textButton" onClick={()=>setPicking(true)}>换一个模型</button></p>}
   {state.channelWarning&&<p className="tfRepairNote bad">{state.channelWarning}</p>}

   <div className="tfChat" ref={log} aria-live="polite">
    {historyOpen&&!past?<section className="tfRepairHistory" aria-label="历史对话"><header><h3>历史对话</h3><button className="textButton" onClick={()=>setHistoryOpen(false)}>返回当前对话</button></header>
     {historyLoading?<p className="tfHint">正在读取…</p>:history.length?history.map(entry=><button key={entry.id} className="tfRepairHistoryItem" onClick={()=>void act(async()=>{setPast(await get<MaintenanceConversation>(`/api/maintenance/history/${entry.id}`));})}><strong>{entry.title}</strong><small>{entry.context?repairScopeLabel(entry.context,local.providers.find(provider=>provider.id===entry.context?.provider)?.label):entry.chain?targetNames[entry.chain.target]:'维修对话'} · {new Date(entry.updatedAt).toLocaleString(undefined,{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'})}</small></button>):<p className="tfHint">还没有历史对话。开始维修后，会自动保存在这里。</p>}
    </section>:<>
    {past&&<div className="tfRepairHistoryBar"><button className="textButton" onClick={()=>setPast(undefined)}>返回历史对话</button><span>{new Date(past.updatedAt).toLocaleDateString()}</span></div>}
    {!past&&!state.messages.length&&!thinking&&<div className="tfChatEmpty">
     <div className="tfRepairQuestion">{targetControl}<h3>遇到什么问题？</h3></div>
     {pending.current?<p>马上开始检查…</p>:<><div className="tfRepairSuggestions">{suggestions.map(text=><button key={text} type="button" onClick={()=>{setPrompt(repairSuggestionPrompt(context,text));composer.current?.focus();}}>{text}<Icon name="arrow" size={13}/></button>)}</div>{!selected&&<p className="tfHint">选择上方的维修模型后即可发送。</p>}</>}
    </div>}
    {shownMessages.map((message,index)=>message.role==='tool'
     ?<details key={index} className="tfTool"><summary>已执行检查 · {message.text.split(/[:：\n]/)[0].slice(0,28)}</summary><pre>{message.text}</pre></details>
     :<div key={index} className={`tfBubble ${message.role}`}>{message.text}</div>)}
    {!past&&thinking&&<div className="tfBubble assistant live">{state.liveText||'正在检查…'}</div>}
    {!past&&state.status==='completed'&&state.chain&&!state.proposal&&<div className="tfChips"><span className="tfChip"><button disabled={busy} onClick={()=>void act(async()=>{const result=await call<{needed?:boolean;message?:string}>('/api/maintenance/propose',{chain:state.chain});setState(await get('/api/maintenance'));if(result.needed===false)setError(result.message??'当前配置不需要修改。');})}>生成修复方案</button></span></div>}
    {!past&&state.proposal&&<article className="tfFix" aria-label="修复方案">
     <strong>{state.proposal.title}</strong>
     {state.proposal.reason&&<p>{state.proposal.reason}</p>}
     <details><summary>查看要执行的改动</summary><pre>{state.proposal.code}</pre></details>
     {state.proposal.status==='pending'?<div className="tfRow">
      <button className="primary" disabled={busy} onClick={()=>void act(async()=>{await call('/api/maintenance/approve',{id:state.proposal!.id,approve:true});setState(await get('/api/maintenance'));})}>同意并执行</button>
      <button disabled={busy} onClick={()=>void act(async()=>{await call('/api/maintenance/approve',{id:state.proposal!.id,approve:false});setState(await get('/api/maintenance'));})}>不用了</button>
     </div>:<small>{proposalStates[state.proposal.status]}</small>}
    </article>}
    {!past&&plan&&<article className="tfFix" aria-label="Codex 升级">
     <strong>升级 Codex CLI {plan.currentVersion} → {plan.nextVersion}</strong>
     <p>{plan.impact}</p>
     <div className="tfRow"><button className="primary" disabled={busy||thinking} onClick={()=>void act(async()=>{await call('/api/maintenance/local/upgrade',{id:plan.id,approve:true});setPlan(undefined);})}>同意升级</button></div>
    </article>}
   </>}
   </div>

   {error&&<p className="tfRepairNote bad" role="alert">{error}</p>}
   {past?<div className="tfRepairResume"><button className="primary" disabled={busy||thinking||checking||proposalBusy} onClick={resumePast}>继续这段对话</button></div>:!historyOpen&&<>
   {state.messages.length>0&&<div className="tfRepairConversationScope"><span>维修对象</span>{targetControl}</div>}
   <form className="tfComposer" onSubmit={event=>{event.preventDefault();if(canSend&&prompt.trim())void send(prompt.trim());}}>
    <textarea ref={composer} aria-label="描述维修问题" rows={2} value={prompt} maxLength={8000} placeholder={`描述${scopeLabel}的问题，或继续追问…`} onChange={event=>setPrompt(event.target.value)}
     onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();if(canSend&&prompt.trim())void send(prompt.trim());}}}/>
    {thinking?<button type="button" onClick={()=>void act(async()=>{setState(await call<Snapshot>('/api/maintenance/stop'));})}>停止</button>
    :<button className="primary" disabled={!canSend||!prompt.trim()} aria-label="发送"><Icon name="send" size={16}/></button>}
   </form></>}
  </section>
  {open&&picking&&<RepairModelMenu local={local} anchor={modelButton} current={selected} isDisabled={directOnly} onPick={pick} onClose={()=>setPicking(false)}/>}
 </>;
}
