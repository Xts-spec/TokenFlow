import {useRef,type MouseEvent,type PointerEvent} from 'react';

/** Both press and release must be outside: dragging a selection out never dismisses. */
export function useDialogDismiss(onClose:()=>void,busy=false){
 const pressedOutside=useRef(false);
 const outside=(event:MouseEvent<HTMLDialogElement>|PointerEvent<HTMLDialogElement>)=>{
  const rect=event.currentTarget.getBoundingClientRect();
  return event.clientX<rect.left||event.clientX>=rect.right||event.clientY<rect.top||event.clientY>=rect.bottom;
 };
 return {
  onPointerDown:(event:PointerEvent<HTMLDialogElement>)=>{if(!event.currentTarget.contains(event.target as Node))return;pressedOutside.current=event.button===0&&outside(event);},
  onClick:(event:MouseEvent<HTMLDialogElement>)=>{if(!event.currentTarget.contains(event.target as Node))return;const dismiss=pressedOutside.current&&outside(event);pressedOutside.current=false;if(dismiss&&!busy)onClose();},
 };
}
