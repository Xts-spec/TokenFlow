import type {MaintenanceContext} from '../../../packages/core/src/maintenance-conversations';
import {useState,useRef,useLayoutEffect,useEffect,useId} from 'react';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import type {GatewayKey} from '../../../packages/core/src/gateway-keys';
import {requestJSON} from './request';
import {copyText} from './clipboard';
import {modelGroups,type Choice} from './flow-model';
import {KeyActions,useKeyHold} from './KeyCard';
import {compactTokens,localDay} from './usage-model';
import type {UsageData} from './usage-data';
import {DailyChart,ModelUsage,SourceUsage,UsageFold,UsageSummary} from './UsagePanel';
import {TracePanel} from './TracePanel';
import {AgentModelPicker} from './AgentModelPicker';
import {ModelPicker} from './ModelPicker';
import {FlowDialog} from './FlowDialog';
import {SwitchTabs} from './SwitchTabs';
import {qualifiedModelLabel as modelLabel} from './model-label';
import {DragHandle,dropOrder,ModelOrderControl,orderModels,orderKeys,useModelOrder,useKeyOrder,type KeyOrder} from './display-order';
import {Icon} from './Icons';
import type {Notify} from './notify';
const json=(method:string,body:unknown)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
function InlineText({value,placeholder='',label,active,disabled,saving,onStart,onSave,onCancel,onInput}:{value:string;placeholder?:string;label:string;active:boolean;disabled:boolean;saving:boolean;onStart:()=>void;onSave:(value:string)=>void;onCancel:()=>void;onInput:()=>void}){
 const input=useRef<HTMLInputElement>(null),skipBlur=useRef(false);const [draft,setDraft]=useState(value);
 useLayoutEffect(()=>{if(!active)setDraft(value);skipBlur.current=false;},[active,value]);
 useEffect(()=>{if(active){input.current?.focus({preventScroll:true});input.current?.select();}},[active]);
 return <span className="tfInlineField">
  {active&&<span className="tfInlineMinimum" aria-hidden="true">{label==='名称'?'名名名名':placeholder}</span>}
  <span className="tfInlineEdit" aria-hidden={active||undefined} style={active?{visibility:'hidden'}:undefined} role={active?undefined:'button'} aria-disabled={disabled||undefined} tabIndex={active||disabled?-1:0} title={active?undefined:`双击修改${label}`} onDoubleClick={()=>{if(!disabled&&!active)onStart();}} onKeyDown={event=>{if(!disabled&&(event.key==='F2'||event.key==='Enter')){event.preventDefault();onStart();}}}>{active?draft||'\u200b':value||placeholder}</span>
  {active&&<input ref={input} className="tfInlineInput" aria-label={label} aria-busy={saving||undefined} value={draft} readOnly={saving} maxLength={label==='名称'?80:160} size={1} spellCheck={false} onChange={event=>{setDraft(event.target.value);skipBlur.current=false;onInput();}} onBlur={event=>{if(!saving&&!skipBlur.current)onSave(event.currentTarget.value);}} onKeyDown={event=>{
   if(event.nativeEvent.isComposing||event.nativeEvent.keyCode===229)return;
   if(event.key==='Escape'){event.preventDefault();event.stopPropagation();if(!saving){skipBlur.current=true;onCancel();}}
   else if(event.key==='Enter'){event.preventDefault();if(!saving){skipBlur.current=true;onSave(event.currentTarget.value);}}
  }}/>}
 </span>;
}
function KeyRenameDialog({entry,onClose,onChanged}:{entry:GatewayKey;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [name,setName]=useState(entry.name),[busy,setBusy]=useState(false),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null),lock=useRef(false);
 useEffect(()=>{input.current?.focus({preventScroll:true});input.current?.select();},[]);
 const save=async()=>{const value=name.trim();if(lock.current||!value)return;if(value===entry.name){onClose();return;}lock.current=true;setBusy(true);setError('');
  try{await requestJSON(`/api/gateway-keys/${entry.id}`,json('PUT',{name:value,purpose:entry.purpose,enabled:entry.enabled,models:entry.models,agents:entry.agents,tokenLimit:entry.tokenLimit}));await onChanged();onClose();}
  catch(error){setError(error instanceof Error?error.message:'保存失败，请重试。');}
  finally{lock.current=false;setBusy(false);}
 };
 return <FlowDialog open title="重命名" className="tfKeyRenameDialog" busy={busy} showBusyIndicator={false} onClose={onClose}><form aria-label="重命名 Key" onSubmit={event=>{event.preventDefault();void save();}}><label>名称<input ref={input} aria-label="名称" value={name} disabled={busy} maxLength={80} required onChange={event=>{setName(event.target.value);setError('');}}/></label>{error&&<p className="tfError" role="alert">{error}</p>}<footer><button type="button" disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||!name.trim()}>{busy?'正在保存…':'保存'}</button></footer></form></FlowDialog>;
}
function CopyField({label,value,notify}:{label:string;value:string;notify:Notify}){
 const [copied,setCopied]=useState(false);
 return <label>{label}<div className="inputAction"><input aria-label={label} readOnly value={value} onFocus={event=>event.target.select()}/><button type="button" onClick={()=>void copyText(value).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);}).catch(()=>notify({kind:'error',text:'复制失败，请选中后手动复制。'}))}>{copied?'已复制':'复制'}</button></div></label>;
}
function KeyDetails({entry,initialKey,initialTab,temporary,local,usage,notify,onClose,onChanged}:{entry:GatewayKey;initialKey:string;initialTab:string;temporary:boolean;local:LocalAgentSnapshot;usage:UsageData;notify:Notify;onClose:()=>void;onChanged:()=>Promise<void>}){
 const breakdownId=useId();const [breakdown,setBreakdown]=useState<'model'|'source'>('model');const [protocol,setProtocol]=useState<'openai'|'anthropic'>('openai');
 const [modelOrder,setModelOrder,modelRanks,moveModel]=useModelOrder();const [confirmDelete,setConfirmDelete]=useState(initialTab==='delete');const [managementError,setManagementError]=useState('');
 const [tab,setTab]=useState(initialTab==='usage'?'usage':'connection');const [picking,setPicking]=useState(false);const [secret,setSecret]=useState(initialKey);const [visible,setVisible]=useState(false);const [busy,setBusy]=useState(false);const lock=useRef(false);const [error,setError]=useState('');const [copied,setCopied]=useState('');
 const stepRoot=useRef<HTMLDivElement>(null),modelTrigger=useRef<HTMLButtonElement>(null),detailScroll=useRef(0),returningFromModels=useRef(false);
 useLayoutEffect(()=>{const dialog=stepRoot.current?.closest('dialog');if(!dialog)return;if(picking){dialog.scrollTop=0;returningFromModels.current=true;}else if(returningFromModels.current){dialog.scrollTop=detailScroll.current;modelTrigger.current?.focus({preventScroll:true});returningFromModels.current=false;}},[picking]);
 const [editing,setEditing]=useState<''|'name'|'purpose'>(initialTab==='rename'?'name':'');const [metadataSaving,setMetadataSaving]=useState(false);const [metadataError,setMetadataError]=useState('');
 const beginEdit=(field:'name'|'purpose')=>{setMetadataError('');setEditing(field);};
 const saveDetails=async(field:'name'|'purpose',text:string)=>{
  if(lock.current)return;const value=text.replace(/[\r\n]+/g,' ').trim();
  if(field==='name'&&!value){setMetadataError('名称不能为空。');return;}
  if(value.length>(field==='name'?80:160)){setMetadataError(`${field==='name'?'名称不能超过 80':'用途不能超过 160'} 个字。`);return;}
  if(value===(field==='name'?entry.name:entry.purpose??'')){setEditing('');setMetadataError('');return;}
  lock.current=true;setMetadataSaving(true);setMetadataError('');
  try{await requestJSON(`/api/gateway-keys/${entry.id}`,json('PUT',{name:field==='name'?value:entry.name,purpose:field==='purpose'?value:entry.purpose??'',enabled:entry.enabled,models:entry.models,agents:entry.agents,tokenLimit:entry.tokenLimit}));await onChanged();setEditing('');}
  catch(error){setMetadataError(error instanceof Error?error.message:'保存失败，请重试。');}
  finally{lock.current=false;setMetadataSaving(false);}
 };
 const groups=modelGroups(local);
 const selected=entry.models.map(model=>{const matches=groups.filter(group=>group.models.some(item=>item.id===model));return {model,sourceId:entry.modelSources?.[model]??entry.sourceId??(matches.length===1?matches[0].id:'')};});
 const saveModels=async(selections:Choice[])=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await requestJSON(`/api/gateway-keys/${entry.id}/models`,json('PUT',{selections}));await onChanged();setPicking(false);notify({kind:'ok',text:'模型权限已更新，原 Key 继续使用。'});}catch(error){setError(error instanceof Error?error.message:'模型权限保存失败，请重试。');}finally{lock.current=false;setBusy(false);}};
 const manage=async(action:'toggle'|'delete')=>{if(lock.current)return;lock.current=true;setBusy(true);setManagementError('');try{await requestJSON(`/api/gateway-keys/${entry.id}`,action==='delete'?json('DELETE',{}):json('PUT',{name:entry.name,purpose:entry.purpose,enabled:!entry.enabled,models:entry.models,agents:entry.agents,tokenLimit:entry.tokenLimit}));await onChanged();if(action==='delete')onClose();else notify({kind:'ok',text:entry.enabled?'Key 已停用':'Key 已启用'});}catch(error){setManagementError(error instanceof Error?error.message:'操作失败，请重试');}finally{lock.current=false;setBusy(false);}};
 const sortedModels=orderModels(entry.models,id=>modelLabel(local,id),modelOrder,modelRanks);
 const origin=window.location.origin;const keyRows=usage.rows.filter(row=>row.keyId===entry.id);
 const secretAction=async(action:'show'|'copy'|'all')=>{
  if(lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   const value=secret||(await requestJSON<{apiKey:string}>(`/api/gateway-keys/${entry.id}/reveal`,json('POST',{}))).apiKey;
   setSecret(value);
   if(action==='show')setVisible(true);
   else{await copyText(action==='copy'?value:`名称: ${entry.name}\n用途: ${entry.purpose||'未填写'}\nOpenAI Base URL: ${origin}/v1\nAnthropic Base URL: ${origin}\nAPI Key: ${value}\nModels:\n${entry.models.join('\n')}`);setCopied(action);setTimeout(()=>setCopied(''),1500);}
  }catch(error){setError(error instanceof Error?error.message:'读取或复制失败，请重试。');}
  finally{lock.current=false;setBusy(false);}
 };
 return <FlowDialog open title={`Key 详情 · ${entry.name}`} titleContent={<div className="tfKeyIdentity"><h2><InlineText value={entry.name} label="名称" active={editing==='name'} disabled={busy||picking||metadataSaving} saving={metadataSaving&&editing==='name'} onStart={()=>beginEdit('name')} onSave={value=>void saveDetails('name',value)} onCancel={()=>{setEditing('');setMetadataError('');}} onInput={()=>setMetadataError('')}/></h2><span className={`tfKeyStatus ${entry.enabled?'on':''}`}>{entry.enabled?'已启用':'已停用'}</span><time dateTime={entry.createdAt}>创建于 {new Date(entry.createdAt).toLocaleDateString('zh-CN')}</time></div>} className="tfKeyDetail tfSettingsDetail" headerActions={!picking&&<KeyActions name={entry.name} enabled={entry.enabled} disabled={busy||metadataSaving||!!editing||confirmDelete} onRename={()=>beginEdit('name')} onToggle={()=>void manage('toggle')} onDelete={()=>setConfirmDelete(true)}/>} busy={busy} showBusyIndicator={!picking} onClose={()=>picking?setPicking(false):onClose()}>
  <div ref={stepRoot} className="tfKeyStep">
  {picking?<ModelPicker embedded open title="管理 Key 支持的模型" local={local} selected={selected} allowEmpty busy={busy} error={error} closeOnConfirm={false} confirmLabel="保存模型权限" onConfirm={choices=>void saveModels(choices)} onClose={()=>setPicking(false)}/>:<>
  {managementError&&<p className="tfError" role="alert">{managementError}</p>}
  {confirmDelete&&<div className="tfKeyDeleteConfirm" role="alert"><p>删除后，使用此 Key 的应用将无法调用。</p><div className="tfRow"><button disabled={busy} onClick={()=>setConfirmDelete(false)}>取消</button><button className="textButton danger" disabled={busy} onClick={()=>void manage('delete')}>{busy?'正在删除…':'确认删除'}</button></div></div>}
  <div className="tfKeyDescription"><p className="tfDialogLead"><InlineText value={entry.purpose??''} placeholder="暂未填写用途" label="用途" active={editing==='purpose'} disabled={busy||metadataSaving} saving={metadataSaving&&editing==='purpose'} onStart={()=>beginEdit('purpose')} onSave={value=>void saveDetails('purpose',value)} onCancel={()=>{setEditing('');setMetadataError('');}} onInput={()=>setMetadataError('')}/></p></div>
  {metadataError&&<p className="tfError" role="alert">{metadataError}</p>}

  <SwitchTabs className="tfDetailTabs" label="Key 详情分类" value={tab} options={[["connection","接入信息"],["usage","使用情况"]]} disabled={busy} idPrefix={`${breakdownId}-detail`} panelId={`${breakdownId}-detail-panel`} onChange={id=>{setTab(id);setError('');}}/>
  <div className="tfDetailBody" id={`${breakdownId}-detail-panel`} role="tabpanel" aria-labelledby={`${breakdownId}-detail-${tab}`}>
   {(tab==='connection'||tab==='models')&&<>
    <section className="tfKeyEndpoint" aria-label="接入地址"><SwitchTabs label="接口格式" value={protocol} options={[["openai","OpenAI"],["anthropic","Anthropic"]]} idPrefix={`${breakdownId}-protocol`} panelId={`${breakdownId}-endpoint-panel`} onChange={setProtocol}/><div id={`${breakdownId}-endpoint-panel`} role="tabpanel" aria-labelledby={`${breakdownId}-protocol-${protocol}`}><CopyField key={protocol} label={`${protocol==='openai'?'OpenAI':'Anthropic'} 格式 Base URL`} value={protocol==='openai'?`${origin}/v1`:origin} notify={notify}/></div></section>
    <label>API Key<div className="inputAction"><input aria-label="导出的 API Key" type={visible?'text':'password'} readOnly value={secret||'********'} onFocus={event=>event.target.select()}/><button type="button" disabled={busy} onClick={()=>visible?setVisible(false):void secretAction('show')}>{visible?'隐藏':'显示'}</button><button type="button" disabled={busy} onClick={()=>void secretAction('copy')}>{copied==='copy'?'已复制':'复制 Key'}</button></div></label>
    {temporary&&<p className="tfHint">此环境未启用加密存储，请在关闭详情前保存 Key。</p>}
    {error&&<p className="tfError" role="alert">{error}</p>}
    <p className="tfHint">127.0.0.1 仅供本机使用。其他设备需填写可达的网关地址。</p>
   <section className="tfConnectionModels" aria-label="支持模型"><div className="tfModelsHead"><div className="tfKeyModelsTitle"><h3>模型</h3><small>{entry.models.length} 个</small><ModelOrderControl value={modelOrder} onChange={setModelOrder}/></div><button ref={modelTrigger} className="textButton" disabled={busy} onClick={()=>{detailScroll.current=stepRoot.current?.closest('dialog')?.scrollTop??0;setError('');setPicking(true);}}>管理模型</button></div>{error&&<p className="tfError" role="alert">{error}</p>}{!entry.models.length&&<p className="tfHint">尚未授权模型，此 Key 暂时无法调用。点击管理模型添加。</p>}<ul className="tfKeyModels">{sortedModels.map(id=><li key={id} className="tfDragRow" {...dropOrder('models',id,sortedModels,moveModel)}><div className="tfDragTitle"><DragHandle kind="models" id={id} label={modelLabel(local,id)} items={sortedModels} move={moveModel}/><strong>{modelLabel(local,id)}</strong></div><button className="textButton" aria-label={`复制模型 ${modelLabel(local,id)}`} onClick={()=>void copyText(id).then(()=>{setCopied(id);setTimeout(()=>setCopied(''),1500);}).catch(()=>setError('复制失败'))}>{copied===id?'已复制':'复制'}</button></li>)}</ul></section>
    <button className="primary" disabled={busy} onClick={()=>void secretAction('all')}>{copied==='all'?'已复制':'复制完整接入信息'}</button>
   </>}

   {tab==='usage'&&<>
    <dl className="tfUsageStats"><div><dt>累计 Tokens</dt><dd>{compactTokens(entry.usedTokens)}</dd></div><div><dt>额度上限</dt><dd>{entry.tokenLimit===null?'不限':compactTokens(entry.tokenLimit)}</dd></div></dl>
    <UsageSummary title="按时间统计" rows={keyRows} range={usage.range} onRange={usage.setRange} loaded={usage.loaded} hint={usage.error||undefined}/>
    <DailyChart rows={keyRows} range={usage.range}/><TracePanel compact range={usage.range} filter={{keyId:entry.id}}/>
    <SwitchTabs className="tfBreakTabs tfKeyBreakTabs" label="Key 用量分类" value={breakdown} options={[["model","模型"],["source","来源账号"]]} idPrefix={breakdownId} panelId={`${breakdownId}-panel`} onChange={setBreakdown}/>
    <div id={`${breakdownId}-panel`} role="tabpanel" aria-labelledby={`${breakdownId}-${breakdown}`}>
     {breakdown==='model'?<ModelUsage local={local} rows={keyRows} title="按模型" empty="这段时间此 Key 还没有请求。"/>:<SourceUsage local={local} rows={keyRows} title="按来源账号 · 官方额度" empty="这段时间此 Key 还没有请求。"/>}
    </div>
   </>}
  </div>

  </>}
  </div>
 </FlowDialog>;
}
export function KeyOutflow({local,keys,usage,reload,notify,onContext}:{onContext?:(context:MaintenanceContext)=>void;local:LocalAgentSnapshot;keys:GatewayKey[];usage:UsageData;reload:()=>Promise<void>;notify:Notify}){
 const [keyOrder,setKeyOrder,keyRanks,moveKey]=useKeyOrder();const [modelOrder,,modelRanks]=useModelOrder();const sortedKeys=orderKeys(keys,keyOrder,keyRanks);const keyIds=sortedKeys.map(key=>key.id);const hold=useKeyHold(moveKey,keyIds);
 const scopes=modelGroups(local);const [creating,setCreating]=useState(false);const [name,setName]=useState('');const [purpose,setPurpose]=useState('');const [chosen,setChosen]=useState<Choice[]>([]);
 const [renaming,setRenaming]=useState('');const renameEntry=keys.find(key=>key.id===renaming);
 const [detail,setDetail]=useState<GatewayKey|null>(null);const [detailTab,setDetailTab]=useState('connection');const [created,setCreated]=useState({id:'',value:'',temporary:false});const [busy,setBusy]=useState(false);const lock=useRef(false);const [error,setError]=useState('');
 useEffect(()=>onContext?.({page:'proxy',keyId:detail?.id,range:detail?usage.range:'today',origin:'gateway'}),[detail?.id,usage.range,onContext]);
 // Every call made with a Key created here, whatever model or account served it.
 const proxyRows=usage.allRows.filter(row=>row.target==='key'&&row.day===localDay(new Date())&&row.origin!=='native');
 const models=chosen.map(choice=>choice.model);const valid=chosen.every(choice=>scopes.some(scope=>scope.id===choice.sourceId&&scope.models.some(model=>model.id===choice.model)));
 const act=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();await reload();}catch(error){const message=error instanceof Error?error.message:'操作失败';setError(message);notify({kind:'error',text:message});}finally{lock.current=false;setBusy(false);}};
 const create=()=>act(async()=>{
  const result=await requestJSON<{apiKey:string;key:GatewayKey;keyStored:boolean}>('/api/gateway-keys',json('POST',{name:name.trim()||`本地 Key ${keys.length+1}`,purpose:purpose.trim(),enabled:true,models,modelSources:Object.fromEntries(chosen.map(choice=>[choice.model,choice.sourceId])),agents:['codex','claude','openai'],tokenLimit:null}));
  setCreated({id:result.key.id,value:result.apiKey,temporary:!result.keyStored});setDetailTab('connection');setDetail(result.key);setCreating(false);
 });

 const closeDetail=()=>{setDetail(null);setCreated({id:'',value:'',temporary:false});};
 return <section className="tfKeys" aria-label="本地 API Key">
  <header className="tfKeysHead"><UsageFold loaded={usage.loaded} error={usage.error} onRetry={usage.reload} title="API 代理用量" subtitle="今日 API 代理用量与缓存命中" rows={proxyRows} range="today"/><select className="tfOrder" aria-label="Key 排序" value={keyOrder} onChange={event=>setKeyOrder(event.target.value as KeyOrder)}><option value="newest">最新创建</option><option value="name">名称 A–Z</option><option value="tokens">累计 Token</option><option value="manual">手动排序</option></select><button className="primary" disabled={busy||!scopes.length||creating} onClick={()=>{setCreating(true);setName('');setPurpose('');setChosen([]);setError('');}}><Icon name="plus" size={15}/>创建 Key</button></header>
  {creating&&<FlowDialog open title="创建 Key" className="tfKeyCreateDialog" busy={busy} onClose={()=>setCreating(false)}><form className="tfKeyCreate" aria-label="创建 API Key" onSubmit={event=>{event.preventDefault();void create();}}><div className="tfKeyFields"><label>名称<input autoFocus value={name} disabled={busy} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="例如：我的编码工具"/></label><label>用途<input value={purpose} disabled={busy} maxLength={160} onChange={event=>setPurpose(event.target.value)} placeholder="例如：个人编码 / 团队测试"/></label></div><h3>选择导出模型</h3><AgentModelPicker embedded open title="选择导出模型" local={local} selected={chosen} onSelectionChange={setChosen} onConfirm={setChosen} busy={busy} onClose={()=>setCreating(false)}/>{!valid&&<p className="tfHint" role="status">部分模型暂未确认可用，可保留并创建 Key，也可选择移除。</p>}{error&&<p className="tfError" role="alert">{error}</p>}<footer><span>已选 {chosen.length} 个模型</span><div className="tfRow"><button type="button" disabled={busy} onClick={()=>setCreating(false)}>取消</button><button className="primary" disabled={busy||!models.length}>{busy?'正在生成…':'生成 Key'}</button></div></footer></form></FlowDialog>}

  {keys.length?<div className="tfKeyGrid">{sortedKeys.map(key=>{const models=orderModels(key.models,id=>modelLabel(local,id),modelOrder,modelRanks);return <article className={`tfKeyCard ${key.enabled?'on':'off'} ${hold.dragging===key.id?'tfKeyHeld':''}`} key={key.id} data-key-card={key.id} aria-label={key.name} onPointerDown={event=>hold.onPointerDown(key.id,event)} onKeyDown={event=>{if(event.altKey&&['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const down=event.key==='ArrowRight'||event.key==='ArrowDown';const target=keyIds[keyIds.indexOf(key.id)+(down?1:-1)];if(target)moveKey(key.id,target,keyIds,down);}}}><KeyActions name={key.name} enabled={key.enabled} disabled={busy} onRename={()=>setRenaming(key.id)} onToggle={()=>void act(async()=>{await requestJSON(`/api/gateway-keys/${key.id}`,json('PUT',{name:key.name,purpose:key.purpose,enabled:!key.enabled,models:key.models,agents:key.agents,tokenLimit:key.tokenLimit}));})} onDelete={()=>{setDetailTab('delete');setDetail(key);}}/><button className="tfKeyCardMain" onMouseDown={event=>{if(event.button===0){event.preventDefault();event.currentTarget.focus({preventScroll:true});}}} onClick={()=>{if(hold.consumeClick())return;setCreated({id:'',value:'',temporary:false});setDetailTab('connection');setDetail(key);}} aria-label={`查看 ${key.name}`} aria-describedby={`key-state-${key.id}`}><span className="srOnly" id={`key-state-${key.id}`}>{key.enabled?'已启用':'已停用'}</span><h3>{key.name}</h3><p className="tfKeyPurpose">{key.purpose||'暂未填写用途'}</p><ul className="tfKeyPreview" aria-label="支持的模型">{models.slice(0,3).map(id=><li key={id} title={id}>{modelLabel(local,id)}</li>)}</ul><div className="tfKeyTotal"><span>累计用量</span><b title={compactTokens(key.usedTokens)}>{compactTokens(key.usedTokens)}</b></div></button></article>;})}</div>:!creating&&<div className="tfKeyEmpty"><h3>给第一个应用创建 Key</h3><p>设置名称、用途和可用模型，然后复制接入信息到应用中。</p>{!scopes.length&&<p>先在账号授权或 API 接口中添加模型来源。</p>}</div>}

  {renameEntry&&<KeyRenameDialog key={renameEntry.id} entry={renameEntry} onClose={()=>setRenaming('')} onChanged={reload}/>}
  {detail&&<KeyDetails key={detail.id} entry={keys.find(key=>key.id===detail.id)??detail} initialTab={detailTab} initialKey={created.id===detail.id?created.value:''} temporary={created.id===detail.id&&created.temporary} local={local} usage={usage} notify={notify} onClose={closeDetail} onChanged={reload}/>}
 </section>;
}
