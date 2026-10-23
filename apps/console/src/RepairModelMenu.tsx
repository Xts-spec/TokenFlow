import {useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import {modelGroups,type Choice} from './flow-model';
import {compareNames,orderModels,useModelOrder} from './display-order';
import {ProviderIcon} from './ProviderIcon';
import {Icon} from './Icons';

/** Small, non-modal menu anchored to the repair chat's model button. */
export function RepairModelMenu({local,anchor,current,isDisabled,onPick,onClose}:{local:LocalAgentSnapshot;anchor:RefObject<HTMLButtonElement|null>;current?:Choice;isDisabled:(choice:Choice)=>boolean;onPick:(choice:Choice)=>void;onClose:()=>void}){
 const menu=useRef<HTMLDivElement>(null);const close=useRef(onClose);close.current=onClose;
 const [query,setQuery]=useState('');
 const [position,setPosition]=useState({left:0,top:0,width:280,maxHeight:320});
 const [order,,ranks]=useModelOrder();
 useLayoutEffect(()=>{
  const place=()=>{const button=anchor.current;if(!button)return;const rect=button.getBoundingClientRect();const width=Math.min(320,innerWidth-24);const top=rect.bottom+8;setPosition({left:Math.max(12,Math.min(rect.right-width,innerWidth-width-12)),top,width,maxHeight:Math.max(80,Math.min(360,innerHeight-top-12))});};
  const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!menu.current?.contains(event.target)&&!anchor.current?.contains(event.target))close.current();};
  const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();close.current();anchor.current?.focus({preventScroll:true});}};
  place();menu.current?.querySelector<HTMLInputElement>('input')?.focus({preventScroll:true});
  document.addEventListener('pointerdown',outside);document.addEventListener('keydown',escape,true);window.addEventListener('resize',place);
  return()=>{document.removeEventListener('pointerdown',outside);document.removeEventListener('keydown',escape,true);window.removeEventListener('resize',place);};
 },[anchor]);
 const q=query.trim().toLowerCase();
 const groups=modelGroups(local).sort((a,b)=>Number(b.provider==='api')-Number(a.provider==='api')||compareNames(a.label,b.label)).map(group=>({...group,models:orderModels(group.models.filter(model=>!q||`${group.label} ${model.label} ${model.id}`.toLowerCase().includes(q)),model=>model.label,order,ranks)})).filter(group=>group.models.length);
 return createPortal(<div ref={menu} className="tfRepairModelMenu" role="dialog" aria-label="维修模型" style={position}>
  <label className="tfSearch"><Icon name="search" size={14}/><input type="search" aria-label="搜索维修模型" placeholder="搜索模型或来源" value={query} onChange={event=>setQuery(event.target.value)}/></label>
  <div className="tfRepairModelOptions">{groups.map(group=><section key={group.id} aria-label={group.label}>
   <h3 title={group.label}><ProviderIcon provider={group.provider} size={16}/><span>{group.label}</span></h3>
   {group.models.map(model=>{const choice={sourceId:group.id,model:model.id};const on=current?.sourceId===choice.sourceId&&current.model===choice.model;const disabled=isDisabled(choice);return <button type="button" key={model.id} aria-pressed={on} disabled={disabled} title={disabled?'网关尚未连接，此来源暂不可用':model.id} onClick={()=>{onPick(choice);onClose();anchor.current?.focus({preventScroll:true});}}><span>{model.label}</span>{on&&<span aria-hidden="true">✓</span>}</button>;})}
  </section>)}{!groups.length&&<p className="tfHint">{q?'没有匹配的模型':'还没有可用模型'}</p>}</div>
 </div>,anchor.current?.closest('dialog')??document.body);
}
