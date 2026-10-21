import {useEffect,useRef,useState} from 'react';
import {requestJSON} from './request';
import type {GatewayAccessSnapshot} from '../../../packages/core/src/gateway-access';
import './gateway-access.css';
export type {GatewayAccessSnapshot} from '../../../packages/core/src/gateway-access';

export function GatewayAccessPanel({snapshot,onSnapshot,refreshKey}:{snapshot:GatewayAccessSnapshot|null;onSnapshot:(snapshot:GatewayAccessSnapshot|null)=>void;refreshKey?:string}){
 const [enabled,setEnabled]=useState(false),[port,setPort]=useState('9555'),[allowedIPs,setAllowedIPs]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState('');
 const editing=useRef(false),lock=useRef(false),revision=useRef(0);
 const apply=(value:GatewayAccessSnapshot)=>{
  onSnapshot(value);
  if(!editing.current){setEnabled(value.enabled);setPort(String(value.port));setAllowedIPs(value.allowedIPs.join('\n'));}
 };
 const load=async()=>{
  if(lock.current)return;const current=++revision.current;setLoading(true);setError('');setSaved('');onSnapshot(null);
  try{const value=await requestJSON<GatewayAccessSnapshot>('/api/gateway/access');if(current===revision.current)apply(value);}
  catch(error){if(current===revision.current)setError(error instanceof Error?error.message:'无法读取局域网访问状态，请重试。');}
  finally{if(current===revision.current)setLoading(false);}
 };
 useEffect(()=>{
  void load();const refresh=()=>{if(document.visibilityState==='visible')void load();};
  window.addEventListener('focus',refresh);window.addEventListener('online',refresh);
  return()=>{revision.current++;window.removeEventListener('focus',refresh);window.removeEventListener('online',refresh);};
 },[refreshKey]);
 const change=()=>{editing.current=true;setError('');setSaved('');};
 const save=async()=>{
  if(lock.current)return;
  const number=Number(port);
  if(!/^\d+$/.test(port)||!Number.isInteger(number)||number<1||number>65535){setError('请输入 1–65535 之间的端口。');return;}
  lock.current=true;setBusy(true);setError('');setSaved('');
  try{
   const value=await requestJSON<GatewayAccessSnapshot>('/api/gateway/access',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({enabled,port:number,allowedIPs:allowedIPs.split(/\r?\n/).map(value=>value.trim()).filter(Boolean)})});
   editing.current=false;apply(value);setSaved(value.enabled?(value.running?'已保存，局域网访问已启动。':'已保存，请检查下方运行状态。'):'已保存，局域网访问已关闭。');
  }catch(error){setError(error instanceof Error?error.message:'保存失败，请重试。');}
  finally{lock.current=false;setBusy(false);}
 };
 const disabled=busy||loading||!snapshot;
 return <section className="tfGatewayAccess" aria-labelledby="gateway-access-title" aria-busy={busy||loading}>
  <header><div><h3 id="gateway-access-title">局域网访问</h3><p className="tfHint">允许其他设备使用指定 Key，仅可调用该 Key 的所选模型。</p></div><span className={`tfKeyStatus ${snapshot?.running?'on':''}`} role="status">{loading?'正在读取':!snapshot?'状态未读取':!snapshot.enabled?'未启用':snapshot.running?'运行中':'未运行'}</span></header>
  <form onSubmit={event=>{event.preventDefault();void save();}}>
   <div className="tfGatewayAccessFields"><label className="tfGatewayAccessToggle"><input type="checkbox" checked={enabled} disabled={disabled} onChange={event=>{change();setEnabled(event.target.checked);}}/>启用局域网访问</label><label className="tfGatewayAccessPort">服务端口<input type="number" min={1} max={65535} step={1} value={port} disabled={disabled} required onChange={event=>{change();setPort(event.target.value);}}/></label><button type="submit" disabled={disabled}>{busy?'正在保存…':'保存设置'}</button><button type="button" className="textButton" disabled={busy||loading} onClick={()=>void load()}>刷新状态</button></div>
   <details><summary>来源限制</summary><label className="tfGatewayAccessIPs">允许的 IP（可选）<textarea rows={3} value={allowedIPs} disabled={disabled} spellCheck={false} placeholder={'192.168.1.10\n192.168.1.11'} onChange={event=>{change();setAllowedIPs(event.target.value);}}/></label><p className="tfHint">每行一个设备 IP。留空时不限制来源 IP，所有请求仍需有效 Key。</p></details>
   {snapshot?.running&&<p className="tfHint">关闭此入口或修改端口时，未完成的请求将在 2 秒后断开。</p>}
  </form>
  {snapshot?.enabled&&snapshot.running&&snapshot.addresses.length>0&&<div className="tfGatewayAddresses"><span>当前接入地址</span>{snapshot.addresses.map(address=><code key={address}>{address}</code>)}</div>}
  {snapshot?.enabled&&snapshot.running&&!snapshot.addresses.length&&<p className="tfHint">未找到可用的局域网地址，请连接网络后刷新状态。</p>}
  {snapshot?.lastError&&<p className="tfError" role="alert">{snapshot.lastError}</p>}
  {error&&<p className="tfError" role="alert">{error}</p>}
  {saved&&<p className="tfHint" role="status">{saved}</p>}
 </section>;
}
