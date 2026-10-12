import {useEffect,useRef,useState,type ReactNode} from 'react';
import {Icon,type IconName} from './Icons';
import type {Notice} from './notify';

export function Notifications({notice,onDismiss,warnings,onDismissWarning,gateway}:{notice?:Notice;onDismiss:()=>void;warnings:string[];onDismissWarning:(text:string)=>void;gateway?:{text:string;canStart:boolean;busy:boolean;onStart:()=>void}}){
 const container=useRef<HTMLDivElement>(null);
 const [hovered,setHovered]=useState(false);const [focused,setFocused]=useState(false);
 useEffect(()=>{
  const element=container.current;if(!element)return;
  // Popovers stay above native dialogs without taking focus or blocking the rest of the window.
  element.hidePopover();
  if(notice||warnings.length||gateway)element.showPopover();
  setHovered(element.matches(':hover'));setFocused(element.contains(document.activeElement));
 },[notice,warnings,gateway?.text]);
 useEffect(()=>{
  if(notice?.kind!=='ok'||hovered||focused)return;
  const timer=setTimeout(onDismiss,6000);return()=>clearTimeout(timer);
 },[notice,hovered,focused,onDismiss]);
 const card=(kind:'ok'|'error'|'warning',title:string,text:string,action:ReactNode)=>{
  const icon:IconName=kind==='ok'?'checkCircle':'alertCircle';
  return <section className={`tfToast ${kind}`} role={kind==='ok'?'status':'alert'} aria-label={title}><span className="tfToastIcon"><Icon name={icon} size={20}/></span><div className="tfToastText"><strong>{title}</strong><p>{text}</p></div>{action}</section>;
 };
 return <div ref={container} popover="manual" className="tfNotifications" aria-label="消息提示" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)} onFocusCapture={()=>setFocused(true)} onBlurCapture={event=>{if(!event.currentTarget.contains(event.relatedTarget))setFocused(false);}}>
  {notice&&card(notice.kind,notice.kind==='ok'?'操作完成':'操作未完成',notice.text,<button className="tfToastClose" aria-label="关闭提示" onClick={onDismiss}><Icon name="close" size={16}/></button>)}
  {warnings.map(text=><div key={text}>{card('warning','需要注意',text,<button className="tfToastClose" aria-label="关闭提醒" onClick={()=>onDismissWarning(text)}><Icon name="close" size={16}/></button>)}</div>)}
  {gateway&&card('warning','网关状态',gateway.text,gateway.canStart?<button className="tfToastAction" disabled={gateway.busy} onClick={gateway.onStart}>启动</button>:null)}
 </div>;
}
