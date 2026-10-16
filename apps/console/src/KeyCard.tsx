import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import type {MoveOrder} from './display-order';
import {Icon} from './Icons';

export function KeyActions({name,enabled,disabled,onRename,onToggle,onDelete}:{name:string;enabled:boolean;disabled?:boolean;onRename:()=>void;onToggle:()=>void;onDelete:()=>void}){
 const id=useId(),panel=useRef<HTMLDivElement>(null);
 const run=(action:()=>void)=>{panel.current?.hidePopover();action();};
 return <div className="tfKeyActions"><button type="button" className="iconButton" aria-label={`管理 ${name}`} popoverTarget={id} disabled={disabled} onClick={event=>{const box=event.currentTarget.getBoundingClientRect();if(panel.current){panel.current.style.left=`${Math.max(12,Math.min(window.innerWidth-192,box.right-180))}px`;panel.current.style.top=`${Math.min(window.innerHeight-140,box.bottom+6)}px`;}}}><Icon name="more" size={18}/></button><div ref={panel} id={id} popover="auto" className="tfKeyActionMenu" aria-label={`${name} 的操作`}><button type="button" onClick={()=>run(onRename)}>重命名</button><button type="button" onClick={()=>run(onToggle)}>{enabled?'停用':'启用'}</button><button type="button" className="danger" onClick={()=>run(onDelete)}>删除</button></div></div>;
}

/** Hold to lift a card, then release over another card to save its order. */
export function useKeyHold(move:MoveOrder,ids:readonly string[]){
 const [dragging,setDragging]=useState('');
 const gesture=useRef<{id:string;x:number;y:number;timer:ReturnType<typeof setTimeout>;active:boolean;target:string}|undefined>(undefined);
 const suppress=useRef(false);
 const finish=useRef<()=>void>(()=>{});
 useEffect(()=>()=>finish.current(),[]);
 const onPointerDown=(id:string,event:PointerEvent<HTMLElement>)=>{
  if(event.button!==0||ids.length<2||(event.target as Element).closest('.tfKeyActions'))return;
  finish.current();suppress.current=false;
  const card=event.currentTarget;
  const current={id,x:event.clientX,y:event.clientY,timer:setTimeout(()=>{},0),active:false,target:''};
  const clear=()=>{card.style.translate='';clearTimeout(current.timer);window.removeEventListener('pointermove',moving);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);document.querySelectorAll('.tfKeyDropTarget').forEach(n=>n.classList.remove('tfKeyDropTarget'));gesture.current=undefined;setDragging('');};
  const moving=(e:globalThis.PointerEvent)=>{
   if(!current.active){if(Math.hypot(e.clientX-current.x,e.clientY-current.y)>8)clear();return;}
   e.preventDefault();card.style.translate=`${e.clientX-current.x}px ${e.clientY-current.y}px`;document.querySelectorAll('.tfKeyDropTarget').forEach(n=>n.classList.remove('tfKeyDropTarget'));
   const target=document.elementFromPoint(e.clientX,e.clientY)?.closest<HTMLElement>('[data-key-card]');current.target=target?.dataset.keyCard??'';
   if(current.target&&current.target!==id)target?.classList.add('tfKeyDropTarget');
  };
  const up=()=>{if(current.active&&current.target&&current.target!==id)move(id,current.target,ids,ids.indexOf(id)<ids.indexOf(current.target));clear();};
  const cancel=()=>{suppress.current=current.active;clear();};
  current.timer=setTimeout(()=>{current.active=true;suppress.current=true;setDragging(id);},380);gesture.current=current;finish.current=clear;
  window.addEventListener('pointermove',moving,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);
 };
 return {dragging,onPointerDown,consumeClick:()=>{const value=suppress.current;suppress.current=false;return value;}};
}
