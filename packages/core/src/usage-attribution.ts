import {readFile,writeFile,rename,mkdir,stat,lstat} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {parse,stringify} from 'smol-toml';
import {z} from 'zod';
import {nativeIdentity,type LocalUsageRow} from './local-usage.js';
import type {NativeUsageAccount} from './native-usage-logins.js';

const hash=z.string().regex(/^[a-f0-9]{64}$/);
const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const attributionRecord=z.object({thread:hash,time:count,model:z.string().min(1).max(300),input:count,read:count,write:count,output:count,account:hash,email:hash.optional()});
export type AttributionRecord=z.infer<typeof attributionRecord>;
export const emailIdentity=(email:string)=>nativeIdentity('email',email.trim().toLowerCase());
const pathFor=(root:string)=>join(root,'usage-account-evidence.json');
export async function readAccountEvidence(root:string){
 try{const path=pathFor(root);if((await stat(path)).size>128*1024*1024)return [];const value=JSON.parse(await readFile(path,'utf8'));if(value.version!==1)return [];return z.array(attributionRecord).max(200000).parse(value.records);}catch{return [];}
}
const text=(v:any)=>typeof v?.stringValue==='string'?v.stringValue:typeof v?.intValue==='string'||typeof v?.intValue==='number'?String(v.intValue):undefined;
const array=(value:any):any[]=>Array.isArray(value)?value:[];
const attrs=(values:any)=>Object.fromEntries((Array.isArray(values)?values:[]).filter(v=>typeof v?.key==='string').map(v=>[v.key,text(v.value)]));
/** Only completed response counters and authenticated client identity are retained. */
export function decodeAccountEvents(body:unknown,since:number,now=Date.now()):AttributionRecord[]{
 const result:AttributionRecord[]=[];const roots=(body as any)?.resourceLogs;if(!Array.isArray(roots))return result;
 for(const resource of roots)for(const scope of array(resource?.scopeLogs))for(const record of array(scope?.logRecords)){
  const a={...attrs(resource?.resource?.attributes),...attrs(record?.attributes)};
  if(a['event.name']!=='codex.sse_event'||a['event.kind']!=='response.completed')continue;
  const mode=String(a.auth_mode??'').toLowerCase().replace(/[_-]/g,'');
  if(!['chatgpt','oauth','official','chatgptexternaltokens'].includes(mode)||!a['user.account_id']||!a['conversation.id'])continue;
  const rawTime=Number(record?.timeUnixNano)/1e6;const time=Math.round(Number.isFinite(rawTime)&&rawTime>0?rawTime:Date.parse(a['event.timestamp']??''));
  if(!Number.isFinite(time)||time<since||time<now-10*60_000||time>now+30_000)continue;
  const value=attributionRecord.safeParse({thread:nativeIdentity('thread',a['conversation.id']),time,model:a.model,input:Number(a.input_token_count),read:Number(a.cached_token_count??0),write:Number(a.cache_write_token_count??0),output:Number(a.output_token_count),account:nativeIdentity('codex',a['user.account_id']),...(a['user.email']?{email:emailIdentity(a['user.email'])}:{})});
  if(value.success&&value.data.read+value.data.write<=value.data.input)result.push(value.data);
 }return result;
}
/** A join must match thread, model, counters and completion time; conflicts remain unknown. */
export function enrichAccountRows(rows:readonly LocalUsageRow[],evidence:readonly AttributionRecord[]):LocalUsageRow[]{
 const byThread=new Map<string,AttributionRecord[]>();for(const e of evidence){const list=byThread.get(e.thread)??[];list.push(e);byThread.set(e.thread,list);}
 return rows.map(row=>{
  if(row.nativeAccountEvidence==='conflict'||row.target!=='codex'||!row.nativeThreadId||row.channel==='api'||row.nativeAccountId&&row.nativeAccountEvidence!=='otel'&&row.nativeAccountEvidence!=='login-snapshot')return row;
  const matches=(byThread.get(row.nativeThreadId)??[]).filter(e=>e.model===row.model&&Math.abs(e.time-Date.parse(row.last))<=5000&&e.input===row.inputTokens&&e.read===row.cachedTokens&&e.write===(row.cacheWriteTokens??0)&&e.output===row.outputTokens);
  const identities=new Map(matches.map(e=>[`${e.account}:${e.email??''}`,e]));if(!identities.size)return row;
  if(row.nativeAccountId&&row.nativeAccountEvidence!=='login-snapshot'&&matches.some(e=>e.account!==row.nativeAccountId||e.email!==row.nativeEmailHash)||identities.size>1){const {nativeAccountId,nativeEmailHash,nativeOrganizationId,nativeAccountLabel,nativeAccountEvidence,...unconfirmed}=row;return {...unconfirmed,nativeAccountEvidence:'conflict',sourceId:'',keyId:`native:${row.target}`};}
  const identity=[...identities.values()][0];return {...row,channel:'official',keyName:'官方登录',nativeAccountId:identity.account,nativeAccountEvidence:'otel',nativeEmailHash:identity.email,nativeOrganizationId:undefined,nativeAccountLabel:undefined};
 });
}
export function mapNativeAccounts<T extends LocalUsageRow>(rows:readonly T[],accounts:readonly {id:string;provider?:string;accountId:string|null;email:string|null;organizationId?:string|null;label?:string}[],local:readonly NativeUsageAccount[]=[]):T[]{
 const byId=new Map<string,typeof accounts[number][]>();for(const a of accounts){if(!a.accountId)continue;const key=nativeIdentity(a.provider??'codex',a.accountId),list=byId.get(key)??[];list.push(a);byId.set(key,list);}
 return rows.map(row=>{
  const candidates=row.channel==='official'&&row.nativeAccountId?(byId.get(row.nativeAccountId)??[]).filter(a=>(!row.nativeEmailHash||a.email&&emailIdentity(a.email)===row.nativeEmailHash)&&(!row.nativeOrganizationId||a.organizationId&&nativeIdentity(`${a.provider??'codex'}-organization`,a.organizationId)===row.nativeOrganizationId)):[];
  const match=candidates.length===1?candidates[0]:undefined;
  const known=row.channel==='official'?local.filter(a=>a.provider===row.provider&&a.account===row.nativeAccountId&&(!row.nativeEmailHash||a.email===row.nativeEmailHash)&&(!row.nativeOrganizationId||a.organization===row.nativeOrganizationId)):[];
  const label=match?.label||match?.email||(known.length===1?known[0].label:undefined);
  return {...row,sourceId:match?.id??'',nativeAccountLabel:label};
 });
}

