import {useEffect,useRef,useState} from 'react';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import {expiredAuthorizations} from './expired-authorizations';
import {FlowDialog} from './FlowDialog';
import {requestJSON} from './request';

/** Only a terminal credential failure triggers this prompt; quota/catalog failures do not. */
export function ExpiredAccountNotice({local,disabled,onChanged}:{local:LocalAgentSnapshot;disabled:boolean;onChanged:()=>Promise<void>}){
 const seen=useRef(new Set<string>()),lock=useRef(false);
 const [dialogRevision,setDialogRevision]=useState(0);
 useEffect(()=>{const closed=()=>setDialogRevision(n=>n+1);document.addEventListener('close',closed,true);return()=>document.removeEventListener('close',closed,true);},[]);
 const [account,setAccount]=useState<ReturnType<typeof expiredAuthorizations>[number]>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{
  const pending=expiredAuthorizations(local.accounts);
  if(account&&!busy&&!pending.some(item=>item.key===account.key)){setAccount(undefined);setError('');return;}
  if(account||disabled||local.accountsLoading||document.querySelector('dialog[open]')||local.login&&['starting','waiting_for_browser','verifying'].includes(local.login.status))return;
  const next=pending.find(item=>!seen.current.has(item.key));
  if(next){setAccount(next);setError('');}
 },[local,disabled,account,dialogRevision,busy]);
 const close=()=>{if(account)seen.current.add(account.key);setAccount(undefined);setError('');};
 const remove=async()=>{
  if(!account||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{await requestJSON(`/api/local-agent/accounts/${account.account.id}/expired`,{method:'DELETE'});close();await onChanged();}
  catch(error){setError(error instanceof Error?error.message:'移除失败，请重试。');}
  finally{lock.current=false;setBusy(false);}
 };
 return <FlowDialog open={!!account} title="登录授权已失效" className="tfRestartDialog" busy={busy} onClose={close}>
  <p className="tfDialogLead">{account?.account.label} 有 {account?.count} 份授权已确认失效，是否删除这些授权？同账号的可用授权会保留。</p>
  {error&&<p className="tfError" role="alert">{error}</p>}
  <footer><button disabled={busy} onClick={close}>暂时保留</button><button className="primary" disabled={busy} onClick={()=>void remove()}>{busy?'正在移除…':'确定移除'}</button></footer>
 </FlowDialog>;
}
