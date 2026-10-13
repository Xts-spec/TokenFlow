import {useEffect,useRef,useState,type DragEvent,type KeyboardEvent} from 'react';
import {Icon} from './Icons';
export type ModelOrder='name'|'name-desc'|'manual';
export type KeyOrder='newest'|'name'|'tokens'|'manual';
const event='token-flow.display-order';
const compare=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'}).compare;
export const compareNames=(a:string,b:string)=>compare(a,b)||a.localeCompare(b);
export const modelIdentity=(item:unknown):string=>typeof item==='string'?item:String((item as {model?:string;id?:string})?.model??(item as {id?:string})?.id??'');
export const apiModel=(id:string)=>/^api-[a-f0-9]{24}\//i.test(id);
export function orderModels<T>(items:readonly T[],name:(item:T)=>string,order:ModelOrder='name',manual:readonly string[]=[],identity:(item:T)=>string=modelIdentity):T[]{
 const rank=new Map(manual.map((id,i)=>[id,i]));
 return [...items].sort((a,b)=>{
  const aid=identity(a),bid=identity(b);
  if(order==='manual'){const diff=(rank.get(aid)??Infinity)-(rank.get(bid)??Infinity);if(diff&&!Number.isNaN(diff))return diff;}
  return Number(apiModel(bid))-Number(apiModel(aid))||compareNames(name(a),name(b))*(order==='name-desc'?-1:1)||compareNames(aid,bid);
 });
}
export function orderKeys<T extends {id:string;name:string;createdAt:string;usedTokens:number;models?:readonly string[]}>(items:readonly T[],order:KeyOrder='name',manual:readonly string[]=[]):T[]{
 const rank=new Map(manual.map((id,i)=>[id,i]));
 return [...items].sort((a,b)=>{if(order==='manual'){const diff=(rank.get(a.id)??Infinity)-(rank.get(b.id)??Infinity);if(diff&&!Number.isNaN(diff))return diff;}const apiPriority=Number(b.models?.some(apiModel)??false)-Number(a.models?.some(apiModel)??false);return (order==='tokens'?b.usedTokens-a.usedTokens:order==='newest'?b.createdAt.localeCompare(a.createdAt):apiPriority||compareNames(a.name,b.name))||compareNames(a.name,b.name)||a.id.localeCompare(b.id);});
}
/** Reorder only the visible subset; searches and temporarily missing models retain their saved positions. */
export function moveOrder(saved:readonly string[],visible:readonly string[],from:string,to:string,after=false){
 const ids=[...new Set(visible)];if(from===to||!ids.includes(from)||!ids.includes(to))return [...saved];
 const moved=ids.filter(id=>id!==from);moved.splice(moved.indexOf(to)+(after?1:0),0,from);
 const full=[...new Set([...saved,...ids])],shown=new Set(ids);let i=0;
 return full.map(id=>shown.has(id)?moved[i++]:id);
}
const storageKey=(kind:string)=>`token-flow.sort.${kind}`;
function saved(kind:string,fallback:string,valid:readonly string[]){try{const value=localStorage.getItem(storageKey(kind));return value&&valid.includes(value)?value:fallback;}catch{return fallback;}}
function savedManual(kind:string):string[]{try{const ids=JSON.parse(localStorage.getItem(storageKey(`${kind}.manual`))??'[]');return Array.isArray(ids)?[...new Set(ids.filter(id=>typeof id==='string'&&id.length>0&&id.length<=512))].slice(0,5000):[];}catch{return [];}}
function useOrder<T extends string>(kind:string,fallback:T,valid:readonly T[]){
 const [value,setValue]=useState<T>(()=>saved(kind,fallback,valid) as T),[manual,setManual]=useState(()=>savedManual(kind));const latest=useRef(manual);latest.current=manual;
 useEffect(()=>{const sync=()=>{setValue(saved(kind,fallback,valid) as T);setManual(savedManual(kind));};window.addEventListener(event,sync);window.addEventListener('storage',sync);return()=>{window.removeEventListener(event,sync);window.removeEventListener('storage',sync);};},[kind,fallback]);
 const set=(next:T)=>{setValue(next);try{localStorage.setItem(storageKey(kind),next);}catch{}window.dispatchEvent(new Event(event));};
 const move=(from:string,to:string,visible:readonly string[],after=false)=>{
  if(from===to||!visible.includes(from)||!visible.includes(to))return;
  const next=moveOrder(latest.current,visible,from,to,after);latest.current=next;setManual(next);setValue('manual' as T);
  try{localStorage.setItem(storageKey(`${kind}.manual`),JSON.stringify(next));localStorage.setItem(storageKey(kind),'manual');}catch{}window.dispatchEvent(new Event(event));
 };
 return [value,set,manual,move] as const;
}
export const useModelOrder=()=>useOrder<ModelOrder>('models','name',['name','name-desc','manual']);
export const useKeyOrder=()=>useOrder<KeyOrder>('keys','name',['newest','name','tokens','manual']);
export function ModelOrderControl({value,onChange}:{value:ModelOrder;onChange:(value:ModelOrder)=>void}){return <select className="tfOrder" aria-label="模型排序" value={value} onChange={event=>onChange(event.target.value as ModelOrder)}><option value="name">名称 A–Z</option><option value="name-desc">名称 Z–A</option><option value="manual">手动排序</option></select>;}
export type MoveOrder=(from:string,to:string,visible:readonly string[],after?:boolean)=>void;
const mime=(kind:string)=>`application/x-token-flow-${kind}`;
export function dropOrder(kind:'models'|'keys',id:string,visible:readonly string[],move:MoveOrder){return {
 onDragOver:(event:DragEvent<HTMLElement>)=>{if(event.dataTransfer.types.includes(mime(kind))){event.preventDefault();event.dataTransfer.dropEffect='move';event.currentTarget.classList.add('tfDragOver');}},
 onDragLeave:(event:DragEvent<HTMLElement>)=>{if(!(event.relatedTarget instanceof Node)||!event.currentTarget.contains(event.relatedTarget))event.currentTarget.classList.remove('tfDragOver');},
 onDrop:(event:DragEvent<HTMLElement>)=>{event.preventDefault();event.stopPropagation();event.currentTarget.classList.remove('tfDragOver');const from=event.dataTransfer.getData(mime(kind));if(from)move(from,id,visible,visible.indexOf(from)<visible.indexOf(id));},
 };}
