import {useId,useState,useRef,useEffect,type ReactNode} from 'react';
import {createPortal} from 'react-dom';
import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
import { Icon } from './Icons';
import { QuotaDetails } from './QuotaDetails';
import { ProviderIcon } from './ProviderIcon';
import { qualifiedModelLabel } from './model-label';
import { quotaRemaining } from './flow-model';
import {
  chartSpan, compactTokens, dailyTokens, durationText, formatTokens, groupUsage, percentText, rangeLabel, ranges, sourceKey, totalsOf,
  type RangeId, type UsageRow, type UsageTotals,
} from './usage-model';

/** Time window switch shared by every usage summary. */
export function RangeTabs({ range, onChange }: { range: RangeId; onChange: (range: RangeId) => void }) {
  return <div className="tfRange" role="group" aria-label="统计时间范围">
    {ranges.map(item => <button key={item.id} type="button" aria-pressed={range === item.id} onClick={() => onChange(item.id)}>{item.label}</button>)}
  </div>;
}

const share = (value: number, total: number) => total > 0 ? `${(value / total) * 100}%` : '0%';

/** Usage stays out of the way: one line of the headline numbers, details on demand. */
export function UsageFold({title='用量统计',subtitle,rows,range}:{title?:string;subtitle?:string;rows:readonly UsageRow[];range:RangeId}){
 const [open,setOpen]=useState(false);const [position,setPosition]=useState({left:0,top:0});const id=useId();const button=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);const totals=totalsOf(rows);
 useEffect(()=>{if(!open)return;panel.current?.focus();const resized=()=>setOpen(false);window.addEventListener('resize',resized);const close=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!button.current?.contains(event.target as Node))setOpen(false);};const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){setOpen(false);button.current?.focus();}};document.addEventListener('pointerdown',close);document.addEventListener('keydown',escape);return()=>{window.removeEventListener('resize',resized);document.removeEventListener('pointerdown',close);document.removeEventListener('keydown',escape);};},[open]);
 const toggle=()=>{const box=button.current?.getBoundingClientRect();if(box)setPosition({left:Math.max(12,Math.min(box.left,window.innerWidth-372)),top:Math.max(12,Math.min(box.bottom+8,window.innerHeight-360))});setOpen(!open);};
 return <section className={`tfUsageFold${open?' open':''}`} aria-label={title}>
  <button ref={button} type="button" className="tfUsageFoldHead" title={subtitle??title} aria-label={title} aria-expanded={open} aria-controls={id} onClick={toggle}><Icon name="tokens" size={17}/><b>{compactTokens(totals.totalTokens)}</b><span>tok</span><i aria-hidden="true">·</i><span>缓存命中 {percentText(totals.hitRate)}</span></button>
  {open&&createPortal(<div ref={panel} tabIndex={-1} id={id} className="tfUsagePopover" role="dialog" aria-label={title} style={{...position,maxHeight:Math.max(200,window.innerHeight-position.top-12)}}><header><strong>Token 用量</strong><b>{formatTokens(totals.totalTokens)} tok</b><button className="iconButton" aria-label="关闭用量" onClick={()=>setOpen(false)}><Icon name="close" size={14}/></button></header><dl><div><dt>缓存命中</dt><dd>{percentText(totals.hitRate)}</dd></div><div><dt>{totals.unknownCacheTokens?'未缓存／未拆分输入':'未缓存输入'}</dt><dd>{formatTokens(totals.uncachedTokens)} tok</dd></div><div><dt>缓存读取</dt><dd>{formatTokens(totals.cachedTokens)} tok</dd></div>{totals.cacheWriteTokens>0&&<div><dt>缓存写入</dt><dd>{formatTokens(totals.cacheWriteTokens)} tok</dd></div>}<div><dt>输出</dt><dd>{formatTokens(totals.outputTokens)} tok</dd></div><div><dt>请求</dt><dd>{formatTokens(totals.requests)} 次 · {rangeLabel(range)}</dd></div></dl></div>,document.body)}
 </section>;
}

