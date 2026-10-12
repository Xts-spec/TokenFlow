import type {ClaudeTerminalSession} from '../../../packages/core/src/claude-terminal-lifecycle';
import { useEffect, useRef, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import type { GatewayCall, GatewayUsage } from '../../../packages/core/src/gateway-activity';
import { requestJSON } from './request';
import { connectionEvidence, type AgentTarget } from './connection-evidence';
import { usageOf, usageText, usedModels, type Choice } from './flow-model';
import { isSourceSelectionAvailable, sourceLabel, sourceOptions } from './source-options';
import { modelLabel } from './model-label';
import { useNativeLogin } from './native-login';
import { FlowDialog } from './FlowDialog';
import { ModelPicker } from './ModelPicker';
import { QuotaDetails } from './QuotaDetails';
import { Icon } from './Icons';
import { ProviderIcon } from './ProviderIcon';
import type { Notify } from './notify';

type Login=ReturnType<typeof useNativeLogin>;
const tabKey='token-flow.usage.tab';
const hiddenKey=(target:string)=>`token-flow.agent.${target}.hidden`;
const post=(body:unknown)=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const choiceId=(choice:Choice)=>`model:${choice.sourceId}/${choice.model}`;

function problemOf(target:AgentTarget,calls:GatewayCall[],available:ReturnType<typeof sourceOptions>){
 const connection=target.connection;
 if(target.error)return target.error;
 if(!connection)return '';
 if(!(connection.selections??[connection]).every(item=>isSourceSelectionAvailable(available,item)))return '所选模型中有来源不可用，请调整模型选择。';
 if(target.configurationState==='missing')return '接入配置缺失，请打开维修检查。';
 if(target.configurationState!=='configured')return '接入配置与上次记录不同，请打开维修核对差异。';
 const evidence=connectionEvidence(target,calls,available);
 return evidence.tone==='attention'?evidence.label:'';
}

export function AgentsPage({local,calls,usage,notify,onRepair}:{local:LocalAgentSnapshot;calls:GatewayCall[];usage:GatewayUsage[];notify:Notify;onRepair:(chain:MaintenanceChain)=>void}){
 const [targets,setTargets]=useState<AgentTarget[]>();
 const [tab,setTab]=useState(()=>{try{return localStorage.getItem(tabKey)??'codex';}catch{return 'codex';}});
 const refresh=async()=>setTargets((await requestJSON<{targets:AgentTarget[]}>('/api/a2a')).targets);
 useEffect(()=>{void refresh().catch(error=>notify({kind:'error',text:error.message}));const timer=setInterval(()=>void refresh().catch(()=>{}),4000);return()=>clearInterval(timer);},[]);
 const logins:Record<string,Login>={codex:useNativeLogin('codex',local),claude:useNativeLogin('claude',local)};
 const available=sourceOptions(local);
 const choose=(id:string)=>{setTab(id);try{localStorage.setItem(tabKey,id);}catch{/* Only remembers the open tab. */}};
 const target=targets?.find(t=>t.id===tab)??targets?.[0];

 return <div className="tfPage">
  <header className="tfPageHead"><h1>本地 Agent</h1></header>
  <div className="tfTiles" role="tablist" aria-label="本地 Agent">
   {targets?.map(item=>{
    const connection=item.connection&&isSourceSelectionAvailable(available,item.connection)?item.connection:undefined;
    const native=logins[item.id]?.current;
    const problem=!!problemOf(item,calls,available);
    return <button key={item.id} role="tab" aria-selected={target?.id===item.id} className="tfTile" onClick={()=>choose(item.id)}>
     <ProviderIcon provider={item.id} size={30}/>
     <span className="tfTileText"><strong>{item.name}</strong><small>{connection?modelLabel(local.models,connection.model):native?`账号 · ${native.label}`:item.connection?'模型不可用':'未接入'}</small></span>
     <i className={`dot ${problem?'bad':connection||native?'ok':''}`} aria-label={problem?'有问题':connection||native?'使用中':'未接入'}/>
    </button>;
   })}
  </div>
  {!targets&&<p className="tfHint">正在读取本机 Agent…</p>}
  {target&&<AgentPanel key={target.id} target={target} login={logins[target.id]} local={local} usage={usage} problem={problemOf(target,calls,available)} notify={notify} onRepair={onRepair} onChanged={refresh}/>}
 </div>;
}

function AgentPanel({target,login,local,usage:rows,problem,notify,onRepair,onChanged}:{target:AgentTarget;login?:Login;local:LocalAgentSnapshot;usage:GatewayUsage[];problem:string;notify:Notify;onRepair:(chain:MaintenanceChain)=>void;onChanged:()=>Promise<void>}){
 const [restartOpen,setRestartOpen]=useState(false);const [restartError,setRestartError]=useState('');
 const [restartPending,setRestartPending]=useState(false);
 const [restartClient,setRestartClient]=useState<'vscode'|'terminal'>('vscode');const [sessions,setSessions]=useState<ClaudeTerminalSession[]>([]);const [sessionPid,setSessionPid]=useState('');
 const loadSessions=()=>run(async()=>{const result=await requestJSON<{sessions:ClaudeTerminalSession[]}>('/api/a2a/terminal-sessions');setSessions(result.sessions);setSessionPid(result.sessions.length===1?String(result.sessions[0].pid):'');return result.sessions.length?'终端会话已刷新':'没有发现正在运行的终端版 Claude Code';});
 const [busy,setBusy]=useState(false);const lock=useRef(false);const [picking,setPicking]=useState(false);const [open,setOpen]=useState('');
 const [hidden,setHidden]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(hiddenKey(target.id))??'[]');}catch{return [];}});
 const hide=(next:string[])=>{setHidden(next);try{localStorage.setItem(hiddenKey(target.id),JSON.stringify(next));}catch{/* Hiding is cosmetic. */}};
 const available=sourceOptions(local);const running=local.state==='running';
 const connection=target.connection;
 const current=connection&&isSourceSelectionAvailable(available,connection)?{sourceId:connection.sourceId,model:connection.model}:undefined;
 const history=usedModels(target,available,20);
 const isCurrent=(choice:Choice)=>!!current&&current.sourceId===choice.sourceId&&current.model===choice.model;
 const models:Choice[]=connection?.selections??(connection?[{sourceId:connection.sourceId,model:connection.model}]:target.backups.find(record=>record.selections)?.selections??[]);
 const accounts=(login?.accounts??[]).filter(account=>account.current||!hidden.includes(`account:${account.id}`));
 const hiddenCount=(login?.accounts.length??0)-accounts.length;

 const run=async(work:()=>Promise<string>)=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{notify({kind:'ok',text:await work()});}
  catch(error){notify({kind:'error',text:error instanceof Error?error.message:'操作失败'});}
  finally{await onChanged().catch(()=>{});await login?.refresh();lock.current=false;setBusy(false);}
 };
 // The revision guard rejects the write if the config changed since it was read.
 const latest=async()=>{
  const next=(await requestJSON<{targets:AgentTarget[]}>('/api/a2a')).targets.find(item=>item.id===target.id);
  if(!next)throw new Error('找不到这个 Agent，请刷新。');
  return next;
 };
 const applySelected=(selections:Choice[],preferred?:Choice)=>run(async()=>{
  const choice=preferred??selections.find(item=>isCurrent(item))??selections[0];
  if(!choice)throw new Error('请至少选择一个模型。');
  const next=await latest();
  await requestJSON('/api/a2a/connect',post({allowRunning:true,target:target.id,selections,sourceId:choice.sourceId,model:choice.model,revision:next.revision,...(next.connection?{replaceId:next.connection.id}:{}),tokenLimit:null}));
  setRestartPending(true);setRestartError('');setRestartOpen(true);
  if(hidden.includes(choiceId(choice)))hide(hidden.filter(id=>id!==choiceId(choice)));
  const label=modelLabel(local.models,choice.model);
  const menu=target.id==='qoder'||target.id==='workbuddy'?`，在它的模型菜单里选 token-flow · ${label}`:'';
  return `${target.name} 已配置 ${selections.length} 个模型，默认 ${label}。重启后可在 Agent 内切换${menu}。`;
 });
 const restore=()=>run(async()=>{
  const next=await latest();
  await requestJSON('/api/a2a/restore',post({id:next.connection!.id,revision:next.revision,allowRunning:true}));
  setRestartPending(true);setRestartError('');setRestartOpen(true);
  return `${target.name} 已恢复原配置，重启后生效。`;
 });
 const restart=()=>run(async()=>{
  setRestartError('');
  const result=await requestJSON<{message:string}>('/api/a2a/restart',post({target:target.id,...(target.id==='claude'?{client:restartClient,...(restartClient==='terminal'?{session:sessions.find(item=>String(item.pid)===sessionPid)}:{})}:{})}),60000).catch(error=>{setRestartError(error instanceof Error?error.message:'重启失败');throw error;});
  setRestartPending(false);setRestartOpen(false);
  return result.message;
 });
 const switchAccount=(id:string,label:string)=>run(async()=>{const note=await login!.switchTo(id);setRestartPending(true);setRestartError('');setRestartOpen(true);return `${target.name} 已切换到账号 ${label}。重启 ${target.name} 后生效。${note}`;});
 const repair=()=>onRepair({target:target.id,...(connection?{sourceId:connection.sourceId,model:connection.model,connectionId:connection.id}:{})});
 const toggleDetail=(id:string)=>setOpen(open===id?'':id);

 const state=current?`网关模式 · ${models.length} 个可选模型 · 默认 ${modelLabel(local.models,current.model)}`:login?.current?`官方登录 · ${login.current.label}`:connection?'模型不可用':'未接入 token-flow';
 return <section className="tfPanel" aria-label={target.name}>
  <header className="tfPanelHead">
   <ProviderIcon provider={target.id} size={40}/>
   <div><h2>{target.name}</h2><p>{state}</p></div>
   <div className="tfRow">
    {target.restartSupported&&<button className="textButton" disabled={busy} onClick={()=>{setRestartError('');setRestartOpen(true);}}>{restartPending?'重启生效':'重启…'}</button>}
    {connection&&<button disabled={busy} onClick={()=>void restore()}>恢复原配置</button>}
    <button className={problem?'primary':''} onClick={repair}><Icon name="wrench" size={14}/>维修</button>
   </div>
  </header>
  {problem&&<p className="tfProblem" role="status">{problem}</p>}
  {target.id==='qoder'&&<p className="tfHint">此入口接入 Qoder 独立应用；Qoder IDE 的授权账号在「账号授权」管理。</p>}
  <FlowDialog open={restartOpen} title={restartPending?'配置已保存，现在生效？':`重启 ${target.name}`} onClose={()=>setRestartOpen(false)} busy={busy}>
   <p className="tfDialogLead">{restartPending?`重新打开 ${target.name} 后，会加载新的模型与账号配置。`:`重新打开 ${target.name}，加载已保存的配置。`}</p>
   <p className="tfHint">{target.id==='claude'?restartClient==='terminal'?'结束所选 Claude Code 进程后，在新终端打开原目录的续聊列表。请先结束生成。':'将重新打开 VS Code 及 Claude Code 插件。请先保存所有编辑并结束生成。':'请先保存工作并结束生成。你也可以稍后从 Agent 标题旁重启。'}</p>
   {target.id==='claude'&&<div className="tfRestartOptions"><label>使用界面<select value={restartClient} disabled={busy} onChange={event=>{setRestartClient(event.target.value as 'vscode'|'terminal');if(event.target.value==='terminal')void loadSessions();}}><option value="vscode">VS Code 插件</option><option value="terminal">终端版 Claude Code</option></select></label>{restartClient==='terminal'&&<><label>终端会话<select value={sessionPid} disabled={busy} onChange={event=>setSessionPid(event.target.value)}><option value="">请选择会话</option>{sessions.map(session=><option key={session.pid} value={session.pid}>{session.tty} · {session.cwd}</option>)}</select></label><button disabled={busy} onClick={()=>void loadSessions()}>刷新终端会话</button></>}</div>}
   {restartError&&<p className="tfError" role="alert">{restartError}</p>}
   <footer><button disabled={busy} onClick={()=>setRestartOpen(false)}>稍后再说</button>{target.restartSupported?<button className="primary" disabled={busy||(target.id==='claude'&&restartClient==='terminal'&&!sessionPid)} onClick={()=>void restart()}>{busy?'正在处理…':'立即重启'}</button>:<span>请手动退出并重新打开。</span>}</footer>
  </FlowDialog>
  {target.id==='codex'&&<p className="tfHint">切换模型后可继续原对话；压缩上下文优先从本机历史恢复。切回官方如需迁移记录，请先完全退出 Codex，迁移前会自动备份。</p>}
  {!running&&<p className="tfHint">网关未运行，暂时不能切换模型。</p>}
  {login?.error&&<p className="tfError">{login.error}</p>}

  <section className="tfAgentSection" aria-label="官方登录账号">
   <header className="tfAgentSectionHead"><div><h3>官方登录账号</h3><p>单选一个账号，直接使用官方服务。切换账号会退出网关接入。</p></div><span className="tfModeTag">单选</span></header>
   {!accounts.length&&<p className="tfHint">{login?'还没有可切换的官方账号，请在「账号授权」添加。':'此 Agent 暂不支持在这里切换官方登录。'}</p>}
  <ul className="tfLines" aria-label={`${target.name} 官方登录账号`}>
   {accounts.map(account=>{
    const id=`account:${account.id}`;const quota=local.quotas[account.id];
    return <li key={id} className={account.current?'on':''}>
     <div className="tfLine">
      <button className="tfLineMain" aria-pressed={account.current} disabled={busy||account.current||!account.switchable} title={account.switchable?undefined:account.reason} onClick={()=>void switchAccount(account.id,account.label)}>
       <span className={`tfLoginRadio ${account.current?'on':''}`} aria-hidden="true"/>
       <ProviderIcon provider={target.id} size={22}/>
       <span className="tfKind">账号</span>
       <span className="tfRowText"><strong>{account.label}</strong><small>官方登录{account.remaining===null?'':` · 剩余 ${Math.round(account.remaining)}%`}{!account.switchable&&account.reason?` · ${account.reason}`:''}</small></span>
       {account.current?<b className="tfUsing">使用中</b>:<span className="tfSwitch">切换</span>}
      </button>
      <span className="tfActions">
       <button className="textButton" onClick={()=>toggleDetail(id)}>{open===id?'收起':'详情'}</button>
       <button className="textButton danger" disabled={account.current} title={account.current?'正在使用，不能删除':'从这里移除，账号本身保留'} onClick={()=>hide([...hidden,id])}>删除</button>
      </span>
     </div>
     {open===id&&<div className="tfUsage"><strong>额度</strong>{quota?<QuotaDetails quota={quota} label={account.label} compact/>:<span>额度暂未提供</span>}<small>官方登录直连厂商，不经过 token-flow，没有逐次 token 记录。</small></div>}
    </li>;
   })}
  </ul>
  {hiddenCount>0&&<button className="textButton" onClick={()=>hide([])}>恢复已删除的 {hiddenCount} 项</button>}
  </section>
  <section className="tfAgentSection" aria-label="网关模型">
   <header className="tfAgentSectionHead"><div><h3>网关模型</h3><p>可选择多个模型，再在 Agent 内切换。默认模型用于启动新会话。</p></div><span className="tfModeTag">多选 · {models.length} 个</span></header>
   {target.id==='claude'&&<p className="tfHint">自定义模型菜单需要 Claude Code 2.1.242 或更新版本；旧版可用 /model 模型ID 切换。</p>}
   {!connection&&models.length>0&&<p className="tfHint">当前使用官方登录。下方保留上次选择，可点击模型重新启用网关。</p>}
  <ul className="tfLines" aria-label={`${target.name} 网关模型`}>
   {models.map(choice=>{
    const id=choiceId(choice);const on=isCurrent(choice);
    const keyIds=new Set(target.backups.filter(record=>(record.selections??[record]).some(item=>choiceId(item)===id)).map(record=>record.keyId));
    const usage=usageOf(rows,row=>row.model===choice.model&&keyIds.has(row.keyId));
    return <li key={id} className={on?'on':''}>
     <div className="tfLine">
      <button className="tfLineMain" disabled={busy||(on&&target.configurationState==='configured')||!running||!!target.error} onClick={()=>void applySelected(models,choice)}>
       <ProviderIcon provider={available.find(source=>source.id===choice.sourceId)?.provider??'api'} size={22}/>
       <span className="tfKind">模型</span>
       <span className="tfRowText"><strong>{modelLabel(local.models,choice.model)}</strong><small>{sourceLabel(local,choice.sourceId)}{usage.requests?` · ${(usage.inputTokens+usage.outputTokens).toLocaleString()} tokens`:''}</small></span>
       {on&&target.configurationState==='configured'?<b className="tfUsing">默认模型</b>:<span className="tfSwitch">{connection?'设为默认':'启用网关'}</span>}
      </button>
      <span className="tfActions">
       <button className="textButton" onClick={()=>toggleDetail(id)}>{open===id?'收起':'详情'}</button>
       <button className="textButton danger" disabled={busy||models.length===1||!connection} title={models.length===1?'至少保留一个模型，或恢复原配置退出网关':'从 Agent 的模型菜单移除'} onClick={()=>void applySelected(models.filter(item=>choiceId(item)!==id))}>移除</button>
      </span>
     </div>
     {open===id&&<div className="tfUsage">
      <strong>Token 使用（本次运行）</strong>
      <span>{usageText(usage)}</span>
      {usage.requests>0&&<span>输入 {usage.inputTokens.toLocaleString()} · 输出 {usage.outputTokens.toLocaleString()}{usage.last?` · 最近 ${new Date(usage.last).toLocaleString()}`:''}</span>}
      <small>{modelLabel(local.models,choice.model)} · {sourceLabel(local,choice.sourceId)}</small>
     </div>}
    </li>;
   })}
  </ul>
  <div className="tfRow">
   <button className="tfAddButton" disabled={busy||!running||!!target.error||!available.length} onClick={()=>setPicking(true)}><Icon name="plus" size={15}/>{available.length?(models.length?'管理所选模型':'选择模型'):'先添加账号或 API 接口'}</button>
  </div>
  </section>
  <ModelPicker open={picking} title={`${target.name} 使用的模型`} local={local} current={current} recent={history} selected={models} onConfirm={choices=>void applySelected(choices)} onClose={()=>setPicking(false)}/>
 </section>;
}
