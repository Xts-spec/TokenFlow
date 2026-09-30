import { useEffect, useRef } from 'react';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import type { MaintenanceChain } from '../../../packages/core/src/gateway-maintenance';
import { MaintenancePane } from './A2APane';
import { Icon } from './Icons';

export function RepairDrawer({local,open,context,onClose}:{local:LocalAgentSnapshot;open:boolean;context?:MaintenanceChain;onClose:()=>void}) {
  const dialog=useRef<HTMLDialogElement>(null);
  const previousFocus=useRef<HTMLElement|null>(null);
  useEffect(()=>{
    if(open&&!dialog.current?.open){
      previousFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
      dialog.current?.showModal();
    }else if(!open&&dialog.current?.open){
      dialog.current.close();
      if(previousFocus.current?.isConnected)previousFocus.current.focus();
    }
  },[open]);
  return <dialog ref={dialog} className="repairDrawer" aria-labelledby="repair-drawer-title" onClose={e=>{if(e.target===dialog.current)onClose();}} onCancel={e=>{if(e.target===dialog.current)onClose();}} onClick={e=>{if(e.target===dialog.current)onClose();}}>
    <header className="repairDrawerHeader"><div><h2 id="repair-drawer-title">维修师傅</h2><p>关闭面板会保留会话，正在执行的检查继续运行。</p></div><button className="iconButton" aria-label="关闭维修抽屉" onClick={onClose}><Icon name="close"/></button></header>
    <MaintenancePane local={local} visible={open} context={context}/>
  </dialog>;
}