/** Total, cache hit rate and the uncached / cached / output split, the way the official apps report usage. */
export function UsageSummary({ title = 'Token 用量', rows, range, onRange, loaded = true, hint }: { title?: string; rows: readonly UsageRow[]; range: RangeId; onRange: (range: RangeId) => void; loaded?: boolean; hint?: ReactNode }) {
  const totals = totalsOf(rows);
  const parts = totals.totalTokens;
  return <section className="tfUsageSummary" aria-label={title}>
    <header><div><h3>{title}</h3><small>{rangeLabel(range)}</small></div><RangeTabs range={range} onChange={onRange} /></header>
    <div className="tfUsageHero">
      <div className="tfUsageTotal"><strong title={`${formatTokens(totals.totalTokens)} tokens`}>{formatTokens(totals.totalTokens)}</strong><span>tok</span></div>
      <div className="tfUsageHit" title={totals.hitRate === null ? '上游没有返回缓存数据' : `缓存读取 ${formatTokens(totals.cachedTokens)} tokens`}>
        <span>缓存命中</span><strong>{percentText(totals.hitRate)}</strong>
      </div>
    </div>
    <div className="tfUsageBar" role="img" aria-label={`未缓存输入 ${formatTokens(totals.uncachedTokens)}，缓存读取 ${formatTokens(totals.cachedTokens)}，缓存写入 ${formatTokens(totals.cacheWriteTokens)}，输出 ${formatTokens(totals.outputTokens)}`}>
      {parts > 0 && <>
        <i className="uncached" style={{ width: share(totals.uncachedTokens, parts) }} />
        <i className="cached" style={{ width: share(totals.cachedTokens, parts) }} />
        <i className="write" style={{width:share(totals.cacheWriteTokens,parts)}}/><i className="output" style={{ width: share(totals.outputTokens, parts) }} />
      </>}
    </div>
    <dl className="tfUsageTiles">
      <div><dt><i className="uncached" />{totals.unknownCacheTokens?'未缓存／未拆分输入':'未缓存输入'}</dt><dd>{formatTokens(totals.uncachedTokens)}</dd></div>
      <div><dt><i className="cached" />缓存读取</dt><dd>{formatTokens(totals.cachedTokens)}</dd></div>
      {totals.cacheWriteTokens>0&&<div><dt><i className="write"/>缓存写入</dt><dd>{formatTokens(totals.cacheWriteTokens)}</dd></div>}
      <div><dt><i className="output" />输出</dt><dd>{formatTokens(totals.outputTokens)}</dd></div>
      <div><dt>请求</dt><dd>{formatTokens(totals.requests)}{totals.failed > 0 && <small className="bad"> · {formatTokens(totals.failed)} 失败</small>}</dd></div>
      <div><dt>平均耗时</dt><dd>{durationText(totals.avgMs)}</dd></div>
      <div><dt>工具调用／返回</dt><dd>{totals.toolsMeasured?`${formatTokens(totals.toolCalls)} / ${formatTokens(totals.toolResults)}`:'未记录'}</dd></div><div><dt>生成速率（流式）</dt><dd>{totals.tokensPerSecond===null?'—':`${totals.tokensPerSecond.toFixed(1)} tok/s`}</dd></div>
    </dl>
    {totals.reasoningTokens>0&&<p className="tfHint">输出中包含 {formatTokens(totals.reasoningTokens)} 个推理 tokens，已计入输出，不重复累计。</p>}
    {loaded && totals.requests === 0 && <p className="tfHint">这段时间没有可读取的用量记录。</p>}
    {totals.unknownCacheTokens>0&&<p className="tfHint">上游未提供 {formatTokens(totals.unknownCacheTokens)} 个输入 tokens 的缓存拆分，已计入输入总量；缓存命中率只统计已报告缓存的请求。</p>}
    {totals.unmeasured > 0 && <p className="tfHint">有 {formatTokens(totals.unmeasured)} 次成功请求的上游未返回完整用量，实际消耗可能更高。</p>}
    {hint && <p className="tfHint">{hint}</p>}
  </section>;
}

/** Tokens per day; quiet days stay visible as empty slots. */
export function DailyChart({ rows, range }: { rows: readonly UsageRow[]; range: RangeId }) {
  const days = dailyTokens(rows, chartSpan(range, rows));
  if (days.length < 2 || days.every(item => item.tokens === 0)) return null;
  const peak = Math.max(...days.map(item => item.tokens), 1);
  return <figure className="tfDaily">
    <div className="tfDailyBars" role="img" aria-label={`每日 Tokens，最高 ${formatTokens(peak)}`}>
      {days.map(item => <i key={item.day} title={`${item.day} · ${formatTokens(item.tokens)} tokens`} className={item.tokens ? '' : 'quiet'} style={{ height: `${Math.max(item.tokens ? 6 : 2, (item.tokens / peak) * 100)}%` }} />)}
    </div>
    <figcaption><span>{days[0].day.slice(5)}</span><span>每日 Tokens · 峰值 {compactTokens(peak)}</span><span>{days[days.length - 1].day.slice(5)}</span></figcaption>
  </figure>;
}

