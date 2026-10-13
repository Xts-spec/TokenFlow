import {DragHandle,dropOrder,ModelOrderControl,orderModels,useModelOrder} from './display-order';
import { useRef, useState } from 'react';
import type { ApiSource } from '../../../packages/core/src/api-sources';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import { requestJSON } from './request';
import { Icon } from './Icons';
import { parseModels, protocolNames, validateDraft, type DraftErrors } from './api-source-draft';
import type { Notify } from './notify';
import type { UsageData } from './usage-data';
import {useListReturn} from './list-return';


import {copyText} from './clipboard';

const json=(method:string,body:unknown)=>({method,headers:{'content-type':'application/json'},body:JSON.stringify(body)});

function ApiSourceCard({local,source,disabled,editing,notify,onEdit,onToggle,onRemove}:{local:LocalAgentSnapshot;source:ApiSource;disabled:boolean;editing:boolean;notify:Notify;onEdit:()=>void;onToggle:()=>void;onRemove:()=>void}){
 const [modelOrder,setModelOrder,modelRanks,moveModel]=useModelOrder();
 const identity=(model:string)=>`api-${source.id}/${model}`;const sortedModels=orderModels(source.models,model=>model,modelOrder,modelRanks,identity);const modelIds=sortedModels.map(identity);
 const [expanded,setExpanded]=useState(false);const [copied,setCopied]=useState('');
 const rememberModels=useListReturn(expanded);
 const copy=async(value:string,id:string)=>{try{await copyText(value);setCopied(id);setTimeout(()=>setCopied(''),1500);}catch{notify({kind:'error',text:'复制失败，请选中后手动复制。'});}};

 return <article className={`tfApiSourceCard ${source.enabled?'':'off'}`} aria-label={source.name}>
  <div className="tfApiSourceBody">
   <header className="tfApiSourceHead"><span className="tfApiSourceIcon"><Icon name="plug" size={20}/></span><div><h3>{source.name}</h3><span className="tfApiProtocol">{protocolNames[source.protocol]}</span></div><span className={`tfKeyStatus ${source.enabled&&source.hasKey?'on':source.enabled?'warn':''}`}>{!source.enabled?'已停用':source.hasKey?'已启用':'密钥不可读'}</span></header>
   <div className="tfApiAddress"><code title={source.baseURL}>{source.baseURL}</code><button className="iconButton" aria-label={`复制 ${source.name} 接口地址`} title={copied==='url'?'已复制':'复制接口地址'} onClick={()=>void copy(source.baseURL,'url')}><Icon name={copied==='url'?'checkCircle':'copy'} size={14}/></button></div>
  </div>
  <footer><div><button className="textButton" aria-expanded={expanded} aria-controls={`api-models-${source.id}`} onClick={()=>{if(!expanded)rememberModels();setExpanded(!expanded);}}>{expanded?'收起模型':`支持模型（${source.models.length}）`}</button></div><div><button className="textButton" disabled={disabled} onClick={onEdit}>{editing?'编辑中':'编辑'}</button><button className="textButton" disabled={disabled} onClick={onToggle}>{source.enabled?'停用':'启用'}</button><button className="textButton danger" disabled={disabled} onClick={onRemove}>删除</button></div></footer>
  {expanded&&<div className="tfApiSourceModels" id={`api-models-${source.id}`}><header><strong>上游模型 ID</strong><ModelOrderControl value={modelOrder} onChange={setModelOrder}/><button className="textButton" onClick={()=>void copy(sortedModels.join('\n'),'models')}>{copied==='models'?'已复制':'复制列表'}</button></header>{!source.models.length&&<p className="tfHint">尚未配置模型，可在编辑中添加。</p>}<ul>{sortedModels.map(model=><li key={model} className="tfDragRow" {...dropOrder('models',identity(model),modelIds,moveModel)}><DragHandle kind="models" id={identity(model)} label={model} items={modelIds} move={moveModel}/><code>{model}</code><button className="iconButton" aria-label={`复制模型 ${model}`} onClick={()=>void copy(model,model)}><Icon name={copied===model?'checkCircle':'copy'} size={14}/></button></li>)}</ul></div>}
 </article>;
}

