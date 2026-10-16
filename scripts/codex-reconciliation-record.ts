/** Read-only Codex reconciliation journal. Never copies prompts, credentials, raw IDs, emails or paths. */
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {lstat,mkdir,open,readdir,readFile,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';
import {LocalUsageParser,nativeIdentity,recentLocalUsageRows,type LocalUsageRow} from '../packages/core/src/local-usage.js';
import {readAccountEvidence,enrichAccountRows} from '../packages/core/src/usage-attribution.js';
import {readNativeLoginIntervals,enrichNativeLoginRows} from '../packages/core/src/native-usage-logins.js';
import {codexRouteEvidence,routeChannel,gatewayResponseEvidence} from '../packages/core/src/local-usage-evidence.js';
import {readOfficialUsage,safeOfficialUsage} from './codex-official-usage-check.js';

const OWNER='tokenflow-codex-reconciliation-v1',MAX_FILE=256*1024*1024;
const hash=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:null;
const digest=(v:unknown)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const count=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
const model=(v:unknown)=>typeof v==='string'&&/^(?:gpt-|codex-|o[0-9])[a-zA-Z0-9._:+-]{0,110}$/.test(v)?v:'unconfirmed';
const iso=(v:number)=>new Date(v).toISOString();
export const dateInZone=(value:string|number,zone:string)=>new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));
const safeTime=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?iso(Date.parse(v)):null;
const errCode=(e:unknown)=>(e as NodeJS.ErrnoException)?.code;
export type RecorderOptions={output:string;codexHome:string;dataRoot:string;since?:string;timezone?:string;intervalMs?:number;now?:number};
type Usage={input:number|null;cachedInput:number|null;cacheWriteInput:number|null;output:number|null;reasoningOutput:number|null;total:number|null};
type RawSample={responseHash:string;threadHash:string|null;timestamp:string;usage:Usage;source:'cli'|'vscode'|'exec'|'app-server'|'subagent'|'embedded-child'|'unknown';threadId:string;duplicateCounterConflict?:boolean};
type SessionMetadata={threadId:string;source:RawSample['source'];threadSource:'user'|'subagent'|'unknown';originator:'codex_work_desktop'|'codex_cli_rs'|'codex_cli'|'codex_vscode'|'codex_sdk'|'unknown';creatorHash:string|null};
type FileSnapshot={stamp:string;raw:RawSample[];rows:LocalUsageRow[];legacyRecords:number;metadata:SessionMetadata[]};
type State={owner:typeof OWNER;version:1;since:string;timezone:string;createdAt:string};
const allowSource=(v:any):RawSample['source']=>v?.subagent?'subagent':(['cli','vscode','exec','app-server','subagent'].includes(v)?v:'unknown');
const fingerprint=(record:any)=>digest(record);

async function regular(path:string,max=MAX_FILE){const st=await lstat(path);if(!st.isFile()||st.isSymbolicLink()||st.size>max)throw Error('Unsafe or oversized file');return st;}
async function safeDirectory(path:string){
 const parent=dirname(path);if(parent!==path)await safeDirectory(parent);
 try{const st=await lstat(path);if(st.isSymbolicLink()||!st.isDirectory())throw Error('Output requires real directories');}
 catch(e){if(errCode(e)!=='ENOENT')throw e;await mkdir(path,{mode:0o700});}
}
async function privateOpen(path:string,flags:number){
 const file=await open(path,flags|constants.O_NOFOLLOW,0o600);try{const st=await file.stat();if(!st.isFile())throw Error('Expected regular journal file');await file.chmod(0o600);return file;}catch(e){await file.close();throw e;}
}
async function presence(path:string){try{const st=await regular(path);return {status:'available' as const,updatedAt:iso(st.mtimeMs)};}catch(e){return {status:errCode(e)==='ENOENT'?'missing' as const:'unavailable' as const};}}

