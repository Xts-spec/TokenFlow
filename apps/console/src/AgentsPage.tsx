import {ColumnDivider} from './ColumnDivider';
import {ScrollRail} from './ScrollRail';
import {localDay} from './usage-model';
import type {AgentInstallation} from '../../../packages/core/src/agent-installation';
import type {AgentUpdate} from '../../../packages/core/src/agent-updates';
import { useEffect, useRef, useState } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import type { GatewayCall } from '../../../packages/core/src/gateway-activity';
import { requestJSON } from './request';
import { connectionEvidence, type AgentTarget } from './connection-evidence';
import { type Choice } from './flow-model';
import { compactTokens, formatTokens, percentText, rangeLabel, totalsOf } from './usage-model';
import type { UsageData } from './usage-data';
import { UsageFold } from './UsagePanel';
import {DragHandle,dropOrder,orderModels,useModelOrder} from './display-order';
import { isSourceSelectionAvailable, sourceLabel, sourceOptions } from './source-options';
import { modelLabel } from './model-label';
import { useNativeLogin } from './native-login';
import { FlowDialog } from './FlowDialog';
import {useListReturn} from './list-return';
import { AgentModelPicker } from './AgentModelPicker';
import { QuotaDetails } from './QuotaDetails';
import { Icon } from './Icons';
import { ProviderIcon } from './ProviderIcon';
import type { Notify } from './notify';

type Login=ReturnType<typeof useNativeLogin>;
const tabKey='token-flow.usage.tab';
export function savedAgentTab(){try{return localStorage.getItem(tabKey)??'codex';}catch{return 'codex';}}
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

export function AgentsPage({local,calls,usage,notify,onRepair,onAgent}:{local:LocalAgentSnapshot;calls:GatewayCall[];usage:UsageData;notify:Notify;onRepair:(chain:MaintenanceChain)=>void;onAgent:(id:string)=>void}){
 const [targets,setTargets]=useState<AgentTarget[]>();
 const [updates,setUpdates]=useState<Record<string,AgentUpdate>>({});
 const refreshUpdates=async()=>{try{setUpdates((await requestJSON<{updates:Record<string,AgentUpdate>}>('/api/a2a/program-updates',undefined,20000)).updates);}catch{/* Offline checks never imply an available update. */}};
 const [tab,setTab]=useState(()=>{try{return localStorage.getItem(tabKey)??'codex';}catch{return 'codex';}});
 const refresh=async()=>setTargets((await requestJSON<{targets:AgentTarget[]}>('/api/a2a')).targets);
 useEffect(()=>{void refresh().catch(error=>notify({kind:'error',text:error.message}));const timer=setInterval(()=>void refresh().catch(()=>{}),4000);return()=>clearInterval(timer);},[]);
 useEffect(()=>{void refreshUpdates();const timer=setInterval(()=>void refreshUpdates(),10*60*1000);return()=>clearInterval(timer);},[]);
 const logins:Record<string,Login>={codex:useNativeLogin('codex',local),claude:useNativeLogin('claude',local)};
 const available=sourceOptions(local);
 const choose=(id:string)=>{setTab(id);onAgent(id);try{localStorage.setItem(tabKey,id);}catch{/* Only remembers the open tab. */}};
 const target=targets?.find(t=>t.id===tab)??targets?.[0];
 useEffect(()=>{onAgent(target?.id??tab);},[target?.id,tab,onAgent]);

 return <div className="tfPage">
  <ScrollRail className="tfTiles" role="tablist" aria-label="本地 Agent">
   {targets?.map(item=>{
    const connection=item.connection&&isSourceSelectionAvailable(available,item.connection)?item.connection:undefined;
    const native=logins[item.id]?.current;
    const problem=!!problemOf(item,calls,available);
    return <button key={item.id} role="tab" aria-selected={target?.id===item.id} tabIndex={target?.id===item.id?0:-1} className="tfTile" onClick={()=>choose(item.id)}>
     <ProviderIcon provider={item.id} size={30}/>
     <span className="tfTileText"><strong>{item.name}</strong><small>{connection?modelLabel(local.models,connection.model):native?`账号 · ${native.label}`:item.connection?'模型不可用':'未接入'}</small></span>
     <i className={`dot ${problem?'bad':connection||native?'ok':''}`} aria-label={problem?'有问题':connection||native?'使用中':'未接入'}/>
    </button>;
   })}
  </ScrollRail>
  {!targets&&<p className="tfHint">正在读取本机 Agent…</p>}
  {target&&<AgentPanel key={target.id} target={target} update={updates[target.id]} login={logins[target.id]} local={local} usage={usage} problem={problemOf(target,calls,available)} notify={notify} onRepair={onRepair} onChanged={refresh} onProgramChanged={refreshUpdates}/>}
 </div>;
}

