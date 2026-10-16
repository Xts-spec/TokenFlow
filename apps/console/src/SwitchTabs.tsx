import {useId} from 'react';

/** A shared text tab control with the same pointer and keyboard behavior. */
export function SwitchTabs<T extends string>({label,value,options,onChange,disabled=false,className='',idPrefix,panelId}:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void;disabled?:boolean;className?:string;idPrefix?:string;panelId?:string}){
 const generated=useId(),prefix=idPrefix??generated;
 return <div className={`tfSwitchTabs ${className}`} role="tablist" aria-label={label}>{options.map(([id,text],index)=><button key={id} type="button" role="tab" id={`${prefix}-${id}`} aria-controls={panelId} aria-selected={value===id} tabIndex={value===id?0:-1} disabled={disabled} onClick={()=>onChange(id)} onKeyDown={event=>{
  let next:number|undefined;
  if(event.key==='ArrowRight')next=(index+1)%options.length;
  else if(event.key==='ArrowLeft')next=(index+options.length-1)%options.length;
  else if(event.key==='Home')next=0;
  else if(event.key==='End')next=options.length-1;
  if(next!==undefined){event.preventDefault();onChange(options[next][0]);document.getElementById(`${prefix}-${options[next][0]}`)?.focus({preventScroll:true});}
 }}>{text}</button>)}</div>;
}
