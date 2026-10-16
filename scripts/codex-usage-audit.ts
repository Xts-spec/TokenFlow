/** Read-only Codex metadata replay. Never prints messages, paths, IDs, accounts or credentials. */
import {createReadStream} from 'node:fs';
import {readdir,lstat,readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {LocalUsageParser,mergeLocalUsageRows,nativeIdentity,type LocalUsageRow} from '../packages/core/src/local-usage.js';
import {enrichAccountRows,readAccountEvidence} from '../packages/core/src/usage-attribution.js';
import {enrichNativeLoginRows,readNativeLoginIntervals} from '../packages/core/src/native-usage-logins.js';
import {codexRouteEvidence,routeChannel,gatewayResponseEvidence} from '../packages/core/src/local-usage-evidence.js';
import {dayOf} from '../packages/core/src/usage-ledger.js';
const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
const day=arg('--day'),rootArg=arg('--data-root');
if(!args.includes('--check')||!day||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!rootArg)throw Error('Usage: tsx scripts/codex-usage-audit.ts --check --day YYYY-MM-DD --data-root PATH [--codex-home PATH]');
const root=resolve(rootArg),home=resolve(arg('--codex-home')??join(homedir(),'.codex'));
const evidence=await readAccountEvidence(root),intervals=await readNativeLoginIntervals(root),gateway=await gatewayResponseEvidence(root);
// Read the configured default gateway port only as route metadata; never read credential/config contents.
const routes=await codexRouteEvidence(home,[8317]);
const proof={matchesResponse:gateway.matches,channelFor:(thread:string,time:string)=>routeChannel(routes,thread,time)};
async function* files(dir:string):AsyncGenerator<string>{
 let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch{return;}
 for(const entry of entries){const p=join(dir,entry.name);if(entry.isSymbolicLink())continue;if(entry.isDirectory())yield* files(p);else if(entry.isFile()&&entry.name.endsWith('.jsonl'))yield p;}
}
const before:LocalUsageRow[]=[],after:LocalUsageRow[]=[];
const responses=new Map<string,{time:string;input:number;cached:number;output:number;thread:string;origin:string}>();
let filesRead=0,unreadable=0,changed=0,duplicateOccurrences=0,counterConflicts=0,threadMismatches=0;
const occurrences=new Map<string,number>();
for(const dir of [join(home,'sessions'),join(home,'archived_sessions')])for await(const path of files(dir)){
 try{
  const stamp=await lstat(path);if(stamp.isSymbolicLink()||stamp.size>256*1024*1024){unreadable++;continue;}
  const old=new LocalUsageParser('codex',nativeIdentity('file',path),proof),fixed=new LocalUsageParser('codex',nativeIdentity('file',path),proof);
  const input=createReadStream(path),lines=createInterface({input,crlfDelay:Infinity});let header='',origin='unknown';
  try{for await(const line of lines){
   if(line.length>8*1024*1024)continue;
   let r:any;try{r=JSON.parse(line);}catch{continue;}
   if(!['session_meta','turn_context','token_usage_record','event_msg'].includes(r.type))continue;
   const p=r.payload??{};
   if(r.type==='event_msg'&&p.type!=='token_count')continue;
   if(r.type==='session_meta'){header=p.id??'';origin=typeof p.source==='string'?p.source:p.source?.subagent?'subagent':'unknown';}
   // Explicit metadata allowlist: do not copy prompts, messages, tools, arguments or auth secrets.
   const payload=r.type==='session_meta'?{id:p.id,model_provider:p.model_provider,creator_account_id:p.creator_account_id,billing_account_id:p.billing_account_id,account_id:p.account_id,auth_mode:p.auth_mode}:r.type==='turn_context'?{model:p.model,model_provider:p.model_provider,auth_mode:p.auth_mode}:r.type==='token_usage_record'?{response_id:p.response_id,thread_id:p.thread_id,usage:p.usage}: {type:p.type,info:p.info};
   const record={type:r.type,timestamp:r.timestamp,ordinal:r.ordinal,payload};fixed.accept(record);old.accept(r.type==='token_usage_record'?{...record,payload:{...payload,thread_id:undefined}}:record);
   if(r.type==='token_usage_record'&&typeof p.response_id==='string'&&p.usage){
    const u=p.usage,key=nativeIdentity('response',p.response_id),v={time:r.timestamp,input:u.input_tokens??0,cached:u.cached_input_tokens??0,output:u.output_tokens??0,thread:p.thread_id??header,origin};
    const prev=responses.get(key);occurrences.set(dayOf(r.timestamp),(occurrences.get(dayOf(r.timestamp))??0)+1);
    if(dayOf(r.timestamp)===day){if(prev)duplicateOccurrences++;if(p.thread_id&&p.thread_id!==header)threadMismatches++;if(prev&&(prev.input!==v.input||prev.output!==v.output||prev.cached!==v.cached))counterConflicts++;}
    if(!prev||v.input+v.output>=prev.input+prev.output)responses.set(key,v);
   }
  }}finally{lines.close();input.destroy();}
  const end=await lstat(path);if(stamp.size!==end.size||stamp.mtimeMs!==end.mtimeMs)changed++;
  before.push(...old.rows());after.push(...fixed.rows());filesRead++;
 }catch{unreadable++;}
}
const enriched=(rows:LocalUsageRow[])=>enrichAccountRows(enrichNativeLoginRows(rows,intervals),evidence);
const sum=(rows:LocalUsageRow[])=>rows.reduce((n,r)=>n+r.inputTokens+r.outputTokens,0);
function summary(rows:LocalUsageRow[]){const dayRows=mergeLocalUsageRows(enriched(rows)).filter(r=>r.day===day);return {totalTokens:sum(dayRows),inputTokens:dayRows.reduce((n,r)=>n+r.inputTokens,0),cachedIncludedInInput:dayRows.reduce((n,r)=>n+r.cachedTokens,0),outputTokens:dayRows.reduce((n,r)=>n+r.outputTokens,0),requests:dayRows.reduce((n,r)=>n+r.requests,0),assignedTokens:sum(dayRows.filter(r=>!!r.nativeAccountId)),unassignedTokens:sum(dayRows.filter(r=>!r.nativeAccountId))};}
const prior=enriched(before),assignedBefore=new Set(prior.filter(r=>r.nativeAccountId).map(r=>r.sampleId));
const old=summary(before),fixed=summary(after),recovered=enriched(after).filter(r=>r.day===day&&r.nativeAccountEvidence==='otel'&&!assignedBefore.has(r.sampleId));
const raw=[...responses.values()].filter(r=>dayOf(r.time)===day),utc=[...responses.values()].filter(r=>new Date(r.time).toISOString().slice(0,10)===day);
const childRows=after.filter(r=>r.day===day&&r.nativeModelUnconfirmed);
const missing=enriched(after).filter(r=>r.day===day&&!r.nativeAccountId);let noThreadEvidence=0,noExactCompletion=0,outsideLoginObservation=0;
for(const r of missing){const matching=evidence.filter(e=>e.thread===r.nativeThreadId);if(!matching.length)noThreadEvidence++;else noExactCompletion++;const t=Date.parse(r.last);if(!intervals.some(i=>i.provider==='codex'&&i.from<=t&&i.to>=t&&i.to>i.from))outsideLoginObservation++;}
// No writes: only counters. A changing log is reported, never called an exact frozen snapshot.
console.log(JSON.stringify({day,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,filesRead,unreadable,filesChangedDuringRead:changed,raw:{occurrences:occurrences.get(day)??0,uniqueResponses:raw.length,duplicateOccurrences,counterConflicts,threadMismatches,totalTokens:raw.reduce((n,r)=>n+r.input+r.output,0),utcDayTokens:utc.reduce((n,r)=>n+r.input+r.output,0)},before:old,after:fixed,recovered:{requests:recovered.length,tokens:sum(recovered)},childRequests:{rows:childRows.length,resolved:enriched(childRows).filter(r=>r.nativeAccountEvidence==='otel').length,previousLoginSnapshot:enriched(childRows).filter(r=>r.nativeAccountEvidence==='otel'&&prior.some(p=>p.sampleId===r.sampleId&&p.nativeAccountEvidence==='login-snapshot')).length},unassigned:{rows:missing.length,noThreadEvidence,noExactCompletion,outsideLoginObservation},invariants:{cachedNotAddedTwice:fixed.totalTokens===fixed.inputTokens+fixed.outputTokens,sameTokenTotalAfterAttribution:old.totalTokens===fixed.totalTokens}},null,2));
