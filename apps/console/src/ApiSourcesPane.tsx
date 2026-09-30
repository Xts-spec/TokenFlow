import { useRef, useState, useEffect } from 'react';
import type { ApiSource } from '../../../packages/core/src/api-sources';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import { Icon } from './Icons';
type Usage={targets:{id:string;name:string;model:string}[];keys:{id:string;name:string;models:string[]}[];repair:boolean;reviewer:boolean};
const protocolNames={responses:'OpenAI Responses',chat:'OpenAI Chat Completions',messages:'Anthropic Messages'};
async function request<T>(path:string,body?:unknown,method='POST'):Promise<T>{const r=await fetch(path,{method:body===undefined?'GET':method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await r.json();if(!r.ok)throw new Error(data.error?.message??data.error??data.message??'操作失败');return data;}
export function ApiSourcesPane({local,onChange,onConnect}:{local:LocalAgentSnapshot;onChange:()=>Promise<void>;onConnect:()=>void}){
 const [editing,setEditing]=useState<string|null>();const [name,setName]=useState('');const [baseURL,setBaseURL]=useState('https://api.openai.com/v1');const [protocol,setProtocol]=useState<ApiSource['protocol']>('responses');
 const [models,setModels]=useState('');const [enabled,setEnabled]=useState(true);const [usage,setUsage]=useState<Usage>();const [ack,setAck]=useState(false);const key=useRef<HTMLInputElement>(null);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [notice,setNotice]=useState('');
 useEffect(()=>{if(!editing)return;let live=true;const refresh=()=>request<Usage>(`/api/sources/${editing}/usage`).then(data=>{if(live)setUsage(data);}).catch(()=>{});void refresh();const timer=setInterval(()=>void refresh(),4000);return()=>{live=false;clearInterval(timer);};},[editing]);
 const selected=local.apiSources?.find(s=>s.id===editing);const used=!!usage&&(!!usage.targets.length||!!usage.keys.length||usage.repair||usage.reviewer);
 const modelIDs=[...new Set(models.split(/[\n,，]/).map(s=>s.trim()).filter(Boolean))];
 const act=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'操作失败');}finally{await onChange().catch(()=>{});setBusy(false);}};
 const open=async(s?:ApiSource)=>{
  setEditing(s?.id??null);setName(s?.name??'');setBaseURL(s?.baseURL??'https://api.openai.com/v1');setProtocol(s?.protocol??'responses');setEnabled(s?.enabled??true);setModels(s?.models.join('\n')??'');setUsage(undefined);setAck(false);setError('');setNotice('');if(key.current)key.current.value='';
  if(s)try{setUsage(await request<Usage>(`/api/sources/${s.id}/usage`));}catch(e){setError(e instanceof Error?e.message:'无法读取关联连接');}
 };
 const save=async()=>{
  const value=key.current?.value.trim();const saved=await request<ApiSource & {routingError?:string}>(editing?`/api/sources/${editing}`:'/api/sources',{name,baseURL,protocol,enabled,models:modelIDs,...(value?{apiKey:value}:{}),acknowledge:ack},editing?'PUT':'POST');
  if(key.current)key.current.value='';setEditing(saved.id);setUsage(await request<Usage>(`/api/sources/${saved.id}/usage`));setAck(false);if(saved.routingError)throw new Error(saved.routingError);return saved;
 };
 return <section className="apiSourcesPane" aria-label="API 模型来源"><div className="sectionTitle"><div><h2>API 接入</h2><p className="hint">每个来源分别保存密钥和模型，可供 Agent 与维修师傅共用。</p></div><button disabled={busy} onClick={()=>void open()}><Icon name="plus" size={15}/>添加 API 来源</button></div>
 {(local.apiSources??[]).length>0&&<div className="apiSourceList">{local.apiSources!.map(s=><article key={s.id}><div><h3>{s.name}</h3><p>{protocolNames[s.protocol]} · {s.models.length} 个模型 · {!s.enabled?'已停用':s.hasKey?'密钥已保存':'密钥暂不可读取'}</p><small>{s.baseURL}</small></div><button disabled={busy} onClick={()=>void open(s)}>编辑与模型</button></article>)}</div>}
 {!(local.apiSources??[]).length&&editing===undefined&&<p className="hint">还没有 API 来源。已有 API Key 可以从这里添加；账号授权入口在下方。</p>}
 {editing!==undefined&&<div className="apiSourceEditor"><div className="sectionTitle"><h3>{selected?`编辑 · ${selected.name}`:'新 API 来源'}</h3><button disabled={busy} onClick={()=>{setEditing(undefined);if(key.current)key.current.value='';}}>收起</button></div>
 {error&&<p className="banner error" role="alert">{error}</p>}{notice&&<p className="banner notice" role="status">{notice}</p>}
 <form onSubmit={e=>{e.preventDefault();void act(async()=>{await save();setNotice('来源已保存。可读取模型列表，或在下方验证一个模型。');});}}>
 <div className="columns"><label>来源名称<input required maxLength={80} value={name} onChange={e=>setName(e.target.value)} placeholder="例如：团队 API / 个人项目"/></label><label>上游协议<select value={protocol} onChange={e=>setProtocol(e.target.value as ApiSource['protocol'])}>{Object.entries(protocolNames).map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label></div>
 <label>API Base URL<input required type="url" value={baseURL} onChange={e=>setBaseURL(e.target.value)} placeholder="https://example.com/v1"/></label>
 <label>API Key <span className="muted">{selected?.hasKey?'已保存；留空保留':''}</span><input ref={key} type="password" autoComplete="off" required={!editing} maxLength={4096} placeholder="只保存到系统加密存储"/></label>
 <label>上游模型 ID <span className="muted">每行一个，也可用逗号分隔</span><textarea value={models} onChange={e=>setModels(e.target.value)} rows={4} placeholder="gpt-5\nmy-model"/></label>
 <p className="hint">协议需与接口一致。列表中的模型可能没有调用权限；只验证你选中的模型，每次会产生少量调用。</p>
 <label className="toggle"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>启用此来源</label>
 {used&&<div className="apiSourceImpact"><strong>此来源正在使用</strong><p>{usage!.targets.map(t=>t.name).join('、')||'暂无自动接入的 Agent'} · {usage!.keys.length} 个客户端 Key{usage!.repair?' · 维修模型':''}{usage!.reviewer?' · 审批模型':''}</p><ul>{usage!.targets.map(t=><li key={t.id}>{t.name} · {t.model.split('/').slice(1).join('/')}</li>)}{usage!.keys.map(k=><li key={k.id}>{k.name} · {k.models.length} 个授权模型</li>)}</ul><p className="hint">修改地址、协议、密钥或模型会影响这些调用。客户端不会自动切换来源；停用后请求会明确失败。</p><label className="toggle"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)}/>已查看影响，确认保存本次修改</label></div>}
 <div className="buttons"><button className="primary" disabled={busy||!!editing&&!usage||used&&!ack}>{busy?'处理中…':'保存来源'}</button><button type="button" disabled={busy||used&&!ack||!!editing&&!usage} onClick={()=>void act(async()=>{const saved=await save();const data=await request<{models:string[]}>(`/api/sources/${saved.id}/models`,{});setModels([...new Set([...modelIDs,...data.models])].join('\n'));setNotice(`读取到 ${data.models.length} 个模型，请确认后再保存来源。`);})}>保存并读取模型列表</button></div>
 </form>
 {selected?.models.length? <section className="apiModelChecks" aria-label="来源模型验证"><div className="sectionTitle"><h3>已保存的模型</h3><button onClick={onConnect}>前往工作台</button></div>{selected.models.map(model=><div className="apiModelRow" key={model}><div><strong>{model}</strong><small title={`api-${selected.id}/${model}`}>来源：{selected.name}</small><p>{selected.checks[model]?.message??'尚未验证'}{selected.checks[model]?.checkedAt&&<small> · {new Date(selected.checks[model].checkedAt).toLocaleString()}</small>}</p></div><button disabled={busy||!selected.enabled||!selected.hasKey||local.state!=='running'} onClick={()=>void act(async()=>{const result=await request<{message:string}>(`/api/sources/${selected.id}/check`,{model:`api-${selected.id}/${model}`});setNotice(result.message);})}>最小验证</button></div>)}</section>:null}
 {selected&&<div className="apiSourceDelete"><p className="hint">{used?'仍有连接或 Key 使用此来源。可以先停用，再切换连接和移除关联 Key。':'删除来源会移除当前密钥，客户端不会自动改用其他来源。'}</p><button disabled={busy||!usage||used} onClick={()=>void act(async()=>{if(!window.confirm(`删除 API 来源「${selected.name}」及其当前密钥？`))return;await request(`/api/sources/${selected.id}`,{},'DELETE');setEditing(undefined);})}>删除来源</button></div>}
 </div>}
 </section>;
}