export function ApiInflow({local,usage,onChange,notify}:{local:LocalAgentSnapshot;usage:UsageData;onChange:()=>Promise<void>;notify:Notify}){
 const sources=local.apiSources??[];

 // undefined: closed, null: adding, source: editing
 const [form,setForm]=useState<ApiSource|null>();
 const rememberEditor=useListReturn(form!==undefined);
 const [name,setName]=useState('');const [baseURL,setBaseURL]=useState('');const [apiKey,setApiKey]=useState('');const nextModelId=useRef(1);const [modelRows,setModelRows]=useState([{id:0,value:''}]);
 const model=modelRows.map(row=>row.value).join('\n');const modelCount=parseModels(model).length;
 const [keyEditing,setKeyEditing]=useState(false);const [visible,setVisible]=useState(false);const [revealed,setRevealed]=useState('');const [revealing,setRevealing]=useState(false);const revealVersion=useRef(0);
 const [errors,setErrors]=useState<DraftErrors>({});const [failure,setFailure]=useState('');
 const [busy,setBusy]=useState(false);const controller=useRef<AbortController|null>(null);
 const nameOnly=!!form&&!apiKey.trim()&&baseURL.trim()===form.baseURL&&JSON.stringify(parseModels(model))===JSON.stringify(form.models);

 const open=(source:ApiSource|null)=>{if(form===undefined)rememberEditor();revealVersion.current++;setKeyEditing(!source?.hasKey);setVisible(false);setRevealed('');setRevealing(false);setForm(source);setName(source?.name??'');setBaseURL(source?.baseURL??'');setApiKey('');setModelRows((source?.models.length?source.models:['']).map(value=>({id:nextModelId.current++,value})));setErrors({});setFailure('');};
 const close=()=>{revealVersion.current++;setVisible(false);setRevealed('');controller.current?.abort();setForm(undefined);setApiKey('');setFailure('');};

 // A source that Agents or Keys use asks once before it changes, instead of blocking up front.
 async function guarded<T>(run:(acknowledge:boolean)=>Promise<T>,usedText:string):Promise<T|undefined>{
  try{return await run(false);}
  catch(error){
   if((error as {code?:string}).code==='api_source_in_use'&&window.confirm(`${usedText}\n仍要继续吗？`))return run(true);
   throw error;
  }
 }

 async function submit(event:React.FormEvent){
  event.preventDefault();if(busy)return;
  const found=validateDraft({name,baseURL,apiKey,model},!!form);setErrors(found);setFailure('');
  if(Object.keys(found).length)return;
  const abort=new AbortController();controller.current=abort;setBusy(true);
  try{
   const saved=await guarded(acknowledge=>requestJSON<ApiSource&{routingError?:string}>('/api/sources/quick',{...json('POST',{id:form?.id,name:name.trim(),baseURL:baseURL.trim(),apiKey:apiKey.trim()||undefined,model,acknowledge:acknowledge||undefined}),signal:abort.signal},90000),'此来源正被 Agent 或本地 Key 使用，修改会影响它们。');
   if(!saved)return;
   revealVersion.current++;setRevealed('');setVisible(false);setForm(undefined);setApiKey('');
   notify({kind:saved.routingError?'error':'ok',text:saved.routingError??(nameOnly?`名称备注已保存：${saved.name}`:`${form?'已更新':'已添加'}：${saved.name}，${saved.models.length} 个模型（${protocolNames[saved.protocol]}）`)});
   await onChange();
  }catch(error){setFailure(error instanceof Error?error.message:'验证失败，请检查填写内容。');}
  finally{controller.current=null;setBusy(false);}
 }

 async function toggle(source:ApiSource){
  try{
   await guarded(acknowledge=>requestJSON(`/api/sources/${source.id}`,json('PUT',{name:source.name,baseURL:source.baseURL,protocol:source.protocol,models:source.models,enabled:!source.enabled,acknowledge})),`此来源正被使用，${source.enabled?'停用':'启用'}会影响它们。`);
   await onChange();
  }catch(error){notify({kind:'error',text:error instanceof Error?error.message:'操作失败'});}
 }
 async function remove(source:ApiSource){
  if(!window.confirm(`删除 ${source.name} 及其保存的 API Key？`))return;
  try{await requestJSON(`/api/sources/${source.id}`,json('DELETE',{}));await onChange();}
  catch(error){notify({kind:'error',text:error instanceof Error?error.message:'删除失败'});}
 }

 return <section className="tfApis" aria-label="API 接口">
  <header className="tfCollectionHead"><div><h2>已保存的接口 <span>{sources.length}</span></h2><p>连接已有接口，供本地 Agent 和 API 代理使用。</p></div><button className="primary" disabled={busy||form!==undefined} onClick={()=>open(null)}><Icon name="plus" size={15}/>添加 API</button></header>
  {form!==undefined&&<form className="tfForm tfApiEditor" onSubmit={event=>void submit(event)} noValidate aria-label={form?'编辑 API':'添加 API'}>
   <header className="tfApiEditorHead"><div><h3>{form?`编辑 API · ${form.name}`:'添加 API'}</h3><p>填写地址、密钥和可用模型，保存时自动识别协议。</p></div><button type="button" className="iconButton" aria-label="关闭编辑" onClick={close}><Icon name="close" size={18}/></button></header>
   <div className="tfKeyFields">
   <label>名称备注<input name="name" autoComplete="off" aria-invalid={!!errors.name} value={name} disabled={busy} onChange={event=>{setName(event.target.value);setErrors(e=>({...e,name:undefined}));}} placeholder="例如：公司中转 · Kimi" autoFocus/>{errors.name&&<span className="tfError">{errors.name}</span>}</label>
   <label>URL<input name="baseURL" inputMode="url" autoComplete="off" spellCheck={false} aria-invalid={!!errors.baseURL} value={baseURL} disabled={busy} onChange={event=>{setBaseURL(event.target.value);setErrors(e=>({...e,baseURL:undefined}));}} placeholder="https://api.example.com/v1"/>{errors.baseURL&&<span className="tfError">{errors.baseURL}</span>}</label>
   </div>
   <label>API Key<div className="inputAction"><input name="apiKey" aria-label="API Key" type={visible?'text':'password'} autoComplete="off" spellCheck={false} aria-invalid={!!errors.apiKey} readOnly={!keyEditing} value={keyEditing?apiKey:(visible?revealed:'********')} disabled={busy||revealing} onFocus={event=>event.target.select()} onChange={event=>{setApiKey(event.target.value);setRevealed('');setErrors(e=>({...e,apiKey:undefined}));}} placeholder="sk-…"/>
    <button type="button" disabled={busy||revealing} onClick={()=>void (async()=>{
     if(visible){setVisible(false);setRevealed('');return;}
     if(keyEditing||!form?.hasKey){setVisible(true);return;}
     const version=++revealVersion.current;setRevealing(true);
     try{const result=await requestJSON<{apiKey:string}>(`/api/sources/${form.id}/reveal-key`,json('POST',{}));if(version===revealVersion.current){setRevealed(result.apiKey);setVisible(true);}}
     catch(error){if(version===revealVersion.current)setFailure(error instanceof Error?error.message:'读取密钥失败');}
     finally{if(version===revealVersion.current)setRevealing(false);}
    })()}>{revealing?'读取中…':visible?'隐藏密钥':'显示完整密钥'}</button>{form?.hasKey&&<button type="button" disabled={busy||revealing} onClick={()=>{revealVersion.current++;setKeyEditing(!keyEditing);setApiKey('');setRevealed('');setVisible(false);}}>{keyEditing?'保留原密钥':'更换密钥'}</button>}</div>{errors.apiKey&&<span className="tfError">{errors.apiKey}</span>}</label>
   <fieldset className="tfApiModels" disabled={busy} aria-describedby="api-models-help">
    <legend>可用模型 · {modelCount} 个</legend>
    <p id="api-models-help" className="tfHint">这些模型共用上面的接口地址和 API Key。保存后，到「本地 Agent → 管理所选模型」多选，即可在 Agent 内来回切换。</p>
    {modelRows.map((row,index)=><div className="tfApiModelRow" key={row.id}>
     <label>{index===0?'模型名称':`模型名称 ${index+1}`}<input name="model" autoComplete="off" spellCheck={false} aria-invalid={!!errors.model} value={row.value} onChange={event=>{setModelRows(rows=>rows.map(item=>item.id===row.id?{...item,value:event.target.value}:item));setErrors(e=>({...e,model:undefined}));}} placeholder="填写完整模型 ID，例如 gpt-5"/></label>
     <button type="button" className="textButton" aria-label={`移除模型 ${index+1}`} disabled={modelRows.length===1} onClick={()=>{setModelRows(rows=>rows.filter(item=>item.id!==row.id));setErrors(e=>({...e,model:undefined}));}}>移除</button>
    </div>)}
    {errors.model&&<span className="tfError" role="alert">{errors.model}</span>}
    <button type="button" className="tfAddButton" disabled={modelRows.length>=50} onClick={()=>setModelRows(rows=>[...rows,{id:nextModelId.current++,value:''}])}><Icon name="plus" size={15}/>添加模型</button>
    <p className="tfHint">最多 50 个，也可在一项中用逗号分隔多个模型。保存时用第一个模型识别接口协议，其余模型需由该 Key 授权。</p>
   </fieldset>
   {failure&&<p className="tfError" role="alert">{failure}</p>}
   {busy&&<p className="tfHint" role="status">{nameOnly?'正在保存名称备注…':'正在验证接口并识别协议…'}</p>}
   <footer className="tfApiFormFoot"><p>{nameOnly?'备注名称可直接保存。':'验证会请求模型，可能产生少量用量。'}</p><div className="tfRow">
    <button className="primary" disabled={busy||!name.trim()||!baseURL.trim()||(!form&&!apiKey.trim())||!parseModels(model).length}>{busy?'保存中…':nameOnly?'保存名称备注':form?'验证并保存':'验证并添加'}</button>
    <button type="button" onClick={close}>{busy?'取消验证':'取消'}</button>
   </div></footer>
  </form>}
  {sources.length>0?<div className="tfApiSourceGrid">{sources.map(source=><ApiSourceCard key={source.id} local={local} source={source} disabled={busy||form!==undefined} editing={form?.id===source.id} notify={notify} onEdit={()=>open(source)} onToggle={()=>void toggle(source)} onRemove={()=>void remove(source)}/>)}</div>:form===undefined&&<div className="tfKeyEmpty"><h3>添加第一个 API 接口</h3><p>支持 Responses、Chat Completions 和 Anthropic Messages。<br/>填写已有接口的地址、Key 和模型，即可接入。</p></div>}

 </section>;
}
