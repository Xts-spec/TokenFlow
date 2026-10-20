import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';
export function sourceOptions(local:LocalAgentSnapshot){
 const accounts=local.accounts.filter(a=>!a.isDuplicate&&!a.disabled&&(!a.unavailable||a.retryable)&&(['active','ready','ok'].includes(a.status)||a.retryable)&&a.models?.some(id=>local.models.some(m=>m.id===id))).map(account=>{
  const quota=local.quotas[account.id];
  const remaining=quota?.status==='ok'?quota.windows.flatMap(w=>typeof w.usedPercent==='number'&&Number.isFinite(w.usedPercent)?[Math.max(0,Math.min(100,100-w.usedPercent))]:[]):[];
  return {...account,remaining:remaining.length?Math.min(...remaining):null,models:[...new Set(account.models!.filter(id=>local.models.some(m=>m.id===id)))]};
 });
 // Saved API models remain selectable while the sidecar catalog is reloading; routing validates again on write/call.
 const sources=(local.apiSources??[]).filter(s=>s.enabled&&s.hasKey&&s.models.length).map(s=>({id:s.id,label:s.name,provider:'api',status:'active',disabled:false,unavailable:false,remaining:null,models:s.models.map(m=>`api-${s.id}/${m}`)}));
 return [...accounts,...sources.filter(s=>s.models.length)].sort((a,b)=>(b.remaining??-1)-(a.remaining??-1)||a.label.localeCompare(b.label));
}
export function sourceLabel(local:LocalAgentSnapshot,id:string){return local.accounts.find(a=>a.id===id)?.label??local.apiSources?.find(s=>s.id===id)?.name;}

export type AvailableSourceModels=readonly {id:string;models:readonly string[]}[];
export function isSourceSelectionAvailable(sources:AvailableSourceModels,selection:{sourceId:string;model:string}|undefined|null){
 return !!selection&&sources.some(source=>source.id===selection.sourceId&&source.models.includes(selection.model));
}

export type SourceSelectionState='available'|'loading'|'unknown'|'unavailable';
/** Absence from a partial or failed catalog is not evidence that a saved choice is invalid. */
export function sourceSelectionState(local:LocalAgentSnapshot,selection:{sourceId:string;model:string},sources:AvailableSourceModels=sourceOptions(local)):SourceSelectionState{
 if(isSourceSelectionAvailable(sources,selection))return 'available';
 if(local.accountsLoading||local.state==='starting')return 'loading';
 if(local.accountError||local.state!=='running')return 'unknown';
 const api=local.apiSources?.find(source=>source.id===selection.sourceId);
 if(api)return !api.enabled||!api.models.some(model=>`api-${api.id}/${model}`===selection.model)?'unavailable':'unknown';
 const account=local.accounts.find(source=>source.id===selection.sourceId);
 if(!account)return 'unavailable';
 if(account.disabled)return 'unavailable';
 if(account.modelError||account.unavailable||!['active','ready','ok'].includes(account.status)||account.isDuplicate)return 'unknown';
 if(!account.models||account.models.includes(selection.model))return 'loading';
 return 'unavailable';
}

export function sourceSelectionNotice(local:LocalAgentSnapshot,selections:readonly {sourceId:string;model:string}[],sources:AvailableSourceModels=sourceOptions(local)){
 const states=selections.map(choice=>sourceSelectionState(local,choice,sources));
 if(states.includes('loading'))return '正在加载账号授权与模型列表，已保留所选模型。';
 if(states.includes('unknown'))return '暂时无法确认部分来源的模型列表，已保留选择，可稍后刷新。';
 return '';
}
