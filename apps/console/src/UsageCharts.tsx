import {useState} from 'react';
import {dailyTokens,formatTokens,percentText,type UsageRow} from './usage-model';

/** One population, shown as shares rather than a progress/completion indicator. */
export function UsageDistribution({title,items}:{title:string;items:{label:string;value:number;color:string}[]}){
 const total=items.reduce((sum,item)=>sum+item.value,0);
 return <section className="tfDistribution" aria-label={title}><header><h3>{title}</h3><span>{formatTokens(total)} Token</span></header>
  <svg viewBox="0 0 1000 24" preserveAspectRatio="none" role="img" aria-label={`${title}：${items.map(item=>`${item.label} ${formatTokens(item.value)} Token`).join('，')}`}>
   {total>0?items.map((item,index)=><rect key={item.label} x={items.slice(0,index).reduce((sum,p)=>sum+p.value,0)/total*1000} y="0" width={item.value/total*1000} height="24" fill={item.color}><title>{item.label} {formatTokens(item.value)} Token · {percentText(item.value/total)}</title></rect>):<rect width="1000" height="24" fill="#e3e9f1"/>}
  </svg>
  <ul>{items.map(item=><li key={item.label}><i style={{background:item.color}}/><span>{item.label}</span><b>{formatTokens(item.value)} <small>Token</small></b><small>{percentText(total?item.value/total:null)}</small></li>)}</ul>
 </section>;
}

/** A linear, zero-baseline time series: heights compare daily token totals directly. */
export function TokenTrend({rows,onSelect}:{rows:readonly UsageRow[];onSelect?:(day:string)=>void}){
 const days=dailyTokens(rows,30);const peak=Math.max(0,...days.map(d=>d.tokens));const [hover,setHover]=useState<string>();
 const point=(index:number)=>({x:64+index/(days.length-1)*908,y:160-days[index].tokens/(peak||1)*128});
 const points=days.map((_,i)=>{const p=point(i);return `${p.x},${p.y}`;}).join(' ');
 const active=days.find(d=>d.day===hover);
 return <figure className="tfTokenTrend" aria-label="近 30 天 Token 趋势"><figcaption><h3>近 30 天</h3><span>{active?`${active.day} · ${formatTokens(active.tokens)} Token`:`每日峰值 ${formatTokens(peak)} Token`}</span></figcaption>
  <svg viewBox="0 0 1000 198" role="img" aria-label="每日 Token 用量折线图，纵轴从零开始">
   {[0,.5,1].map(ratio=><g key={ratio}><line x1="64" x2="972" y1={160-ratio*128} y2={160-ratio*128} stroke="#e3e9f1"/><text x="54" y={164-ratio*128} textAnchor="end">{formatTokens(peak*ratio)}</text></g>)}
   <polygon points={`64,160 ${points} 972,160`} fill="#edf3ff"/>
   <polyline points={points} fill="none" stroke="#2563eb" strokeWidth="2.5"/>
   {days.map((day,index)=>{const p=point(index);return <circle key={day.day} cx={p.x} cy={p.y} r={hover===day.day?5:7} fill={hover===day.day?'#2563eb':'transparent'} tabIndex={0} role="button" aria-label={`${day.day} · ${formatTokens(day.tokens)} Token`} onMouseEnter={()=>setHover(day.day)} onMouseLeave={()=>setHover(undefined)} onFocus={()=>setHover(day.day)} onBlur={()=>setHover(undefined)} onClick={()=>onSelect?.(day.day)} onKeyDown={event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();onSelect?.(day.day);}}}><title>{day.day} · {formatTokens(day.tokens)} Token</title></circle>;})}
   <text x="64" y="192">{days[0].day.slice(5)}</text><text x="972" y="192" textAnchor="end">{days.at(-1)!.day.slice(5)}</text>
  </svg>
 </figure>;
}