/** The fsynced append-only journal is also the durable checkpoint; replay restores latest revisions. */
export class CodexReconciliationRecorder{
 readonly state:State;readonly runId=randomUUID();
 private files=new Map<string,FileSnapshot>();private latest=new Map<string,{revision:number;fingerprint:string;record:any}>();
 private journal!:Awaited<ReturnType<typeof open>>;private lock!:Awaited<ReturnType<typeof open>>;private lastSnapshot?:number;private closed=false;
 private constructor(readonly options:Required<Omit<RecorderOptions,'since'>>&{since?:string},state:State){this.state=state;}
 static async open(options:RecorderOptions){
  const now=options.now??Date.now(),timezone=options.timezone??'Asia/Shanghai',output=resolve(options.output);dateInZone(now,timezone);
  if(options.since&&!safeTime(options.since))throw Error('Invalid start timestamp');
  await safeDirectory(output);
  const config=join(output,'monitor.json');let state:State;
  try{await regular(config,4096);state=JSON.parse(await readFile(config,'utf8'));if(state.owner!==OWNER||state.version!==1||!safeTime(state.since)||!safeTime(state.createdAt)||typeof state.timezone!=='string')throw Error('Not a reconciliation directory');dateInZone(now,state.timezone);if(options.since&&iso(Date.parse(options.since))!==state.since||options.timezone&&options.timezone!==state.timezone)throw Error('Existing monitoring window differs; choose another output directory');}
  catch(e){if(errCode(e)!=='ENOENT')throw e;if((await readdir(output)).length)throw Error('Output directory is not empty');state={owner:OWNER,version:1,since:options.since?iso(Date.parse(options.since)):iso(now),timezone,createdAt:iso(now)};const file=await privateOpen(config,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);try{await file.writeFile(JSON.stringify(state)+'\n');await file.sync();}finally{await file.close();}}
  const result=new CodexReconciliationRecorder({output,codexHome:resolve(options.codexHome),dataRoot:resolve(options.dataRoot),timezone:state.timezone,intervalMs:options.intervalMs??60000,now,since:options.since},state);
  await result.acquireLock();
  try{
   const path=join(output,'events.jsonl');let text='';try{await regular(path);text=await readFile(path,'utf8');}catch(e){if(errCode(e)!=='ENOENT')throw e;}
   let invalid=0;
   for(const line of text.split('\n')){if(!line)continue;try{const event=JSON.parse(line);if(event.type==='usage'&&hash(event.responseHash)&&count(event.revision)&&event.record){result.latest.set(event.responseHash,{revision:event.revision,fingerprint:fingerprint(event.record),record:event.record});}if(event.type==='snapshot'&&safeTime(event.at))result.lastSnapshot=Date.parse(event.at);}catch{invalid++;}}
   result.journal=await privateOpen(path,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY);
   if(text&&!text.endsWith('\n'))await result.journal.writeFile('\n');
   await result.append({type:'run-start',at:iso(now),runId:result.runId,monitorSince:state.since,timezone:state.timezone,intervalMs:result.options.intervalMs,resumed:result.latest.size>0,invalidJournalLines:invalid});
   return result;
  }catch(e){await result.close(now,'open-failed');throw e;}
 }
 private async acquireLock(){
  const path=join(this.options.output,'recorder.lock');
  try{this.lock=await privateOpen(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);}
  catch(e){if(errCode(e)!=='EEXIST')throw e;await regular(path,4096);const saved=JSON.parse(await readFile(path,'utf8'));if(saved.owner!==OWNER||!Number.isSafeInteger(saved.pid)||saved.pid<1)throw Error('Invalid recorder lock');let alive=true;try{process.kill(saved.pid,0);}catch(e){if(errCode(e)==='ESRCH')alive=false;}if(alive)throw Error('Recorder already running');await unlink(path);this.lock=await privateOpen(path,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY);}
  await this.lock.writeFile(JSON.stringify({owner:OWNER,pid:process.pid,runId:this.runId}));await this.lock.sync();
 }
 private async append(event:unknown){await this.journal.writeFile(JSON.stringify(event)+'\n');await this.journal.sync();}
 private async readUsageFile(path:string,stamp:string):Promise<FileSnapshot>{
  const parser=new LocalUsageParser('codex',nativeIdentity('file',path)),raw:RawSample[]=[],metadata:SessionMetadata[]=[];let thread='',source:RawSample['source']='unknown',legacyRecords=0;
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW),input=handle.createReadStream({autoClose:false}),lines=createInterface({input,crlfDelay:Infinity});
  try{for await(const line of lines){if(line.length>8*1024*1024)continue;let r:any;try{r=JSON.parse(line);}catch{continue;}const p=r?.payload??{};
   if(r.type==='session_meta'){thread=typeof p.id==='string'?p.id:'';source=allowSource(p.source);metadata.push({threadId:thread,source,threadSource:['user','subagent'].includes(p.thread_source)?p.thread_source:'unknown',originator:['codex_work_desktop','codex_cli_rs','codex_cli','codex_vscode','codex_sdk'].includes(p.originator)?p.originator:'unknown',creatorHash:typeof p.creator_account_id==='string'?nativeIdentity('codex',p.creator_account_id):null});parser.accept({type:r.type,payload:{id:thread,model_provider:p.model_provider,account_id:p.account_id,billing_account_id:p.billing_account_id,creator_account_id:p.creator_account_id,auth_mode:p.auth_mode}});}
   else if(r.type==='turn_context')parser.accept({type:r.type,payload:{model:p.model,model_provider:p.model_provider,auth_mode:p.auth_mode}});
   else if(r.type==='event_msg'&&p.type==='token_count'&&safeTime(r.timestamp)&&Date.parse(r.timestamp)>=Date.parse(this.state.since))legacyRecords++;
   else if(r.type==='token_usage_record'){
    const timestamp=safeTime(r.timestamp);if(!timestamp||Date.parse(timestamp)<Date.parse(this.state.since)||typeof p.response_id!=='string'||!p.response_id||!p.usage)continue;
    const u=p.usage,requestThread=typeof p.thread_id==='string'&&p.thread_id?p.thread_id:thread;
    const usage:Usage={input:count(u.input_tokens),cachedInput:count(u.cached_input_tokens),cacheWriteInput:count(u.cache_write_input_tokens),output:count(u.output_tokens),reasoningOutput:count(u.reasoning_output_tokens),total:count(u.total_tokens)};
    raw.push({responseHash:nativeIdentity('response',p.response_id),threadHash:requestThread?nativeIdentity('thread',requestThread):null,timestamp,usage,threadId:requestThread,source:requestThread&&thread&&requestThread!==thread?'embedded-child':source});
    parser.accept({type:r.type,timestamp,payload:{response_id:p.response_id,thread_id:requestThread,usage:{input_tokens:usage.input,cached_input_tokens:usage.cachedInput,cache_write_input_tokens:usage.cacheWriteInput,output_tokens:usage.output,reasoning_output_tokens:usage.reasoningOutput,account_id:u.account_id}}});
   }
  }}finally{lines.close();input.destroy();await handle.close();}
  return {stamp,raw,rows:parser.rows(),legacyRecords,metadata};
 }
 async scan(now=Date.now()){
  if(this.closed)throw Error('Recorder closed');
  const statuses:Record<string,string>={},discovered=new Set<string>();let unreadable=0,changedDuringRead=0,skippedOld=0;
  const walk=async(dir:string)=>{for(const e of await readdir(dir,{withFileTypes:true})){if(e.isSymbolicLink())continue;const path=join(dir,e.name);if(e.isDirectory())await walk(path);else if(e.isFile()&&e.name.endsWith('.jsonl')){discovered.add(path);try{const st=await regular(path);if(st.mtimeMs<Date.parse(this.state.since)&&!this.files.has(path)){skippedOld++;continue;}const stamp=`${st.dev}:${st.ino}:${st.size}:${st.mtimeMs}`;if(this.files.get(path)?.stamp===stamp)continue;const value=await this.readUsageFile(path,stamp),end=await regular(path);if(end.size!==st.size||end.mtimeMs!==st.mtimeMs){changedDuringRead++;value.stamp='retry';}this.files.set(path,value);}catch{unreadable++;}}}};
  for(const kind of ['sessions','archived_sessions']){try{const path=join(this.options.codexHome,kind),st=await lstat(path);if(!st.isDirectory()||st.isSymbolicLink())throw Error('Unsafe source directory');await walk(path);statuses[kind]='available';}catch(e){statuses[kind]=errCode(e)==='ENOENT'?'missing':'unavailable';}}
  // Retain previously seen usage when files rotate/disappear; journal revisions never remove consumption.
  const evidenceStatus=await presence(join(this.options.dataRoot,'usage-account-evidence.json')),loginStatus=await presence(join(this.options.dataRoot,'native-usage-logins.json'));
  const [accountEvidence,intervals,routes,gateway]=await Promise.all([readAccountEvidence(this.options.dataRoot),readNativeLoginIntervals(this.options.dataRoot),codexRouteEvidence(this.options.codexHome,[8317]),gatewayResponseEvidence(this.options.dataRoot)]);
  const evidenceByThread=new Map<string,typeof accountEvidence>();for(const entry of accountEvidence){const values=evidenceByThread.get(entry.thread)??[];values.push(entry);evidenceByThread.set(entry.thread,values);}
  const all=[...this.files.values()],rows=recentLocalUsageRows(enrichAccountRows(enrichNativeLoginRows(all.flatMap(f=>f.rows),intervals),accountEvidence),Number.MAX_SAFE_INTEGER),byResponse=new Map(rows.map(r=>[r.responseHash,r]));
  const ownMetadata=new Map<string,SessionMetadata>();for(const file of all)for(const meta of file.metadata)if(meta.threadId)ownMetadata.set(meta.threadId,meta);
  const variants=new Map<string,Map<string,Usage>>();const unique=new Map<string,RawSample>();for(const item of all.flatMap(f=>f.raw)){const versions=variants.get(item.responseHash)??new Map<string,Usage>();versions.set(digest(item.usage),item.usage);variants.set(item.responseHash,versions);const old=unique.get(item.responseHash);if(!old){unique.set(item.responseHash,item);continue;}const mismatch=digest(old.usage)!==digest(item.usage),best=(item.usage.total??(item.usage.input??0)+(item.usage.output??0))>=(old.usage.total??(old.usage.input??0)+(old.usage.output??0))?item:old;unique.set(item.responseHash,{...best,duplicateCounterConflict:old.duplicateCounterConflict||item.duplicateCounterConflict||mismatch});}
  let added=0,revised=0;
  for(const item of unique.values()){
   const row=byResponse.get(item.responseHash),route=routeChannel(routes,item.threadId,item.timestamp),gatewayMatch=gateway.hashes.has(item.responseHash),u=item.usage,metadata=ownMetadata.get(item.threadId);
   const record={accountEvidenceConflicts:[] as {accountHash:string|null;emailHash:string|null;organizationHash:string|null;evidence:string}[],timestamp:item.timestamp,dayLocal:dateInZone(item.timestamp,this.state.timezone),dayUtc:item.timestamp.slice(0,10),timezone:this.state.timezone,responseHash:item.responseHash,threadHash:item.threadHash,sessionSource:metadata?.source??'unknown',threadSource:metadata?.threadSource??'unknown',originator:metadata?.originator??'unknown',recordLocation:item.source==='embedded-child'?'embedded-child':'own-thread-or-unknown',creatorAccountHash:metadata?.creatorHash??null,model:model(row?.model),modelConfirmed:!!row&&!row.nativeModelUnconfirmed&&model(row.model)!=='unconfirmed',channel:route==='gateway'?'gateway':route!=='unknown'?route:row?.channel??'unknown',gatewayResponseMatch:gatewayMatch,usage:u,totalComputed:u.input!==null&&u.output!==null?u.input+u.output:null,totalMatchesComponents:u.total!==null&&u.input!==null&&u.output!==null?u.total===u.input+u.output:null,duplicateCounterConflict:!!item.duplicateCounterConflict,usageCounterVariants:variants.get(item.responseHash)!.size>1?[...variants.get(item.responseHash)!.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>v):[],account:{accountHash:hash(row?.nativeAccountId),emailHash:hash(row?.nativeEmailHash),organizationHash:hash(row?.nativeOrganizationId),evidence:row?.nativeAccountEvidence??(row?.nativeAccountId?'request-metadata':'unknown')}};
   const previous=this.latest.get(item.responseHash);
   // Request-level identity outlives rotating OTEL files and always outranks a coexisting login.
   const oldRecord=previous?.record,sameResponse=oldRecord?.threadHash===record.threadHash&&digest(oldRecord?.usage)===digest(record.usage);
   const strong=(p:any)=>p?.accountHash&&['otel','request-metadata','billing'].includes(p.evidence);
   const incomingProofs=(evidenceByThread.get(record.threadHash??'')??[]).filter(e=>Math.abs(e.time-Date.parse(item.timestamp))<=5000&&e.input===u.input&&e.read===(u.cachedInput??0)&&e.write===(u.cacheWriteInput??0)&&e.output===u.output&&(!record.modelConfirmed||e.model===record.model)).map(e=>({accountHash:e.account,emailHash:e.email??null,organizationHash:null,evidence:'otel'}));
   const priorProofs=sameResponse?[...(oldRecord.accountEvidenceConflicts??[]),...(strong(oldRecord.account)?[oldRecord.account]:[])]:[];
   const proofs=[...new Map([...priorProofs,...(strong(record.account)?[record.account]:[]),...incomingProofs].map(p=>[digest(p),p])).entries()].sort(([a],[b])=>a.localeCompare(b)).map(([,p])=>p);
   const conflicting=proofs.some((a,i)=>proofs.slice(i+1).some(b=>a.accountHash!==b.accountHash||a.emailHash&&b.emailHash&&a.emailHash!==b.emailHash||a.organizationHash&&b.organizationHash&&a.organizationHash!==b.organizationHash));
   if(conflicting||record.account.evidence==='conflict'||sameResponse&&oldRecord.account.evidence==='conflict'){
    record.account={accountHash:null,emailHash:null,organizationHash:null,evidence:'conflict'};record.accountEvidenceConflicts=proofs;
   }else if(sameResponse&&(record.account.evidence==='unknown'||record.account.evidence==='login-snapshot')&&oldRecord.account.accountHash&&(strong(oldRecord.account)||record.account.evidence==='unknown')){
    record.account=oldRecord.account;if(!record.modelConfirmed&&oldRecord.modelConfirmed){record.model=oldRecord.model;record.modelConfirmed=true;}if(record.channel==='unknown')record.channel=oldRecord.channel;
   }
   const fp=fingerprint(record);if(previous?.fingerprint===fp)continue;
   const revision=(previous?.revision??0)+1;await this.append({type:'usage',at:iso(now),runId:this.runId,responseHash:item.responseHash,revision,replacesRevision:previous?.revision??null,record});this.latest.set(item.responseHash,{revision,fingerprint:fp,record});if(previous)revised++;else added++;
  }
  const latestLogin=intervals.filter(v=>v.provider==='codex').sort((a,b)=>b.to-a.to)[0],observed=latestLogin&&now-latestLogin.to<=15000&&now>=latestLogin.to;
  const snapshot={type:'snapshot',at:iso(now),runId:this.runId,added,revised,uniqueResponses:this.latest.size,sources:statuses,filesSeen:discovered.size,filesCached:this.files.size,skippedBeforeWindow:skippedOld,unreadable,changedDuringRead,legacyTokenCountEventsWithinWindow:all.reduce((n,v)=>n+v.legacyRecords,0),legacyOnlyFilesWithinWindow:all.filter(v=>v.legacyRecords>0&&!v.raw.length).length,accountEvidence:evidenceStatus,loginEvidence:loginStatus,currentLogin:observed?{status:'fresh-observation',accountHash:hash(latestLogin.account),emailHash:hash(latestLogin.email),organizationHash:hash(latestLogin.organization),observedAt:iso(latestLogin.to)}:{status:'unavailable-or-stale'},gapSincePreviousSnapshotMs:this.lastSnapshot===undefined?null:Math.max(0,now-this.lastSnapshot),collectionGap:this.lastSnapshot!==undefined&&now-this.lastSnapshot>this.options.intervalMs*2};
  await this.append(snapshot);this.lastSnapshot=now;return snapshot;
 }
 async officialSnapshot(binary:string,queryStartedAt=Date.now(),clock:()=>number=Date.now){
  try{
   const before=(await readNativeLoginIntervals(this.options.dataRoot)).filter(v=>v.provider==='codex').sort((a,b)=>b.to-a.to)[0];
   const beforeFresh=before&&queryStartedAt>=before.to&&queryStartedAt-before.to<=15000;
   const result=await readOfficialUsage(resolve(binary)),collectedAt=clock(),emailHash=result.email?nativeIdentity('email',result.email.trim().toLowerCase()):null;
   const intervals=await readNativeLoginIntervals(this.options.dataRoot),latest=intervals.filter(v=>v.provider==='codex').sort((a,b)=>b.to-a.to)[0],fresh=latest&&collectedAt>=latest.to&&collectedAt-latest.to<=15000;
   const dates=Array.from({length:7},(_,i)=>dateInZone(collectedAt-i*86400000,this.state.timezone));
   await this.append({type:'official-snapshot',at:iso(collectedAt),queryStartedAt:iso(queryStartedAt),runId:this.runId,status:'available',method:'account/usage/read',emailHash,emailMatchesCurrentObservedLogin:fresh&&latest.email&&emailHash?latest.email===emailHash:null,emailMatchesObservedLoginAtQueryStart:beforeFresh&&before.email&&emailHash?before.email===emailHash:null,observedAccountChangedDuringQuery:beforeFresh&&fresh?before.account!==latest.account||before.email!==latest.email||before.organization!==latest.organization:null,workspaceScope:'not-exposed-by-this-response',officialTimezone:'undocumented',buckets:dates.map(day=>safeOfficialUsage(result.usage,day))});return true;
  }catch{await this.append({type:'official-snapshot',at:iso(clock()),queryStartedAt:iso(queryStartedAt),runId:this.runId,status:'unavailable',method:'account/usage/read'});return false;}
 }
 async close(now=Date.now(),reason='stopped'){
  if(this.closed)return;this.closed=true;
  try{if(this.journal){await this.append({type:'run-stop',at:iso(now),runId:this.runId,reason:['stopped','signal','once','open-failed','scan-failed'].includes(reason)?reason:'stopped'});await this.journal.close();}}
  finally{if(this.lock){await this.lock.close();const path=join(this.options.output,'recorder.lock');try{await regular(path,4096);if(JSON.parse(await readFile(path,'utf8')).runId===this.runId)await unlink(path);}catch{/* A replaced lock is not ours. */}}}
 }
}

