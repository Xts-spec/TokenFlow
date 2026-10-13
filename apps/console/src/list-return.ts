import {useLayoutEffect,useRef} from 'react';

/** Restore the list after an inline editor or expanded detail has been removed. */
export function useListReturn(open:boolean){
 const saved=useRef<{scroll:HTMLElement;top:number;left:number;opener:HTMLElement|null}|undefined>(undefined);
 const remember=()=>{
  const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  const scroll=opener?.closest<HTMLElement>('.tfMain')??document.querySelector<HTMLElement>('.tfMain');
  if(scroll)saved.current={scroll,top:scroll.scrollTop,left:scroll.scrollLeft,opener};
 };
 useLayoutEffect(()=>{
  if(open||!saved.current)return;
  const position=saved.current;saved.current=undefined;
  if(position.opener?.isConnected)position.opener.focus({preventScroll:true});
  position.scroll.scrollTop=position.top;position.scroll.scrollLeft=position.left;
 },[open]);
 return remember;
}
