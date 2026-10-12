import {useEffect,useRef,type ReactNode} from 'react';
import {Icon} from './Icons';
export function FlowDialog({open,title,onClose,busy=false,className='',children}:{open:boolean;title:string;onClose:()=>void;busy?:boolean;className?:string;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open&&!dialog.current?.open)dialog.current?.showModal();else if(!open&&dialog.current?.open)dialog.current.close();},[open]);
 return <dialog ref={dialog} className={`tfDialog ${className}`} aria-label={title} onCancel={event=>{event.preventDefault();if(!busy)onClose();}} onClose={event=>{if(event.target===dialog.current)onClose();}} onClick={event=>{if(event.target===dialog.current&&!busy)onClose();}}><div className="tfDialogContent"><header><h2>{title}</h2><button type="button" className="iconButton" aria-label="关闭" disabled={busy} onClick={onClose}><Icon name="close" size={18}/></button></header>{children}</div></dialog>;
}