async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 if(args.includes('--help')){console.log('Usage: node --import tsx scripts/codex-reconciliation-record.ts --data-root PATH (--watch | --once) [--output PATH] [--codex-home PATH] [--since ISO_TIMESTAMP] [--timezone Asia/Shanghai] [--official-binary PATH]\nAppends sanitized request revisions to an ignored private project journal. Default window starts now; restarting the same output resumes it. Official snapshots are optional every 15 minutes. Stop with Ctrl+C.');return;}
 const root=arg('--data-root');if(!root||args.includes('--watch')===args.includes('--once'))throw Error('Provide data root and exactly one of --watch or --once');
 const recorder=await CodexReconciliationRecorder.open({output:arg('--output')??resolve('artifacts/codex-reconciliation'),codexHome:arg('--codex-home')??join(homedir(),'.codex'),dataRoot:root,since:arg('--since'),timezone:arg('--timezone')});
 let stop=false,wake:undefined|(()=>void),officialAt=0;const signal=()=>{stop=true;wake?.();};process.once('SIGINT',signal);process.once('SIGTERM',signal);
 try{do{const snapshot=await recorder.scan();console.log(JSON.stringify({status:'recording',at:snapshot.at,added:snapshot.added,revised:snapshot.revised,uniqueResponses:snapshot.uniqueResponses,currentLogin:snapshot.currentLogin.status}));const binary=arg('--official-binary');if(binary&&Date.now()-officialAt>=15*60000){await recorder.officialSnapshot(binary);officialAt=Date.now();}if(args.includes('--once')||stop)break;await new Promise<void>(done=>{const timer=setTimeout(()=>{wake=undefined;done();},60000);wake=()=>{clearTimeout(timer);wake=undefined;done();};});}while(!stop);}
 finally{await recorder.close(Date.now(),stop?'signal':args.includes('--once')?'once':'scan-failed');process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error(JSON.stringify({status:'unavailable',note:'Recorder could not continue; existing source files and journal are preserved. Check arguments, output ownership, permissions and whether another recorder is running.'}));process.exitCode=1;});