export function DragHandle({kind,id,label,items,move,disabled=false}:{kind:'models'|'keys';id:string;label:string;items:readonly string[];move:MoveOrder;disabled?:boolean}){
 const keyMove=(event:KeyboardEvent<HTMLButtonElement>)=>{if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;event.preventDefault();event.stopPropagation();const down=event.key==='ArrowDown'||event.key==='ArrowRight',target=items[items.indexOf(id)+(down?1:-1)];if(target)move(id,target,items,down);};
 return <button type="button" className="tfDragHandle" aria-label={kind==='models'?'调整模型顺序':'调整 Key 顺序'} aria-description={label} title={`拖动调整 ${label} 的顺序，也可用方向键移动`} disabled={disabled||items.length<2} draggable={!disabled&&items.length>1} onClick={event=>{event.preventDefault();event.stopPropagation();}} onKeyDown={keyMove} onDragStart={event=>{event.stopPropagation();event.dataTransfer.setData(mime(kind),id);event.dataTransfer.effectAllowed='move';const row=event.currentTarget.closest('.tfDragRow,.tfKeyCard');if(row)event.dataTransfer.setDragImage(row,12,12);}} onDragEnd={()=>document.querySelectorAll('.tfDragOver').forEach(node=>node.classList.remove('tfDragOver'))}><Icon name="grip" size={14}/></button>;
}