export type BreakdownItem = { key: string; label: string; sub?: string; icon?: ReactNode; totals: UsageTotals; extra?: ReactNode };
const tokenSeries=[['uncached','输入','uncachedTokens','#2563eb'],['cached','缓存读取','cachedTokens','#2bb59c'],['write','缓存写入','cacheWriteTokens','#9480cc'],['output','输出','outputTokens','#d89b32']] as const;
const tokenParts=(totals:UsageTotals)=>tokenSeries.map(([key,label,field,color])=>({key,label:key==='uncached'?(totals.unknownCacheTokens?'输入／未拆分':'未缓存输入'):label,value:totals[field],color}));
export function TokenLegend(){return <div className="tfTokenLegend" aria-label="Token 图例">{tokenSeries.map(([key,label,,color])=><span key={key}><i style={{background:color}}/>{label}</span>)}</div>;}
/** Rows ranked by tokens, each with a bar scaled to the biggest consumer. */
export function UsageBreakdown({ title, items, empty, limit = 8 }: { title: string; items: BreakdownItem[]; empty: string; limit?: number }) {
  const [all, setAll] = useState(false);
  const peak = Math.max(...items.map(item => item.totals.totalTokens), 1);
  const total=items.reduce((sum,item)=>sum+item.totals.totalTokens,0);
  const shown = all ? items : items.slice(0, limit);
  return <section className="tfBreakdown" aria-label={title}>
    <header><h4>{title}</h4>{items.length > 0 && <small>{items.length} 项</small>}</header>
    {items.length>0&&<TokenLegend/>}
    {!items.length && <p className="tfHint">{empty}</p>}
    <ul>
      {shown.map(item => <li key={item.key}>
        <div className="tfBreakHead">
          {item.icon}
          <span className="tfBreakName"><strong title={item.label}>{item.label}</strong>{item.sub && <small title={item.sub}>{item.sub}</small>}</span>
          <div className="tfBreakValue"><b>{compactTokens(item.totals.totalTokens)} <small>tok</small></b><span>{percentText(total?item.totals.totalTokens/total:null)} 的用量</span></div>
        </div>
        <svg className="tfStackedTokens" viewBox="0 0 1000 20" preserveAspectRatio="none" role="img" aria-label={`${item.label} Token 构成，总量 ${formatTokens(item.totals.totalTokens)}；${tokenParts(item.totals).map(p=>`${p.label} ${formatTokens(p.value)}`).join('，')}`}>
         {[0,250,500,750,1000].map(x=><line key={x} x1={x} x2={x} y1="0" y2="20" stroke="#e3e9f1"/>)}
         {tokenParts(item.totals).map((part,index,parts)=><rect key={part.key} x={parts.slice(0,index).reduce((sum,p)=>sum+p.value,0)/peak*1000} y="2" width={part.value/peak*1000} height="16" fill={part.color}><title>{part.label} {formatTokens(part.value)} tok</title></rect>)}
        </svg>
        <dl className="tfBreakParts">{tokenParts(item.totals).filter(p=>p.key!=='write'||p.value>0).map(part=><div key={part.key}><dt>{part.label}</dt><dd>{formatTokens(part.value)}</dd></div>)}</dl>
        <div className="tfBreakFacts"><span>缓存命中 <b>{percentText(item.totals.hitRate)}</b></span><span>{formatTokens(item.totals.requests)} 次请求</span>{item.totals.failed>0&&<span className="failed">{formatTokens(item.totals.failed)} 次失败</span>}</div>
        {item.extra}
      </li>)}
    </ul>
    {items.length>0&&<div className="tfBreakScale" aria-label="Token 数量刻度"><span>0</span><span>{formatTokens(peak/2)}</span><span>{formatTokens(peak)} tok</span></div>}
    {items.length > limit && <button type="button" className="textButton" onClick={() => setAll(!all)}>{all ? '收起' : `显示全部 ${items.length} 项`}</button>}
  </section>;
}