function AgentPanel({target,update,login,local,usage,problem,notify,onRepair,onChanged,onProgramChanged}:{target:AgentTarget;update?:AgentUpdate;login?:Login;local:LocalAgentSnapshot;usage:UsageData;problem:string;notify:Notify;onRepair:(chain:MaintenanceChain)=>void;onChanged:()=>Promise<void>;onProgramChanged:()=>Promise<void>}){
 const [modelOrder,,modelRanks,moveModel]=useModelOrder();
 const [gatewayPending,setGatewayPending]=useState<boolean>();
 const [programOpen,setProgramOpen]=useState(!target.installation.installed);const [programAction,setProgramAction]=useState<'install'|'update'>('install');
 const pendingSelection=useRef<{selections:Choice[];preferred?:Choice}|undefined>(undefined);
 const programCompleted=useRef(false);
 const askProgram=(action:'install'|'update')=>{programCompleted.current=false;setProgramAction(action);setProgramOpen(true);};
 const updateAvailable=update?.status==='available'&&update.currentVersion===target.installation.version;
 const [restartOpen,setRestartOpen]=useState(false);const [restartError,setRestartError]=useState('');
 const [restartPending,setRestartPending]=useState(false);
 const [restoreOpen,setRestoreOpen]=useState(false);const [restoreHistory,setRestoreHistory]=useState(false);
 const [exitMessage,setExitMessage]=useState('');const retryMigration=useRef<()=>unknown>(()=>{});
 const [migrationProgress,setMigrationProgress]=useState(target.threadMigration);

 const desktopRestart=!!target.restartSupported&&['codex','qoder','workbuddy','deepseek'].includes(target.id);
 const configurationSaved=(restarted=false)=>{setRestartPending(desktopRestart&&!restarted);setRestartError('');setRestartOpen(desktopRestart&&!restarted);};
 const [busy,setBusy]=useState(false);const lock=useRef(false);const [picking,setPicking]=useState(false);const [open,setOpen]=useState('');
 useEffect(()=>{if(target.id!=='codex'||!busy)return;let active=true;const timer=setInterval(()=>{void requestJSON<NonNullable<AgentTarget['threadMigration']>>('/api/a2a/codex-migration').then(value=>{if(active)setMigrationProgress(value);}).catch(()=>{});},1500);return ()=>{active=false;clearInterval(timer);};},[target.id,busy]);
 const rememberDetail=useListReturn(!!open);

 const [hidden,setHidden]=useState<string[]>(()=>{try{return JSON.parse(localStorage.getItem(hiddenKey(target.id))??'[]');}catch{return [];}});
 const hide=(next:string[])=>{setHidden(next);try{localStorage.setItem(hiddenKey(target.id),JSON.stringify(next));}catch{/* Hiding is cosmetic. */}};
 const available=sourceOptions(local);const running=local.state==='running';
 const connection=target.connection;
 const [draftModels,setDraftModels]=useState<Choice[]>(()=>{try{const saved=JSON.parse(localStorage.getItem(`token-flow.agent.models.${target.id}`)??'[]');return Array.isArray(saved)?saved.filter(v=>typeof v?.model==='string'&&typeof v?.sourceId==='string'):[];}catch{return [];}});
 const [draftDirty,setDraftDirty]=useState(()=>{try{return localStorage.getItem(`token-flow.agent.models.pending.${target.id}`)==='true';}catch{return false;}});
 const saveDraft=(choices:Choice[],dirty=true)=>{setDraftModels(choices);setDraftDirty(dirty);try{localStorage.setItem(`token-flow.agent.models.${target.id}`,JSON.stringify(choices));localStorage.setItem(`token-flow.agent.models.pending.${target.id}`,String(dirty));}catch{}};

 const current=connection&&isSourceSelectionAvailable(available,connection)?{sourceId:connection.sourceId,model:connection.model}:undefined;
 const isCurrent=(choice:Choice)=>!!current&&current.sourceId===choice.sourceId&&current.model===choice.model;
 const models:Choice[]=draftDirty?draftModels:connection?.selections??(connection?[{sourceId:connection.sourceId,model:connection.model}]:draftModels.length?draftModels:target.backups.find(record=>record.selections)?.selections??[]);
 const shownModels=orderModels(models,choice=>modelLabel(local.models,choice.model),modelOrder==='manual'?'manual':'name',modelRanks);const modelIds=shownModels.map(item=>item.model);
 const moveAgentModel=(from:string,to:string,items:readonly string[],after=false)=>{if(from===to||!items.includes(from)||!items.includes(to))return;moveModel(from,to,items,after);const ids=items.filter(id=>id!==from);ids.splice(ids.indexOf(to)+(after?1:0),0,from);saveDraft(ids.flatMap(id=>models.filter(choice=>choice.model===id)));};
 const accounts=(login?.accounts??[]).filter(account=>account.current||!hidden.includes(`account:${account.id}`));
 const hiddenCount=(login?.accounts.length??0)-accounts.length;
 // Statistics follow the Agent itself, even after its connection Key was replaced by a model switch.
 const rows=usage.combinedRows.filter(row=>row.target===target.id);
 const allAgentRows=usage.allRows.filter(row=>row.day===localDay(new Date())).filter(row=>row.target===target.id);

 const run=async(work:()=>Promise<string>)=>{
  if(lock.current)return;lock.current=true;setBusy(true);
  try{const text=await work();setExitMessage('');notify({kind:'ok',text});}
  catch(error){if((error as {code?:string}).code==='codex_exit_required')setExitMessage(error instanceof Error?error.message:'请先退出 Codex。');else {setExitMessage('');notify({kind:'error',text:error instanceof Error?error.message:'操作失败'});}}
  finally{try{await onChanged().catch(()=>{});await login?.refresh();}finally{lock.current=false;setBusy(false);}}
 };
 // The revision guard rejects the write if the config changed since it was read.
 const latest=async()=>{
  const next=(await requestJSON<{targets:AgentTarget[]}>('/api/a2a')).targets.find(item=>item.id===target.id);
  if(!next)throw new Error('找不到这个 Agent，请刷新。');
  return next;
 };
 const applySelected=(selections:Choice[],preferred?:Choice)=>{
  if(!target.installation.installed){pendingSelection.current={selections,preferred};askProgram('install');return;}
  return connectSelected(selections,preferred);
 };
 const changeCodex=(work:(restartCodex:boolean)=>Promise<string>,approved=false,configurationOnly=false):Promise<void>|void=>{
  const automatic=target.id==='codex'&&desktopRestart;
  retryMigration.current=()=>changeCodex(work,true,configurationOnly);
  if(automatic&&!approved){setExitMessage(configurationOnly?'将自动退出 Codex，恢复账号或接口配置后重新打开。不备份或改写对话；部分旧对话可能仍需处理兼容性。':'将自动退出 Codex 并应用更改，完成后重新打开。已有备份会保留，仅在需要处理新对话时追加备份。');return;}
  setMigrationProgress(undefined);
  return run(()=>work(automatic&&approved));
 };
 const connectSelected=(selections:Choice[],preferred?:Choice)=>{
  saveDraft(selections,true);
  return changeCodex(async restartCodex=>{
  const choice=preferred??selections.find(item=>isCurrent(item))??selections[0];
  if(!choice)throw new Error('请至少选择一个模型。');
  saveDraft(selections,true);
  const next=await latest();
  await requestJSON('/api/a2a/connect',post({allowRunning:true,restartCodex,target:target.id,selections,sourceId:choice.sourceId,model:choice.model,revision:next.revision,...(next.connection?{replaceId:next.connection.id}:{}),tokenLimit:null}),600000);
  saveDraft(selections,false);configurationSaved(restartCodex);
  if(hidden.includes(choiceId(choice)))hide(hidden.filter(id=>id!==choiceId(choice)));
  const label=modelLabel(local.models,choice.model);
  const menu=target.id==='qoder'||target.id==='workbuddy'?`，在它的模型菜单里选 ${label}`:'';
  if(target.id==='pi'||target.id==='claude')return `${target.name} 已导入 ${selections.length} 个模型，下次启动时加载配置，可用 /model 选择模型。`;
  if(target.id==='deepseek')return `DeepSeek Harness 桌面版已导入 ${selections.length} 个模型，默认 ${label}；重新打开应用后生效。`;
  if(restartCodex)return `Codex 已配置 ${selections.length} 个模型，默认 ${label}，旧对话已迁移并自动重新打开。`;
  return `${target.name} 已配置 ${selections.length} 个模型，默认 ${label}。重启后可在 Agent 内切换${menu}。`;
 });};
 const restore=(promptRestart=true,history=false,approved=false)=>changeCodex(async restartCodex=>{
  const next=await latest();
  await requestJSON('/api/a2a/restore',post({id:next.connection!.id,revision:next.revision,allowRunning:true,restartCodex,restoreHistory:history}),600000);
  setRestoreOpen(false);saveDraft(models,false);if(promptRestart||restartCodex)configurationSaved(restartCodex);else setRestartPending(desktopRestart);
  return restartCodex?`Codex 已恢复原配置${history?'并处理旧对话':''}，已自动重新打开。`:`${target.name} 已恢复原配置，${desktopRestart?'重启':'下次启动'}后生效。`;
 },approved,!history);
 const restart=()=>run(async()=>{
  setRestartError('');
  const result=await requestJSON<{message:string}>('/api/a2a/restart',post({target:target.id}),60000).catch(error=>{setRestartError(error instanceof Error?error.message:'重启失败');throw error;});
  setRestartPending(false);setRestartOpen(false);
  return result.message;
 });
 const switchAccount=(id:string,label:string)=>changeCodex(async restartCodex=>{const note=await login!.switchTo(id,restartCodex);configurationSaved(restartCodex);return `${target.name} 已切换到账号 ${label}。${restartCodex?'Codex 已自动重新打开。':`${desktopRestart?'重启':'下次启动'}后生效。`}${note}`;},false,true);
 const repair=()=>onRepair({target:target.id,...(connection?{sourceId:connection.sourceId,model:connection.model,connectionId:connection.id}:{})});
 const toggleDetail=(id:string)=>{if(open!==id)rememberDetail();setOpen(open===id?'':id);};

 const manageProgram=(action=programAction)=>run(async()=>{
  const result=await requestJSON<{message:string;installation:AgentInstallation}>('/api/a2a/program',post({target:target.id,action}),195000);
  programCompleted.current=true;setProgramOpen(false);
  await onProgramChanged();
  return result.message;
 });
 useEffect(()=>{if(!busy&&target.installation.installed&&pendingSelection.current){const pending=pendingSelection.current;pendingSelection.current=undefined;void connectSelected(pending.selections,pending.preferred);}},[busy,target.installation.installed]);
 return <section className="tfPanel" aria-label={target.name}>
  <header className="tfPanelHead">
   <ProviderIcon provider={target.id} size={40}/>
   <div><div className="tfAgentTitle"><h2>{target.name}</h2><button className="tfAgentUpdate" disabled={busy} aria-label={`${target.installation.installed?'更新':'安装'} ${target.name}`} title={updateAvailable?`有新版本 ${update.latestVersion}，点击更新`:target.installation.installed?'下载最新版':'安装官方客户端'} onClick={()=>target.installation.installed?void manageProgram('update'):askProgram('install')}><Icon name="download" size={15}/>{updateAvailable&&<span className="tfUpdateDot" role="img" aria-label="有可用更新"/>}</button>{target.installation.installed&&<span className="tfAgentVersion">已安装{target.installation.version?` · ${target.installation.version}`:''}</span>}</div><UsageFold title={`${target.name} 用量`} rows={allAgentRows} range="today"/></div>
   <div className="tfRow">
    {!models.length&&<button className="textButton" disabled={busy||!running||!!target.error||!available.length} onClick={()=>setPicking(true)}><Icon name="plus" size={15}/>选择模型</button>}
    {desktopRestart&&<button className="textButton" disabled={busy||!target.installation.installed} onClick={()=>{setRestartError('');setRestartOpen(true);}}>{restartPending?'重启生效':'重启…'}</button>}
    {connection&&<button disabled={busy} onClick={()=>{if(target.id==='codex'){setRestoreHistory(false);setRestoreOpen(true);}else void restore();}}>恢复原配置</button>}
    <button className={problem?'primary':''} onClick={repair}><Icon name="wrench" size={14}/>维修</button>
   </div>
  </header>
  {target.id==='codex'&&!!target.threadMigration?.unavailable&&<p className="tfHint" role="status">已跳过 {target.threadMigration.unavailable} 条缺少历史文件的旧对话，其余对话和登录切换不受影响。记录与备份已保留；恢复原配置默认不处理对话。</p>}
  {busy&&migrationProgress&&migrationProgress.phase!=='idle'&&<p className="tfHint" role="status">{migrationProgress.phase==='backup'?'正在备份旧对话…':`${migrationProgress.phase==='restoring'?'正在还原':'正在迁移'}旧对话 ${migrationProgress.done} / ${migrationProgress.total}`}，完成后将自动重新打开 Codex。</p>}
  <FlowDialog open={restoreOpen} title="恢复 Codex 原配置" busy={busy} onClose={()=>setRestoreOpen(false)}>
   <p className="tfDialogLead">恢复接入网关前的接口与模型设置，并停用这条网关连接。</p>
   <p className="tfHint">默认只恢复配置，不读取、备份或改写对话。已有备份保留；这不会修复缺失的历史文件，部分网关旧对话可能仍无法继续，可先新建对话使用原配置。</p>
   <label><input type="checkbox" checked={restoreHistory} disabled={busy} onChange={event=>setRestoreHistory(event.target.checked)}/>同时处理旧对话兼容性（可选）</label>
   {restoreHistory&&<p className="tfHint">将检查旧对话，必要时备份并转换历史。处理失败可能中止恢复；取消勾选后可只恢复配置。</p>}
   {desktopRestart&&<p className="tfHint">请先保存工作。确认后会结束 Codex 及其运行中的任务，完成后自动重新打开。</p>}
   <footer><button disabled={busy} onClick={()=>setRestoreOpen(false)}>取消</button><button className="primary" disabled={busy} onClick={()=>void restore(true,restoreHistory,true)}>{busy?'正在恢复…':restoreHistory?'恢复配置并处理旧对话':'只恢复原配置'}</button></footer>
  </FlowDialog>
  <FlowDialog className="tfRestartDialog" open={!!exitMessage} title={desktopRestart?'重启 Codex 并应用更改':'先退出 Codex，保留旧对话'} onClose={()=>setExitMessage('')} busy={busy}>
   <p className="tfDialogLead">{exitMessage}</p>
   <p className="tfHint">{desktopRestart?'请先保存工作。确认后将结束 Codex 及其运行中的任务，全程自动完成，无需手动退出或再次点击重启。':'请完全退出 Codex 后继续。'}</p>
   <p className="tfHint">切换后的首次回复可能较慢：模型需要重新读取历史，长对话还可能需要整理上下文。请等待完成，避免连续重试。</p>
   {busy&&<p className="tfHint" role="status">{migrationProgress?.lifecyclePhase==='stopping'?'正在退出 Codex…':migrationProgress?.lifecyclePhase==='opening'?'正在重新打开 Codex…':migrationProgress?.phase==='backup'?`正在备份旧对话 ${migrationProgress.done} / ${migrationProgress.total}…`:migrationProgress?.phase==='migrating'||migrationProgress?.phase==='restoring'?`正在${migrationProgress.phase==='restoring'?'还原':'迁移'}旧对话 ${migrationProgress.done} / ${migrationProgress.total}…`:migrationProgress?.lifecyclePhase==='changing'?'正在应用配置并检查需要处理的对话…':'正在准备应用更改，请稍候…'}</p>}
   <footer><button disabled={busy} onClick={()=>setExitMessage('')}>稍后再说</button><button className="primary" disabled={busy} onClick={()=>void retryMigration.current()}>{busy?'正在处理…':desktopRestart?'确认并自动重启':'已退出，继续'}</button></footer>
  </FlowDialog>
  {!target.installation.installed&&<p className="tfHint" role="status">{target.installation.supported===false?target.installation.reason:'未检测到程序，选择模型时会提示安装。'}</p>}
  <FlowDialog open={programOpen} title={`${programAction==='install'?'安装':'更新'} ${target.name}`} busy={busy} onClose={()=>{setProgramOpen(false);if(!programCompleted.current)pendingSelection.current=undefined;}}>
   <p className="tfDialogLead">{target.installation.supported===false?target.installation.reason:target.installation.automatic?`将从官方发布通道${programAction==='install'?'下载并安装':'更新'} ${target.name}。配置和接入备份会保留。`:`将打开 ${target.name} 的官方下载页面，安装完成后会自动识别。`}</p>
   {programAction==='update'&&<p className="tfHint">请先保存工作并退出此 Agent。</p>}
   <footer><button disabled={busy} onClick={()=>{setProgramOpen(false);pendingSelection.current=undefined;}}>稍后再说</button><button className="primary" disabled={busy} onClick={()=>void manageProgram()}>{busy?'正在处理…':target.installation.automatic?programAction==='install'?'下载安装':'更新到最新版本':'打开官方下载页面'}</button></footer>
  </FlowDialog>
  {problem&&<p className="tfProblem" role="status">{problem}</p>}
  {target.id==='qoder'&&<p className="tfHint">此入口接入 Qoder 独立应用；Qoder IDE 的授权账号在「账号授权」管理。</p>}
  <FlowDialog className="tfRestartDialog" open={desktopRestart&&restartOpen} title={restartPending?'配置已保存，现在生效？':`重启 ${target.name}`} onClose={()=>setRestartOpen(false)} busy={busy}>
   <p className="tfDialogLead">{restartPending?`重新打开 ${target.name} 后，会加载新的模型与账号配置。`:`重新打开 ${target.name}，加载已保存的配置。`}</p>
   <p className="tfHint">{target.id==='codex'?'请先保存工作。确认后将自动结束 Codex 及其运行中的任务，然后重新打开。':'请先保存工作并结束生成。你也可以稍后从 Agent 标题旁重启。'}</p>
   {restartError&&<p className="tfError" role="alert">{restartError}</p>}
   <footer><button disabled={busy} onClick={()=>setRestartOpen(false)}>稍后再说</button><button className="primary" disabled={busy||!target.installation.installed} onClick={()=>void restart()}>{busy?'正在处理…':'立即重启'}</button></footer>
  </FlowDialog>
  {!running&&<p className="tfHint">网关未运行，暂时不能切换模型。</p>}
  {login?.error&&<p className="tfError">{login.error}</p>}

  <div className={`tfAgentColumns${login&&accounts.length&&models.length?' hasLogin':''}`}>
  {login&&accounts.length>0&&<section className="tfAgentSection" aria-label="官方登录账号">
   <header className="tfAgentSectionHead"><h3>官方登录账号</h3></header>
  <ul className="tfLines" aria-label={`${target.name} 官方登录账号`}>
   {accounts.map(account=>{
    const id=`account:${account.id}`;const quota=local.quotas[account.id];
    return <li key={id} className={account.current?'on':''}>
     <div className="tfLine">
      <button className="tfLineMain" aria-pressed={account.current} disabled={busy||account.current||!account.switchable} title={account.switchable?undefined:account.reason} onClick={()=>void switchAccount(account.id,account.label)}>
       <span className={`tfLoginRadio ${account.current?'on':''}`} aria-hidden="true"/>
       <ProviderIcon provider={target.id} size={22}/>
       <span className="tfKind">账号</span>
       <span className="tfRowText"><strong title={account.label}>{account.label}</strong><small>官方登录{account.remaining===null?'':` · 剩余 ${Math.round(account.remaining)}%`}{!account.switchable&&account.reason?` · ${account.reason}`:''}</small></span>
       {account.current?<b className="tfUsing">使用中</b>:<span className="tfSwitch">切换</span>}
      </button>
      <span className="tfActions">
       <button className="textButton" onClick={()=>toggleDetail(id)}>{open===id?'收起':'详情'}</button>
       <button className="textButton danger" disabled={account.current} title={account.current?'正在使用，不能删除':'从这里移除，账号本身保留'} onClick={()=>hide([...hidden,id])}>删除</button>
      </span>
     </div>
     {open===id&&<div className="tfUsage"><strong>额度</strong>{quota?<QuotaDetails quota={quota} label={account.label} compact/>:<span>额度暂未提供</span>}</div>}
    </li>;
   })}
  </ul>
  {hiddenCount>0&&<button className="textButton" onClick={()=>hide([])}>恢复已删除的 {hiddenCount} 项</button>}
  </section>}
  {login&&accounts.length>0&&models.length>0&&<ColumnDivider storageKey="token-flow.layout.agent-split" label="调整账号与网关模型宽度"/>}
  {models.length>0&&<section className="tfAgentSection tfGatewaySection" aria-label="网关模型">
   <header className="tfAgentSectionHead"><div className="tfGatewayTitle"><h3>网关模型</h3><button className="tfAddButton" disabled={busy||!running||!!target.error||!available.length} onClick={()=>setPicking(true)}><Icon name="plus" size={15}/>{available.length?(models.length?'管理所选模型':'选择模型'):'先添加账号或 API 接口'}</button>{draftDirty&&<small className="tfPendingModels">待应用</small>}</div><label className="toggle"><input type="checkbox" role="switch" aria-label="启用网关模型" checked={gatewayPending??(!!connection&&target.configurationState==='configured'&&!draftDirty)} disabled={busy||!running||(!connection&&!models.length)} onChange={event=>{const enabled=event.target.checked;if(!enabled)saveDraft(models);setGatewayPending(enabled);void Promise.resolve(enabled?applySelected(shownModels):restore(false)).finally(()=>setGatewayPending(undefined));}}/><span>启动</span></label></header>
   {target.id==='claude'&&<p className="tfHint">自定义模型菜单需要 Claude Code 2.1.242 或更新版本；旧版可用 /model 模型ID 切换。</p>}
  <ul className="tfLines" aria-label={`${target.name} 网关模型`}>
   {shownModels.map(choice=>{
    const id=choiceId(choice);const on=isCurrent(choice);
    const used=totalsOf(rows.filter(row=>row.model===choice.model&&(!row.sourceId||row.sourceId===choice.sourceId)));
    return <li key={id} className={`tfDragRow ${on?'on':''}`} {...dropOrder('models',choice.model,modelIds,moveAgentModel)}>
     <div className="tfLine">
      <DragHandle kind="models" id={choice.model} label={modelLabel(local.models,choice.model)} items={modelIds} move={moveAgentModel}/>
      <div className="tfLineMain tfModelCardMain">
       <ProviderIcon provider={available.find(source=>source.id===choice.sourceId)?.provider??'api'} size={22}/>
       <span className="tfRowText"><strong title={modelLabel(local.models,choice.model)}>{modelLabel(local.models,choice.model)}</strong><small>{sourceLabel(local,choice.sourceId)}{used.requests?` · ${compactTokens(used.totalTokens)} tokens`:''}</small></span>
       {on&&target.configurationState==='configured'&&<b className="tfUsing">{target.id==='pi'?'已导入':'默认模型'}</b>}
      </div>
      <span className="tfActions">
       <button className="textButton" onClick={()=>toggleDetail(id)}>{open===id?'收起':'详情'}</button>
       <button className="textButton danger" disabled={busy||models.length===1} title={models.length===1?'至少保留一个模型，或恢复原配置退出网关':'从 Agent 的模型菜单移除'} onClick={()=>{const next=models.filter(item=>choiceId(item)!==id);saveDraft(next);if(open===id)setOpen('');}}>移除</button>
      </span>
     </div>
     {open===id&&<div className="tfUsage">
      <strong>Token 使用（{rangeLabel(usage.range)}）</strong>
      <span>{used.requests?`${formatTokens(used.requests)} 次请求${used.failed?`（${formatTokens(used.failed)} 次失败）`:''} · ${formatTokens(used.totalTokens)} tokens`:'这段时间还没有请求'}</span>
      {used.requests>0&&<span>未缓存输入 {formatTokens(used.uncachedTokens)} · 缓存读取 {formatTokens(used.cachedTokens)}（命中 {percentText(used.hitRate)}） · 输出 {formatTokens(used.outputTokens)}{used.last?` · 最近 ${new Date(used.last).toLocaleString()}`:''}</span>}
      <small>{modelLabel(local.models,choice.model)} · {sourceLabel(local,choice.sourceId)}</small>
     </div>}
    </li>;
   })}
  </ul>

  </section>}
  </div>
  <AgentModelPicker open={picking} title={`${target.name} 使用的模型`} local={local} current={current} selected={models} onConfirm={choices=>{saveDraft(choices);if(connection)void applySelected(choices);else void applySelected(choices);}} onClose={()=>setPicking(false)}/>
 </section>;
}
