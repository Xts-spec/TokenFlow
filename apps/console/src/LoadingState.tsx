import {useState} from 'react';
/** Shared request feedback; skeletons never stand in for a confirmed empty result. */
export function Thinking({label='正在获取信息'}:{label?:string}){
 return <span className="tfThinking" role="status"><span className="tfThinkingDots" aria-hidden="true"><i/><i/><i/></span><span>Thinking<span className="srOnly"> · {label}</span></span></span>;
}
export function LoadingSkeleton({label='正在加载',variant='panel'}:{label?:string;variant?:'panel'|'overview'|'cards'}){
 return <div className={`tfLoadingSkeleton ${variant}`} role="status" aria-label={label} aria-busy="true"><div aria-hidden="true"><div className="tfSkeletonLine heading"/>{variant==='overview'?<><div className="tfSkeletonMetrics">{Array.from({length:5},(_,i)=><div className="tfSkeletonBlock" key={i}/>)}</div><div className="tfSkeletonBlock chart"/></>:variant==='cards'?<div className="tfSkeletonCards">{Array.from({length:3},(_,i)=><div className="tfSkeletonBlock card" key={i}/>)}</div>:null}<div className="tfSkeletonRows">{Array.from({length:4},(_,i)=><div className="tfSkeletonLine" key={i}/>)}</div></div><span className="srOnly">{label}</span></div>;
}
export function LoadError({message,retry}:{message:string;retry:()=>unknown}){
 const [loading,setLoading]=useState(false);
 const reload=async()=>{if(loading)return;setLoading(true);try{await retry();}finally{setLoading(false);}};
 return <div className="tfLoadError" role="alert"><span>{message}</span><button type="button" className="textButton" disabled={loading} onClick={()=>void reload().catch(()=>{})}>{loading?<Thinking label="正在重新加载"/>:'重新加载'}</button></div>;
}