export class UsageAttribution {
 private records:AttributionRecord[]=[];private timer?:ReturnType<typeof setTimeout>;private pending=Promise.resolve();private error='';
 private constructor(private root:string,readonly token:string,readonly since:number){}
 static async open(root:string){
  const path=join(root,'usage-account-recorder.json');let config:{token:string;since:number};
  try{config=z.object({token:hash,since:count}).parse(JSON.parse(await readFile(path,'utf8')));}catch(error:any){
   config={token:randomBytes(32).toString('hex'),since:Date.now()};
   if(error.code!=='ENOENT'){const disabled=new UsageAttribution(root,config.token,config.since);disabled.error='请求账号记录配置暂不可用，已保留原文件；缺少证据的请求继续显示未确认。';return disabled;}
   await mkdir(root,{recursive:true,mode:0o700});await writeFile(path,JSON.stringify(config),{mode:0o600,flag:'wx'});
  }
  const result=new UsageAttribution(root,config.token,config.since);result.records=await readAccountEvidence(root);return result;
 }
 get warning(){return this.error;}
 accept(body:unknown,now=Date.now()){
  if(this.error)return 0;
  const incoming=decodeAccountEvents(body,this.since,now);if(!incoming.length)return 0;
  const all=new Map(this.records.map(r=>[JSON.stringify(r),r]));for(const r of incoming)all.set(JSON.stringify(r),r);
  this.records=[...all.values()].sort((a,b)=>a.time-b.time).slice(-200000);clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),100);this.timer.unref();return incoming.length;
 }
 private flush(){clearTimeout(this.timer);const value=JSON.stringify({version:1,records:this.records});this.pending=this.pending.catch(()=>{}).then(async()=>{const path=pathFor(this.root),tmp=path+'.tmp';await writeFile(tmp,value,{mode:0o600});await rename(tmp,path);}).catch(()=>{this.error='请求账号证据暂时无法保存，缺少证据的请求继续显示未确认。';});return this.pending;}
 async close(){if(!this.error)await this.flush();}
 /** Preserve existing exporters and all configuration outside the owned OTEL section. */
 async enable(configPath:string,origin:string){
  if(this.error)return false;
  const raw=await readFile(configPath,'utf8').catch((e:any)=>{if(e.code==='ENOENT')return '';throw e;});const config=parse(raw);const otel=(config.otel??{}) as Record<string,any>;
  const current=otel.exporter;const endpoint=current?.['otlp-http']?.endpoint;
  if(current&&current!=='none'&&!(typeof endpoint==='string'&&/^http:\/\/127\.0\.0\.1:\d+\/local-telemetry\/codex\/v1\/logs$/.test(endpoint))){this.error='已有其他 Codex 遥测接收器，已保留原配置；未收到账号证据的直连请求继续显示未确认。';return false;}
  const next={...otel,log_user_prompt:false,log_agent_responses:false,exporter:{'otlp-http':{endpoint:origin+'/local-telemetry/codex/v1/logs',protocol:'json',headers:{'x-tokenflow-recorder':this.token}}}};
  if(isDeepStrictEqual(otel,next))return true;
  const rendered=stringify({otel:next}).trimEnd();const sections=[...raw.matchAll(/^[ \t]*\[([^\]\n]+)\][ \t]*(?:#[^\n]*)?$/gm)];const ranges=sections.flatMap((s,i)=>s[1].trim()==='otel'||s[1].trim().startsWith('otel.')?[{start:s.index!,end:sections[i+1]?.index??raw.length}]:[]);
  let updated=raw;if(ranges.length){for(let i=ranges.length-1;i>=0;i--){const r=ranges[i];updated=updated.slice(0,r.start)+(i===0?rendered+'\n\n':'')+updated.slice(r.end);}}else updated=raw.trimEnd()+'\n\n'+rendered+'\n';
  parse(updated);if(updated===raw)return true;
  const info=await lstat(configPath).catch(()=>undefined);if(info&&!info.isFile())throw Error('Codex configuration must be a regular file');
  await mkdir(dirname(configPath),{recursive:true,mode:0o700});
  // Never replace a simultaneous settings edit.
  if(await readFile(configPath,'utf8').catch(()=>'')!==raw)throw Error('Codex 配置已变化，请重试启用账号记录。');
  await writeFile(join(this.root,'codex-usage-config-before.toml'),raw,{mode:0o600,flag:'wx'}).catch((error:any)=>{if(error.code!=='EEXIST')throw error;});
  const tmp=configPath+'.tokenflow-telemetry.tmp';await writeFile(tmp,updated,{mode:0o600,flag:'wx'});await rename(tmp,configPath);return true;
 }
}
