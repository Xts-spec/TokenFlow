import {useEffect,useId,useState} from 'react';
import type {ActivityTrace,ActivityTraceDetail} from '../../../packages/core/src/activity-traces';
import {requestJSON} from './request';
import {Icon} from './Icons';
import {durationText,formatTokens,rangeDays,type RangeId} from './usage-model';

type Filter={target?:string;sourceId?:string;keyId?:string;kind?:'api'};
export function TracePanel({range,filter={},title='调用轨迹',includeNative=false,origin='all',onOriginChange}:{range:RangeId;filter?:Filter;title?:string;includeNative?:boolean;origin?:'all'|'native'|'gateway';onOriginChange?:(origin:'all'|'native'|'gateway')=>void}){
 const detailId=useId();const [scanningNative,setScanningNative]=useState(false);
 const [rows,setRows]=useState<ActivityTrace[]>([]),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[search,setSearch]=useState(''),[view,setView]=useState<'duration'|'calls'>('duration');
 const [detail,setDetail]=useState<ActivityTraceDetail>(),[selected,setSelected]=useState(''),[detailError,setDetailError]=useState('');
 const endpoint=includeNative?'/api/activity/traces':'/api/gateway/traces';
 const query=new URLSearchParams({days:String(rangeDays(range)),limit:'100',...filter,...(includeNative?{origin}:{})}).toString();
 useEffect(()=>{let live=true;const refresh=async()=>{try{const data=await requestJSON<{records:ActivityTrace[];warning?:string;scanning?:boolean}>(`${endpoint}?${query}`);if(live){setRows(data.records);setScanningNative(!!data.scanning);setError(data.warning??'');setLoaded(true);}}catch(e){if(live)setError(e instanceof Error?e.message:'轨迹读取失败');}};void refresh();const timer=setInterval(()=>void refresh(),5000);return()=>{live=false;clearInterval(timer);};},[query,endpoint]);
 useEffect(()=>{if(!selected)return;let live=true;setDetail(undefined);setDetailError('');void requestJSON<{record:ActivityTraceDetail}>(`${endpoint}/${selected}`).then(data=>{if(live)setDetail(data.record);}).catch(e=>{if(live)setDetailError(e.message);});return()=>{live=false;};},[selected,endpoint]);
 useEffect(()=>setSelected(''),[query]);
 const duration=(row:ActivityTrace|ActivityTraceDetail)=>row.timingKnown===false?'未记录耗时':durationText(row.durationMs);
 const originLabel=(row:ActivityTrace|ActivityTraceDetail)=>row.origin==='native'?`本机直连 · ${row.channel==='official'?'官方登录':row.channel==='api'?'API':'渠道未确认'}`:'经 TokenFlow';
 const shown=rows.filter(r=>`${r.agent} ${originLabel(r)} ${r.model} ${r.protocol} ${(r.toolNames??[]).join(' ')}`.toLowerCase().includes(search.toLowerCase()));
 const runs=new Set(shown.filter(r=>r.origin!=='native').map(r=>r.runId));const toolCalls=shown.reduce((n,r)=>n+r.toolCalls,0),toolResults=shown.reduce((n,r)=>n+r.toolResults,0);
 const chronological=[...shown].reverse();const start=Math.min(...shown.map(r=>Date.parse(r.startedAt))),end=Math.max(...shown.map(r=>Date.parse(r.startedAt)+r.durationMs)),span=Math.max(1,end-start);
 const offset=(r:ActivityTrace,index:number)=>view==='duration'?(Date.parse(r.startedAt)-start)/span*100:index/Math.max(1,shown.length)*100;
 const width=(r:ActivityTrace)=>view==='duration'?Math.max(.6,r.durationMs/span*100):95/Math.max(1,shown.length);
 return <section className="tfTrace" aria-label={title} onKeyDown={event=>{if(event.key==='Escape'&&selected){event.stopPropagation();setSelected('');}}}>
  <header className="tfTraceHead"><div><h4>{title}</h4><p>{loaded?`${shown.length} 次模型请求 · ${runs.size} 条网关请求链 · ${toolCalls} 次工具调用 · ${toolResults} 个返回结果`:'正在读取轨迹…'}</p></div><input type="search" aria-label={`搜索${title}`} placeholder="搜索 Agent、模型或工具" value={search} onChange={e=>setSearch(e.target.value)}/></header>
  {includeNative&&<div className="tfTraceOrigins" role="group" aria-label="记录来源">{([['all','全部'],['gateway','经 TokenFlow'],['native','本机直连']] as const).map(([value,label])=><button className="textButton" key={value} aria-pressed={origin===value} onClick={()=>onOriginChange?.(value)}>{label}</button>)}</div>}
  {error&&<p className="tfError" role="alert">{error}</p>}
  {shown.length>0&&<>
   <div className="tfTraceModes" role="group" aria-label="轨迹展示方式"><button className="textButton" aria-pressed={view==='duration'} onClick={()=>setView('duration')}>时长</button><button className="textButton" aria-pressed={view==='calls'} onClick={()=>setView('calls')}>调用</button><small>工具节点表示结果到达网关的时间。</small></div>
   <div className="tfTraceTimeline" aria-label="请求与工具时间轨迹">{(['输入','模型','工具'] as const).map((lane,laneIndex)=><div className="tfTraceLane" key={lane}><span>{lane}</span><div>{chronological.map((r,index)=>laneIndex===2&&r.toolResults===0?null:<button key={r.id} className={`lane-${laneIndex}${r.status>=400?' failed':''}`} style={{left:`${offset(r,index)}%`,width:laneIndex===1&&r.timingKnown!==false?`${width(r)}%`:6}} title={`${new Date(r.startedAt).toLocaleTimeString('zh-CN')} · ${r.model} · ${duration(r)}${laneIndex===2?` · ${r.toolResults} 个工具结果`:''}`} aria-label={`查看${lane}轨迹 ${r.model}`} aria-controls={detailId} aria-expanded={selected===r.id} onClick={()=>setSelected(r.id)}/>)}</div></div>)}</div>
   <div className={`tfTraceWorkspace ${selected?'inspecting':''}`}>
   <ul className="tfTraceList">{shown.map(r=><li key={r.id} className={selected===r.id?'selected':''}><button aria-controls={detailId} aria-expanded={selected===r.id} onClick={()=>setSelected(r.id)}><span className={`tfTraceState ${r.status>=400?'bad':''}`}/><span className="tfTraceIdentity"><strong>{r.model}</strong><small>{originLabel(r)} · {r.agent} · {new Date(r.startedAt).toLocaleString('zh-CN')} · {r.origin==='native'?'用量记录':r.protocol==='responses/compact'?'压缩上下文':'模型请求'}</small></span><span className="tfTraceNumbers"><b>{r.inputTokens===null&&r.outputTokens===null?'用量未返回':`${formatTokens((r.inputTokens??0)+(r.outputTokens??0))} tok`}</b><small>{duration(r)}{r.toolTraceKnown===false?' · 工具未记录':` · 工具 ${r.toolCalls} / 返回 ${r.toolResults}`}</small></span></button></li>)}</ul>
    {selected&&<aside id={detailId} className="tfTraceInspector" aria-label="调用轨迹详情"><header><h4>调用轨迹详情</h4><button className="iconButton" aria-label="关闭轨迹详情" onClick={()=>setSelected('')}><Icon name="close" size={14}/></button></header>
   {detailError&&<p className="tfError" role="alert">{detailError}</p>}
   {!detail&&!detailError&&<p>正在读取…</p>}
   {detail&&<div className="tfTraceDetail">
    <p><strong>{detail.model}</strong><br/>{originLabel(detail)} · {detail.agent} · {new Date(detail.startedAt).toLocaleString('zh-CN')}{detail.statusKnown===false?' · HTTP 状态未记录':` · HTTP ${detail.status}`}</p>
    <dl className="tfTraceFacts"><div><dt>总 Token</dt><dd>{detail.inputTokens===null&&detail.outputTokens===null?'未返回':formatTokens((detail.inputTokens??0)+(detail.outputTokens??0))}</dd></div><div><dt>模型请求耗时</dt><dd>{duration(detail)}</dd></div><div><dt>首个输出等待</dt><dd>{detail.timingKnown===false?'未记录':durationText(detail.firstOutputMs??null)}</dd></div><div><dt>生成速率</dt><dd>{detail.generationMs&&detail.outputTokens!==null?`${(detail.outputTokens*1000/detail.generationMs).toFixed(1)} tok/s`:'未提供流式计时'}</dd></div><div><dt>未缓存输入</dt><dd>{detail.inputTokens===null?'未返回':formatTokens(Math.max(0,detail.inputTokens-(detail.cachedTokens??0)-(detail.cacheWriteTokens??0)))}</dd></div><div><dt>缓存读取／写入</dt><dd>{detail.cachedTokens===null?'未返回':formatTokens(detail.cachedTokens)} / {detail.cacheWriteTokens===null?'未返回':formatTokens(detail.cacheWriteTokens)}</dd></div><div><dt>输出</dt><dd>{detail.outputTokens===null?'未返回':formatTokens(detail.outputTokens)}</dd></div><div><dt>输入消息构成（条数）</dt><dd>{detail.origin==='native'?'本机用量日志未提供':`系统 ${detail.inputs.system} · 用户 ${detail.inputs.user} · 助手 ${detail.inputs.assistant} · 工具 ${detail.inputs.tool}`}</dd></div></dl>
    {detail.origin==='native'&&<p className="tfHint">来自本机用量日志。此记录未包含工具过程、请求内容和错误详情。</p>}
    {detail.tools.length>0&&<section><h4>模型发出的工具调用</h4>{detail.tools.map(tool=><details key={tool.id} className="tfTraceTool"><summary>{tool.name||'未提供名称'} · {tool.status==='pending'?'等待客户端返回':tool.status==='error'?'工具返回错误':'已返回'}</summary>{tool.result!==undefined?<><pre>{tool.result}</pre>{tool.truncated&&<small>结果过长，仅保存前 16 KB。</small>}</>:<p>网关尚未收到此工具的返回结果。</p>}</details>)}</section>}
    {detail.results.length>0&&<section><h4>此次请求带回的工具结果</h4>{detail.results.map(tool=><details key={tool.id} className="tfTraceTool"><summary>{tool.name||'工具结果（名称未提供）'} · {tool.status==='error'?'返回错误':'已返回'}</summary><pre>{tool.result}</pre>{tool.truncated&&<small>结果过长，仅保存前 16 KB。</small>}</details>)}</section>}
   </div>}
    </aside>}
   </div>
  </>}
  {loaded&&!rows.length&&<p className="tfHint">{includeNative&&scanningNative?'正在索引本机调用记录…':includeNative?'暂无此来源的记录；官方直连记录会从本机日志自动索引。':'还没有调用轨迹。通过 TokenFlow 发送消息后，会记录模型请求和工具返回结果。'}</p>}
  {rows.length>0&&!shown.length&&<p className="tfHint">没有匹配的轨迹。</p>}
  <p className="tfHint">展示最近 100 条，轨迹在本机保留最多 30 天／1,000 条。请求链按工具结果或响应关联；不保存用户消息、助手正文或推理内容，工具执行耗时由客户端提供前暂不统计。</p>

 </section>;
}