/** The account or API behind a source id, as shown to the user. */
export function describeSource(local: LocalAgentSnapshot, key: string): { label: string; provider: string; sub: string } {
  const account = local.accounts.find(item => item.id === key);
  if (account) return { label: account.label, provider: account.provider, sub: `${local.providers.find(item => item.id === account.provider)?.label ?? account.provider} · 官方授权` };
  const api = local.apiSources?.find(item => item.id === key);
  if (api) return { label: api.name, provider: 'api', sub: `API Key · ${api.baseURL}` };
  if(key.startsWith('native:')){const [,raw,channel,identity]=key.split(':');const provider=raw==='openai'||raw==='openai-codex'?'codex':raw;const label=local.providers.find(item=>item.id===provider)?.label??(provider==='codex'?'OpenAI':provider);return {label:`${label} · ${channel==='official'?'官方登录':channel==='api'?'API Key':'渠道未确认'}`,provider,sub:identity?`本机历史账号 ${identity.slice(0,8)} · 未关联已保存账号`:'本机历史 · 未记录具体账号或接口'};}
  if (key.startsWith('provider:')) { const id = key.slice(9); const label = local.providers.find(item => item.id === id)?.label ?? id; return { label, provider: id, sub: '账号（未记录具体账号）' }; }
  return { label: '已移除的来源', provider: 'api', sub: '账号或接口已删除' };
}

/** Per account / API: tokens spent through the gateway, with the account's remaining quota beside them. */
export function SourceUsage({ local, rows, title = '按来源账号', empty = '还没有经过网关的请求。', showQuota = true, expandQuota = false }: { local: LocalAgentSnapshot; rows: readonly UsageRow[]; title?: string; empty?: string; showQuota?: boolean;expandQuota?:boolean }) {
  const [open, setOpen] = useState('');
  const items: BreakdownItem[] = groupUsage(rows, sourceKey).map(group => {
    const info = describeSource(local, group.key);
    const quota = showQuota ? local.quotas[group.key] : undefined;
    const remaining = quotaRemaining(quota);
    return {
      key: group.key, label: info.label, sub: info.sub, totals: group.totals,
      icon: <ProviderIcon provider={info.provider} size={20} />,
      extra: quota&&expandQuota?<div className="tfBreakQuota"><QuotaDetails quota={quota} label={info.label} compact/></div>:quota ? <div className="tfBreakQuota">
        <button type="button" className="textButton" aria-expanded={open === group.key} onClick={() => setOpen(open === group.key ? '' : group.key)}>
          {remaining === null ? '额度' : `官方额度剩余 ${Math.round(remaining)}%`}{open === group.key ? ' · 收起' : ' · 详情'}
        </button>
        {open === group.key && <QuotaDetails quota={quota} label={info.label} compact />}
      </div> : undefined,
    };
  });
  return <UsageBreakdown title={title} items={items} empty={empty} />;
}

export function modelManufacturer(model:string,local:LocalAgentSnapshot){
 const id=model.split('/').at(-1)!.toLowerCase();
 if(/^(gpt-|o[134](?:-|$)|chatgpt)/.test(id))return 'codex';
 if(/claude|sonnet|opus|haiku/.test(id))return 'claude';
 if(/deepseek/.test(id))return 'deepseek';
 if(/kimi|moonshot/.test(id))return 'kimi';
 if(/glm/.test(id))return 'zcode';
 if(/grok/.test(id))return 'xai';
 if(/doubao/.test(id))return 'doubao';
 return local.models.find(item=>item.id===model)?.provider??(model.startsWith('api-')?'api':model.split('/')[0]);
}
export function ModelUsage({ local, rows, title = '按模型', empty = '还没有经过网关的请求。' }: { local: LocalAgentSnapshot; rows: readonly UsageRow[]; title?: string; empty?: string }) {
  const items: BreakdownItem[] = groupUsage(rows, row => row.model).map(group => ({ key: group.key, label: qualifiedModelLabel(local, group.key), icon:<ProviderIcon provider={modelManufacturer(group.key,local)} size={22}/>, totals: group.totals }));
  return <UsageBreakdown title={title} items={items} empty={empty} />;
}
