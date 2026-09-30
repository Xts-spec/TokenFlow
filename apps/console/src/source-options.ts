import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
export function sourceOptions(local:LocalAgentSnapshot){
 const accounts=local.accounts.filter(a=>!a.disabled&&!a.unavailable&&['active','ready','ok'].includes(a.status)&&a.models?.some(id=>local.models.some(m=>m.id===id))).map(account=>{
  const quota=local.quotas[account.id];
  const remaining=quota?.status==='ok'?quota.windows.flatMap(w=>typeof w.usedPercent==='number'&&Number.isFinite(w.usedPercent)?[Math.max(0,Math.min(100,100-w.usedPercent))]:[]):[];
  return {...account,remaining:remaining.length?Math.min(...remaining):null,models:[...new Set(account.models!.filter(id=>local.models.some(m=>m.id===id)))]};
 });
 const sources=(local.apiSources??[]).filter(s=>s.enabled&&s.hasKey&&s.models.length).map(s=>({id:s.id,label:s.name,provider:'api',status:'active',disabled:false,unavailable:false,remaining:null,models:s.models.map(m=>`api-${s.id}/${m}`).filter(id=>local.models.some(m=>m.id===id))}));
 return [...accounts,...sources.filter(s=>s.models.length)].sort((a,b)=>(b.remaining??-1)-(a.remaining??-1)||a.label.localeCompare(b.label));
}
export function sourceLabel(local:LocalAgentSnapshot,id:string){return local.accounts.find(a=>a.id===id)?.label??local.apiSources?.find(s=>s.id===id)?.name;}
