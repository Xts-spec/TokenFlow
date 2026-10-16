import { QuotaRing } from './QuotaRing';
import { Icon } from './Icons';
import type { AccountQuota } from '../../../packages/core/src/quota/types';

const formatAmount = (value: number, unit?: string) => unit === 'USD' ? `$${value.toFixed(2)}` : `${Math.round(value).toLocaleString()}${unit ?? ''}`;
const resetLabel = (iso: string) => {
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return '已重置';
  const minutes = Math.round(ms / 60000);
  const span = minutes < 60 ? `${minutes} 分钟` : minutes < 60 * 48 ? `${Math.round(minutes / 60)} 小时` : `${Math.round(minutes / 1440)} 天`;
  return `${span}后重置（${new Date(iso).toLocaleString()}）`;
};

export function quotaErrorMessage(error='') {
 if(/\b(?:401|403)\b|授权.*(?:失效|过期)|登录.*过期/i.test(error))return '登录状态已失效，请重新授权后刷新额度。';
 if(/\b429\b|请求过于频繁/i.test(error))return '查询太频繁，请稍后刷新额度。';
 if(/\b5\d\d\b|网络|连接|超时|timeout|fetch failed|ECONN|ENOTFOUND/i.test(error))return '网络暂时不稳定，额度更新失败，请稍后刷新。';
 return '暂时无法更新额度，请稍后刷新。';
}

export function QuotaDetails({quota,label,compact=false}:{quota:AccountQuota;label:string;compact?:boolean}) {
 return <span className={`quota quota-${quota.status}${compact?' compactQuota':''}`} aria-label={`${label} 额度`}>
  {quota.status==='error'&&<span className="quotaStatus" role="status"><Icon name="alertCircle" size={16}/><span>{quotaErrorMessage(quota.error)}</span></span>}
  {quota.status==='error'&&quota.lastSuccessfulAt&&quota.windows.length>0&&<span className="quotaStale">上次更新：{new Date(quota.lastSuccessfulAt).toLocaleString()} · 非实时额度</span>}
  {quota.status==='ok'&&!quota.windows.length&&!quota.note&&<span className="hint">额度暂未提供</span>}
  {quota.windows.map(window=><span className="quotaWindow quotaWindowRing" key={window.id}>
   <QuotaRing compact={compact} remaining={window.usedPercent===null?null:100-window.usedPercent} label={window.label}/>
   <span className="quotaWindowDetails"><span className="quotaMeta"><span title={window.label}>{window.label}</span></span>
    <b>{window.usedPercent===null?(window.remaining!==undefined?`余额 ${formatAmount(window.remaining,window.unit)}`:'额度暂未提供'):`已用 ${Math.round(Math.max(0,Math.min(100,window.usedPercent)))}% · 剩余 ${Math.round(Math.max(0,Math.min(100,100-window.usedPercent)))}%`}{window.note?` · ${window.note}`:''}</b>
    <small>{window.used!==undefined&&window.limit!==undefined?`已用 ${formatAmount(window.used,window.unit)} / ${formatAmount(window.limit,window.unit)}`:window.used!==undefined?`已用 ${formatAmount(window.used,window.unit)}`:''}{window.resetsAt?`${window.used!==undefined?' · ':''}${resetLabel(window.resetsAt)}`:''}</small>
   </span>
  </span>)}
  {quota.note&&<span className="hint">{quota.note}</span>}
  <small className="quotaObserved">查询于 {new Date(quota.observedAt).toLocaleTimeString()}</small>
 </span>;
}
