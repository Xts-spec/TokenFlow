import {useLayoutEffect,useRef} from 'react';

export function ColumnDivider({storageKey,label}:{storageKey:string;label:string}){
 const divider=useRef<HTMLDivElement>(null),value=useRef(36),dragging=useRef(false);
 const apply=(next:number)=>{value.current=Math.round(Math.max(24,Math.min(68,next)));const node=divider.current;node?.parentElement?.style.setProperty('--split',`${value.current}%`);node?.setAttribute('aria-valuenow',String(value.current));};
 const save=()=>{try{localStorage.setItem(storageKey,String(value.current));}catch{/* Layout preferences are optional. */}};
 useLayoutEffect(()=>{let saved=36;try{const raw=localStorage.getItem(storageKey);if(raw&&Number.isFinite(Number(raw)))saved=Number(raw);}catch{}apply(saved);},[storageKey]);
 return <div ref={divider} className="tfColumnDivider" role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={24} aria-valuemax={68} aria-valuenow={36} tabIndex={0} title="拖动调整两栏宽度；双击恢复；方向键微调"
  onPointerDown={event=>{if(event.button!==0)return;dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);event.currentTarget.parentElement?.classList.add('tfSplitDragging');event.preventDefault();}}
  onPointerMove={event=>{if(!dragging.current)return;const box=event.currentTarget.parentElement?.getBoundingClientRect();if(box)apply((event.clientX-box.left)/box.width*100);}}
  onLostPointerCapture={()=>{dragging.current=false;divider.current?.parentElement?.classList.remove('tfSplitDragging');save();}}
  onPointerUp={event=>{if(dragging.current)event.currentTarget.releasePointerCapture(event.pointerId);}}
  onDoubleClick={()=>{apply(36);save();}}
  onKeyDown={event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();apply(event.key==='Home'?24:event.key==='End'?68:value.current+(event.key==='ArrowRight'?2:-2));save();}}
 />;
}
