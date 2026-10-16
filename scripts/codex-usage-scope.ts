import {recentLocalUsageRows,type LocalUsageRow} from '../packages/core/src/local-usage.js';

/** Diagnostic only: regroup distinct request samples without changing the production ledger. */
export function codexScopeMatrix(input:LocalUsageRow[],day:string,latest?:{account:string;email?:string},capturedAt=Date.now()){
 const start=Date.parse(`${day}T00:00:00Z`);
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==day)throw Error('Invalid calendar day');
 const samples=recentLocalUsageRows(input.filter(r=>r.target==='codex'&&Date.parse(r.last)<=capturedAt),input.length);
 const sum=(rows:LocalUsageRow[])=>rows.reduce((n,r)=>n+r.inputTokens+r.outputTokens,0);
 return [-12,-11,-10,-9,-8,-7,-6,-5,-4,0,1,8,9,14].map(offsetHours=>{
  const from=start-offsetHours*3600000,to=from+86400000;
  const rows=samples.filter(r=>Date.parse(r.last)>=from&&Date.parse(r.last)<to);
  const current=rows.filter(r=>latest&&r.nativeAccountId===latest.account&&(!r.nativeEmailHash||r.nativeEmailHash===latest.email));
  const currentIds=new Set(current.map(r=>r.sampleId));
  const latestObservedAccountEvidence=Object.fromEntries(['otel','login-snapshot','record'].map(kind=>{const matched=current.filter(r=>(r.nativeAccountEvidence??'record')===kind);return [kind,{requests:matched.reduce((n,r)=>n+r.requests,0),tokens:sum(matched)}];}));
  return {offsetHours,fromUtc:new Date(from).toISOString(),toUtcExclusive:new Date(to).toISOString(),periodComplete:to<=capturedAt,totalTokens:sum(rows),latestObservedAccountTokens:sum(current),latestObservedAccountEvidence,otherAccountTokens:sum(rows.filter(r=>r.nativeAccountId&&!currentIds.has(r.sampleId))),unassignedTokens:sum(rows.filter(r=>!r.nativeAccountId))};
 });
}
