import {lstat,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {cursorConversationHash,cursorGatewayConversations} from './cursor-conversations.js';
import type {CursorUsageEvents} from './cursor-usage.js';
import {nativeIdentity,type LocalUsageRow,type LocalUsageSnapshot,type UsageCoverage} from './local-usage.js';
import {dayOf} from './usage-ledger.js';
import {emailIdentity} from './usage-attribution.js';
import {safePath} from './agent-connections.js';

export type CursorUsageReader={id:string;email?:string;revision:string;read:(start:number,end:number,signal:AbortSignal)=>Promise<CursorUsageEvents>};
const count=z.number().int().nonnegative().safe(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const bill=z.object({sampleId:hash,conversationHash:hash,account:hash,email:hash,time:count.max(8640000000000000),model:z.string().min(1).max(300),input:count,output:count,read:count,write:count}).refine(r=>Number.isSafeInteger(r.input+r.output+r.read+r.write));
type Bill=z.infer<typeof bill>;
const retention=180*86400000;
const note='只累计本机会话与已授权账号官方明细的精确交集；排除 SDK 网关、云端和自动化调用，账单可能延迟。';

/** Network work is asynchronous and cached separately from the local SQLite
 * worker. Only hashes and counters persist; no IDE credential is read or made. */
export class CursorNativeUsage {
 private records=new Map<string,Bill>();private task?:Promise<void>;private closed=false;private controller?:AbortController;
 private checkedAt=0;private fingerprint='';private warning='';private detail='';private skipped=0;private gateway=new Set<string>();
 private dedupAvailable=true;
 private constructor(private root:string,private readers:()=>CursorUsageReader[]){}
 static async open(root:string,readers:()=>CursorUsageReader[]){
  const result=new CursorNativeUsage(root,readers),path=join(root,'cursor-native-usage.json');
  try{await safePath(path);const info=await lstat(path);if(!info.isFile()||info.size>32*1024*1024)throw Error();const value=z.object({version:z.literal(1),bills:z.array(bill).max(100000)}).parse(JSON.parse(await readFile(path,'utf8')));for(const row of value.bills)if(row.time>=Date.now()-retention)result.records.set(row.sampleId,row);}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')result.warning='Cursor 直连缓存暂不可读，将根据本机会话重新核对。';}
  try{result.gateway=await cursorGatewayConversations(root);}catch{result.dedupAvailable=false;result.warning='Cursor 网关排重记录暂不可读，直连用量暂停展示，避免重复累计。';}
  return result;
 }
 private localCoverage(local:LocalUsageSnapshot){return local.coverage.find(c=>c.target==='cursor');}
 snapshot(local:LocalUsageSnapshot){
  const coverage=this.localCoverage(local),sources=this.readers();
  const fingerprint=JSON.stringify([(local.cursorConversations??[]).map(c=>c.hash).sort(),sources.map(s=>s.revision).sort()]);
  if(!this.closed&&!this.task&&coverage?.status==='ready'&&(fingerprint!==this.fingerprint||Date.now()-this.checkedAt>=60000))void this.refresh(local);
  const rows=this.rows();let state:UsageCoverage={target:'cursor',files:coverage?.files??0,indexed:coverage?.indexed??0,skipped:this.skipped+(coverage?.skipped??0),status:this.task?'scanning':coverage?.status??'scanning',note:this.warning||this.detail||coverage?.note||note};
  if(!this.task&&coverage?.status==='ready'&&(!sources.length||this.warning))state={...state,status:rows.length?'ready':'unavailable',note:this.warning||'请先授权并启用 Cursor 账号，以核对本机直连账单；已核对历史保留。'};
  return {rows,coverage:state,scanning:!!this.task,warning:this.warning};
 }
 rows():LocalUsageRow[]{return (this.dedupAvailable?[...this.records.values()]:[]).filter(r=>!this.gateway.has(r.conversationHash)).map(r=>({day:dayOf(r.time),target:'cursor',keyId:`native:${r.account}`,keyName:'官方登录',sourceId:'',model:r.model,requests:1,failed:0,unmeasured:0,inputTokens:r.input+r.read+r.write,cachedTokens:r.read,cacheBaseTokens:r.input+r.read+r.write,cacheWriteTokens:r.write,outputTokens:r.output,durationMs:0,last:new Date(r.time).toISOString(),origin:'native',channel:'official',provider:'cursor',nativeAccountId:r.account,nativeEmailHash:r.email,nativeAccountEvidence:'billing',nativeThreadId:r.conversationHash,sampleId:r.sampleId}));}
 refresh(local:LocalUsageSnapshot):Promise<void>{
  if(this.closed)return Promise.resolve();if(this.task)return this.task;
  this.task=this.scan(local).catch(()=>{if(!this.closed)this.warning='Cursor 官方直连用量暂时无法核对，已保留上次统计；请检查授权或网络后重试。';}).finally(()=>{this.task=undefined;this.checkedAt=Date.now();});return this.task;
 }
 private async scan(local:LocalUsageSnapshot){
  if(this.localCoverage(local)?.status!=='ready')return;
  const conversations=local.cursorConversations??[],sources=this.readers();
  this.fingerprint=JSON.stringify([conversations.map(c=>c.hash).sort(),sources.map(s=>s.revision).sort()]);
  try{this.gateway=await cursorGatewayConversations(this.root);this.dedupAvailable=true;}catch{this.dedupAvailable=false;this.warning='Cursor 网关排重记录暂不可读，直连用量暂停展示，避免重复累计。';return;}
  this.warning='';this.detail=note;this.skipped=0;
  for(const[id,row]of this.records)if(this.gateway.has(row.conversationHash)||row.time<Date.now()-retention)this.records.delete(id);
  if(!conversations.length||!sources.length)return;
  const proofs=new Map(conversations.map(c=>[c.hash,c.createdAt])),end=Date.now(),start=Math.min(end,Math.max(end-retention,Math.min(...conversations.map(c=>c.createdAt))-60000));
  this.controller=new AbortController();
  // Query accounts independently; one expired or offline grant must not drop
  // another account's measured history or turn missing billing into zero.
  for(const source of sources){
   try{
    const result=await source.read(start,end,this.controller.signal);if(this.closed)return;
    if(source.email&&result.email.toLowerCase()!==source.email.toLowerCase()||!result.complete)throw Error('Incomplete or mismatched account bill');
    const account=nativeIdentity('cursor',result.email.toLowerCase()),email=emailIdentity(result.email),incoming=new Map<string,Bill>(),conflicts=new Set<string>(),pending=new Set<string>();
    for(const e of result.events){
     if(!e.conversationId||e.isHeadless===true||e.cloudAgentId||e.automationId||e.clientType&&/sdk|cli|headless|cloud|automation/i.test(e.clientType))continue;
     const conversationHash=cursorConversationHash(e.conversationId),createdAt=proofs.get(conversationHash);
     if(createdAt===undefined||this.gateway.has(conversationHash)||e.timestamp<Math.max(start,createdAt-60000)||e.timestamp>end||e.userEmail&&e.userEmail.toLowerCase()!==result.email.toLowerCase())continue;
     const sampleId=nativeIdentity('cursor-bill',`${account}:${conversationHash}:${e.timestamp}:${e.model}`),u=e.tokenUsage;
     if(!u){this.skipped++;pending.add(sampleId);continue;}
     const total=u.inputTokens+u.cacheReadTokens+u.cacheWriteTokens+u.outputTokens;if(!Number.isSafeInteger(total)||total===0){this.skipped++;pending.add(sampleId);continue;}
     const row={sampleId,conversationHash,account,email,time:e.timestamp,model:e.model,input:u.inputTokens,output:u.outputTokens,read:u.cacheReadTokens,write:u.cacheWriteTokens};
     const previous=incoming.get(sampleId);if(previous&&JSON.stringify(previous)!==JSON.stringify(row))conflicts.add(sampleId);incoming.set(sampleId,row);
    }
    for(const id of conflicts){incoming.delete(id);pending.add(id);this.skipped++;}
    // A settled correction replaces the same sample on the next scan; it is
    // never appended as another request. Unreturned older history is retained.
    for(const[id,row]of this.records)if(row.account===account&&row.time>=start&&row.time<=end&&proofs.has(row.conversationHash)&&!pending.has(id))this.records.delete(id);
    for(const[id,row]of incoming)this.records.set(id,row);
   }catch{if(this.closed)return;this.warning='部分 Cursor 账号账单未完整核对，已保留这些账号上次统计；请检查授权或网络后重试。';}
  }
  if(this.closed)return;
  if(this.skipped)this.detail=`${note} ${this.skipped} 条缺少明确 Token 或存在明细冲突，未估算。`;
  const path=join(this.root,'cursor-native-usage.json');await safePath(path);await safePath(path+'.tmp');
  const bills=[...this.records.values()].sort((a,b)=>b.time-a.time).slice(0,100000);this.records=new Map(bills.map(b=>[b.sampleId,b]));
  await writeFile(path+'.tmp',JSON.stringify({version:1,bills}),{mode:0o600});await rename(path+'.tmp',path);
 }
 async close(){this.closed=true;this.controller?.abort();await this.task;}
}
