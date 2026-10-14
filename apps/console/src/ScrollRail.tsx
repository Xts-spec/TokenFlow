import {useLayoutEffect,useRef,useState,type HTMLAttributes} from 'react';
import {Icon} from './Icons';

// Keep the tab list native: trackpads, touch and keyboard all use the same scroll position.
export function ScrollRail({children,className='',onKeyDown,...props}:HTMLAttributes<HTMLDivElement>){
 const rail=useRef<HTMLDivElement>(null);
 const [edges,setEdges]=useState({left:false,right:false});
 useLayoutEffect(()=>{
  const node=rail.current;if(!node)return;
  const update=()=>setEdges({left:node.scrollLeft>1,right:node.scrollLeft+node.clientWidth<node.scrollWidth-1});
  const reveal=()=>{const active=node.querySelector<HTMLElement>('[aria-selected=true]');if(active){const a=active.getBoundingClientRect(),r=node.getBoundingClientRect();if(a.left<r.left)node.scrollLeft+=a.left-r.left;else if(a.right>r.right)node.scrollLeft+=a.right-r.right;}update();};
  const resize=new ResizeObserver(reveal);resize.observe(node);
  const mutation=new MutationObserver(reveal);mutation.observe(node,{childList:true,subtree:true,attributes:true,attributeFilter:['aria-selected']});
  node.addEventListener('scroll',update,{passive:true});reveal();
  return()=>{resize.disconnect();mutation.disconnect();node.removeEventListener('scroll',update);};
 },[]);
 const move=(direction:number)=>rail.current?.scrollBy({left:direction*rail.current.clientWidth*.7,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 return <div className="tfRail">
  {edges.left&&<button type="button" className="tfRailArrow previous" aria-label={`${props['aria-label']??'列表'}向左浏览`} onClick={()=>move(-1)}><Icon name="chevron" size={14}/></button>}
  <div {...props} ref={rail} className={`${className} tfRailTrack`} onKeyDown={event=>{
   onKeyDown?.(event);if(event.defaultPrevented||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   const tabs=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role=tab]'));const index=tabs.indexOf(event.target as HTMLButtonElement);if(index<0)return;
   event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
   tabs[next]?.focus({preventScroll:true});tabs[next]?.click();
  }}>{children}</div>
  {edges.right&&<button type="button" className="tfRailArrow next" aria-label={`${props['aria-label']??'列表'}向右浏览`} onClick={()=>move(1)}><Icon name="chevron" size={14}/></button>}
 </div>;
}
