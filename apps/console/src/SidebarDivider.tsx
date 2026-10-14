import {useLayoutEffect,useRef} from 'react';

const storageKey='token-flow.layout.sidebar-width';
export function SidebarDivider(){
 const handle=useRef<HTMLDivElement>(null),width=useRef(280),origin=useRef<{x:number;width:number}|undefined>(undefined);
 const apply=(next:number)=>{
  width.current=Math.round(Math.max(240,Math.min(400,window.innerWidth-480,next)));
  handle.current?.parentElement?.style.setProperty('--sidebar-width',`${width.current}px`);
  handle.current?.setAttribute('aria-valuenow',String(width.current));
 };
 const save=()=>{try{localStorage.setItem(storageKey,String(width.current));}catch{}};
 useLayoutEffect(()=>{
  let initial=280;try{const saved=Number(localStorage.getItem(storageKey));if(Number.isFinite(saved)&&saved>=240)initial=saved;}catch{}
  apply(initial);const resize=()=>apply(width.current);window.addEventListener('resize',resize);return()=>window.removeEventListener('resize',resize);
 },[]);
 return <div ref={handle} className="tfSidebarDivider" role="separator" aria-label="调整菜单宽度" aria-orientation="vertical" aria-valuemin={240} aria-valuemax={400} aria-valuenow={280} tabIndex={0}
  onPointerDown={event=>{if(event.button!==0)return;origin.current={x:event.clientX,width:width.current};event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.parentElement?.classList.add('tfSidebarDragging');event.preventDefault();}}
  onPointerMove={event=>{if(origin.current)apply(origin.current.width+event.clientX-origin.current.x);}}
  onPointerUp={event=>{if(origin.current)event.currentTarget.releasePointerCapture(event.pointerId);}}
  onLostPointerCapture={()=>{origin.current=undefined;handle.current?.parentElement?.classList.remove('tfSidebarDragging');save();}}
  onDoubleClick={()=>{apply(280);save();}}
  onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();apply(event.key==='Home'?240:event.key==='End'?400:width.current+(event.key==='ArrowRight'?10:-10));save();}}
 />;
}
