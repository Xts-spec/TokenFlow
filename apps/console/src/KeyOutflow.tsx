import {useState,useRef} from 'react';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import type {GatewayKey} from '../../../packages/core/src/gateway-keys';
import type {GatewayUsage} from '../../../packages/core/src/gateway-activity';
import {requestJSON} from './request';
import {copyText} from './clipboard';
import {modelGroups,usageOf,usageText,type Choice} from './flow-model';
import {ModelPicker} from './ModelPicker';
import {FlowDialog} from './FlowDialog';
import {modelLabel} from './model-label';
import {Icon} from './Icons';
import type {Notify} from './notify';
const json=(method:string,body:unknown)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});
const compact=(value:number)=>new Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:1}).format(value);
function CopyField({label,value,notify}:{label:string;value:string;notify:Notify}){
 const [copied,setCopied]=useState(false);
 return <label>{label}<div className="inputAction"><input aria-label={label} readOnly value={value} onFocus={event=>event.target.select()}/><button type="button" onClick={()=>void copyText(value).then(()=>{setCopied(true);setTimeout(()=>setCopied(false),1500);}).catch(()=>notify({kind:'error',text:'复制失败，请选中后手动复制。'}))}>{copied?'已复制':'复制'}</button></div></label>;
}
function KeyDetails({entry,initialKey,initialTab,temporary,local,usage,notify,onClose,onChanged}:{entry:GatewayKey;initialKey:string;initialTab:string;temporary:boolean;local:LocalAgentSnapshot;usage:GatewayUsage[];notify:Notify;onClose:()=>void;onChanged:()=>Promise<void>}){
 const [tab,setTab]=useState(initialTab);const [picking,setPicking]=useState(false);const [secret,setSecret]=useState(initialKey);const [visible,setVisible]=useState(false);const [busy,setBusy]=useState(false);const lock=useRef(false);const [error,setError]=useState('');const [copied,setCopied]=useState('');
 const [editing,setEditing]=useState(false);const [editName,setEditName]=useState(entry.name);const [editPurpose,setEditPurpose]=useState(entry.purpose??'');
 const saveDetails=async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await requestJSON(`/api/gateway-keys/${entry.id}`,json('PUT',{name:editName.trim(),purpose:editPurpose.trim(),enabled:entry.enabled,models:entry.models,agents:entry.agents,tokenLimit:entry.tokenLimit}));await onChanged();setEditing(false);}catch(error){setError(error instanceof Error?error.message:'保存失败');}finally{lock.current=false;setBusy(false);}};
 const groups=modelGroups(local);
 const selected=entry.models.map(model=>{const matches=groups.filter(group=>group.models.some(item=>item.id===model));return {model,sourceId:entry.modelSources?.[model]??entry.sourceId??(matches.length===1?matches[0].id:'')};});
 const retained=selected.filter(choice=>!!(entry.modelSources?.[choice.model]??entry.sourceId));
 const saveModels=async(selections:Choice[])=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await requestJSON(`/api/gateway-keys/${entry.id}/models`,json('PUT',{selections}));await onChanged();notify({kind:'ok',text:'模型权限已更新，原 Key 继续使用。'});}catch(error){setError(error instanceof Error?error.message:'模型权限保存失败，请重试。');}finally{lock.current=false;setBusy(false);}};
 const origin=window.location.origin;const current=usageOf(usage,row=>row.keyId===entry.id);
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
 return <FlowDialog open title={`Key 详情 · ${entry.name}`} className="tfKeyDetail" busy={busy} onClose={onClose}>
  {editing?<form className="tfKeyMetadata" onSubmit={event=>{event.preventDefault();void saveDetails();}}><div className="tfKeyFields"><label>名称<input value={editName} required maxLength={80} disabled={busy} onChange={event=>setEditName(event.target.value)}/></label><label>用途<input value={editPurpose} maxLength={160} disabled={busy} onChange={event=>setEditPurpose(event.target.value)}/></label></div>{error&&<p className="tfError">{error}</p>}<div className="tfRow"><button type="button" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>取消</button><button className="primary" disabled={busy||!editName.trim()}>保存信息</button></div></form>:<div className="tfKeyDescription"><p className="tfDialogLead">{entry.purpose||'暂未填写用途'}</p><button className="textButton" disabled={busy} onClick={()=>{setEditName(entry.name);setEditPurpose(entry.purpose??'');setEditing(true);setError('');}}>编辑信息</button></div>}
  <div className="tfDetailMeta"><span className={`tfKeyStatus ${entry.enabled?'on':''}`}>{entry.enabled?'已启用':'已停用'}</span><span>创建于 {new Date(entry.createdAt).toLocaleDateString()}</span></div>
  <div className="tfDetailTabs" role="tablist" aria-label="Key 详情分类">{[['connection','接入信息'],['models',`支持模型（${entry.models.length}）`],['usage','使用情况']].map(([id,label])=><button key={id} role="tab" aria-selected={tab===id} disabled={busy||editing} onClick={()=>{setTab(id);setError('');}}>{label}</button>)}</div>
  <div className="tfDetailBody" role="tabpanel" aria-label={tab==='connection'?'接入信息':tab==='models'?'支持模型':'使用情况'}>
   {tab==='connection'&&<>
    <label>API Key<div className="inputAction"><input aria-label="导出的 API Key" type={visible?'text':'password'} readOnly value={secret||'********'} onFocus={event=>event.target.select()}/><button type="button" disabled={busy} onClick={()=>visible?setVisible(false):void secretAction('show')}>{visible?'隐藏':'显示'}</button><button type="button" disabled={busy} onClick={()=>void secretAction('copy')}>{copied==='copy'?'已复制':'复制 Key'}</button></div></label>
    {temporary&&<p className="tfHint">此环境未启用加密存储，请在关闭详情前保存 Key。</p>}
    {error&&<p className="tfError" role="alert">{error}</p>}
    <CopyField label="OpenAI 格式 Base URL" value={`${origin}/v1`} notify={notify}/><CopyField label="Anthropic 格式 Base URL" value={origin} notify={notify}/>
    <p className="tfHint">127.0.0.1 仅供本机使用。其他设备需填写可达的网关地址。</p>
    <button className="primary" disabled={busy} onClick={()=>void secretAction('all')}>{copied==='all'?'已复制':'复制完整接入信息'}</button>
   </>}
   {tab==='models'&&<><div className="tfModelsHead"><p>修改权限后，原 Key 继续使用。</p><button disabled={busy||editing} onClick={()=>{setError('');setPicking(true);}}>管理模型</button></div><div className="tfModelsHead"><p>调用时请使用完整模型 ID。</p><button onClick={()=>void copyText(entry.models.join('\n')).then(()=>{setCopied('models');setTimeout(()=>setCopied(''),1500);}).catch(()=>setError('复制失败，请手动复制模型 ID'))}>{copied==='models'?'已复制':'复制模型列表'}</button></div>{error&&<p className="tfError" role="alert">{error}</p>}{!entry.models.length&&<p className="tfHint">尚未授权模型，此 Key 暂时无法调用。点击管理模型添加。</p>}<ul className="tfKeyModels">{entry.models.map(id=><li key={id}><strong>{modelLabel(local.models,id)}</strong><CopyField label="模型 ID" value={id} notify={notify}/></li>)}</ul></>}
   {tab==='usage'&&<><dl className="tfUsageStats"><div><dt>累计 Tokens</dt><dd>{entry.usedTokens.toLocaleString()}</dd></div><div><dt>额度上限</dt><dd>{entry.tokenLimit===null?'不限':entry.tokenLimit.toLocaleString()}</dd></div><div><dt>本次运行输入</dt><dd>{current.inputTokens.toLocaleString()}</dd></div><div><dt>本次运行输出</dt><dd>{current.outputTokens.toLocaleString()}</dd></div></dl><p className="tfHint">{usageText(current)}</p>{current.last&&<p className="tfHint">最近调用：{new Date(current.last).toLocaleString()}</p>}{entry.unmeteredRequests>0&&<p className="tfHint">有 {entry.unmeteredRequests} 次请求的用量尚未确认，累计值可能不完整。</p>}</>}
  </div>
  <ModelPicker open={picking} title="管理 Key 支持的模型" local={local} selected={selected} retained={retained} allowEmpty confirmLabel="保存模型权限" onConfirm={choices=>void saveModels(choices)} onClose={()=>setPicking(false)}/>
 </FlowDialog>;
}
export function KeyOutflow({local,keys,usage,reload,notify}:{local:LocalAgentSnapshot;keys:GatewayKey[];usage:GatewayUsage[];reload:()=>Promise<void>;notify:Notify}){
 const scopes=modelGroups(local);const [creating,setCreating]=useState(false);const [name,setName]=useState('');const [purpose,setPurpose]=useState('');const [chosen,setChosen]=useState<Choice[]>([]);const [picking,setPicking]=useState(false);
 const [detail,setDetail]=useState<GatewayKey|null>(null);const [detailTab,setDetailTab]=useState('connection');const [created,setCreated]=useState({id:'',value:'',temporary:false});const [busy,setBusy]=useState(false);const lock=useRef(false);const [error,setError]=useState('');
 const models=chosen.map(choice=>choice.model);const valid=chosen.every(choice=>scopes.some(scope=>scope.id===choice.sourceId&&scope.models.some(model=>model.id===choice.model)));
 const act=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await work();await reload();}catch(error){const message=error instanceof Error?error.message:'操作失败';setError(message);notify({kind:'error',text:message});}finally{lock.current=false;setBusy(false);}};
 const create=()=>act(async()=>{
  const result=await requestJSON<{apiKey:string;key:GatewayKey;keyStored:boolean}>('/api/gateway-keys',json('POST',{name:name.trim()||`本地 Key ${keys.length+1}`,purpose:purpose.trim(),enabled:true,models,modelSources:Object.fromEntries(chosen.map(choice=>[choice.model,choice.sourceId])),agents:['codex','claude','openai'],tokenLimit:null}));
  setCreated({id:result.key.id,value:result.apiKey,temporary:!result.keyStored});setDetailTab('connection');setDetail(result.key);setCreating(false);
 });
 const toggle=(key:GatewayKey)=>act(async()=>{await requestJSON(`/api/gateway-keys/${key.id}`,json('PUT',{name:key.name,purpose:key.purpose,enabled:!key.enabled,models:key.models,agents:key.agents,tokenLimit:key.tokenLimit}));});
 const closeDetail=()=>{setDetail(null);setCreated({id:'',value:'',temporary:false});};
 return <section className="tfKeys" aria-label="本地 API Key">
  <header className="tfKeysHead"><div><h2>我的 API Keys <span>{keys.length}</span></h2><p>为不同应用分别授权，按 Key 查看使用情况。</p></div><button className="primary" disabled={busy||!scopes.length||creating} onClick={()=>{setCreating(true);setName('');setPurpose('');setChosen([]);setError('');}}><Icon name="plus" size={15}/>创建 Key</button></header>
  {creating&&<form className="tfKeyCreate" aria-label="创建 API Key" onSubmit={event=>{event.preventDefault();void create();}}><header><h3>创建 API Key</h3><button type="button" className="textButton" disabled={busy} onClick={()=>setCreating(false)}>取消</button></header><div className="tfKeyFields"><label>名称<input autoFocus value={name} disabled={busy} maxLength={80} onChange={event=>setName(event.target.value)} placeholder="例如：我的 Cursor"/></label><label>用途<input value={purpose} disabled={busy} maxLength={160} onChange={event=>setPurpose(event.target.value)} placeholder="例如：个人编码 / 团队测试"/></label></div><div className="tfKeyScope"><span>模型权限<strong>{chosen.length?`已选 ${chosen.length} 个模型`:'尚未选择'}</strong></span><button type="button" disabled={busy} onClick={()=>setPicking(true)}>选择导出模型（{chosen.length}）</button></div>{!valid&&<p className="tfError">部分来源已不可用，请重新选择。</p>}{error&&<p className="tfError">{error}</p>}<footer><span>只允许调用所选模型</span><button className="primary" disabled={busy||!models.length||!valid}>{busy?'正在生成…':'生成 Key'}</button></footer></form>}
  {keys.length?<div className="tfKeyGrid">{keys.map(key=>{const current=usageOf(usage,row=>row.keyId===key.id);return <article className={`tfKeyCard ${key.enabled?'':'off'}`} key={key.id} aria-label={key.name}><button className="tfKeyCardMain" onClick={()=>{setCreated({id:'',value:'',temporary:false});setDetailTab('connection');setDetail(key);}} aria-label={`查看 ${key.name}`}><div className="tfKeyCardTop"><h3>{key.name}</h3><span className={`tfKeyStatus ${key.enabled?'on':''}`}>{key.enabled?'已启用':'已停用'}</span></div><p className="tfKeyPurpose">{key.purpose||'暂未填写用途'}</p><code>{key.prefix}••••••••</code><dl><div><dt>累计 Tokens</dt><dd title={key.usedTokens.toLocaleString()}>{compact(key.usedTokens)}</dd></div><div><dt>支持模型</dt><dd>{key.models.length}<small> 个</small></dd></div></dl><span className="tfKeyLast">{current.last?`最近调用 ${new Date(current.last).toLocaleString()}`:`创建于 ${new Date(key.createdAt).toLocaleDateString()}`}</span></button><footer><div><button className="textButton" onClick={()=>{setDetailTab('connection');setDetail(key);}}>接入信息</button><button className="textButton" onClick={()=>{setDetailTab('models');setDetail(key);}}>管理模型</button></div><div><button className="textButton" disabled={busy} onClick={()=>void toggle(key)}>{key.enabled?'停用':'启用'}</button><button className="textButton danger" disabled={busy} onClick={()=>{if(window.confirm(`删除 ${key.name}？使用它的应用将无法再调用。`))void act(async()=>{await requestJSON(`/api/gateway-keys/${key.id}`,json('DELETE',{}));});}}>删除</button></div></footer></article>;})}</div>:!creating&&<div className="tfKeyEmpty"><h3>给第一个应用创建 Key</h3><p>设置名称、用途和可用模型，然后复制接入信息到应用中。</p>{!scopes.length&&<p>先在账号授权或 API 接口中添加模型来源。</p>}</div>}
  {keys.length>0&&<p className="tfHint">新增来源不会自动扩大已有 Key 的模型权限。</p>}
  <ModelPicker open={picking} title="选择导出模型" local={local} selected={chosen} onConfirm={setChosen} onClose={()=>setPicking(false)}/>
  {detail&&<KeyDetails key={detail.id} entry={keys.find(key=>key.id===detail.id)??detail} initialTab={detailTab} initialKey={created.id===detail.id?created.value:''} temporary={created.id===detail.id&&created.temporary} local={local} usage={usage} notify={notify} onClose={closeDetail} onChanged={reload}/>}
 </section>;
}
