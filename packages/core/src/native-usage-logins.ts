import {join} from 'node:path';
import {z} from 'zod';
import {readConfig} from './agent-connections.js';
import {writePrivate} from './native-accounts.js';
import {nativeIdentity,type LocalUsageRow} from './local-usage.js';

export type NativeUsageProvider='codex'|'claude';
export type NativeUsageLogin={provider:NativeUsageProvider;accountId:string;email:string|null;organizationId?:string|null};
const hash=z.string().regex(/^[a-f0-9]{64}$/),time=z.number().int().nonnegative();
const identity=z.object({provider:z.enum(['codex','claude']),account:hash,email:hash.optional(),organization:hash.optional()});
const interval=identity.extend({from:time,to:time});
const account=identity.extend({label:z.string().min(1).max(320)});
const saved=z.object({version:z.literal(1),intervals:z.array(interval).max(2000),accounts:z.array(account).max(500)});
export type NativeLoginInterval=z.infer<typeof interval>;
export type NativeUsageAccount=z.infer<typeof account>;
const pathFor=(root:string)=>join(root,'native-usage-logins.json');
const identityKey=(v:z.infer<typeof identity>)=>JSON.stringify([v.provider,v.account,v.email??'',v.organization??'']);
const hashed=(v:NativeUsageLogin)=>({provider:v.provider,account:nativeIdentity(v.provider,v.accountId),...(v.email?{email:nativeIdentity('email',v.email.trim().toLowerCase())}:{}),...(v.organizationId?{organization:nativeIdentity(`${v.provider}-organization`,v.organizationId)}:{})});
export async function readNativeLoginIntervals(root:string):Promise<NativeLoginInterval[]>{try{return saved.parse(JSON.parse(await readConfig(pathFor(root))??'null')).intervals;}catch{return [];}}
/** Observations apply only between two readings of the same login, never across startup gaps or an account change. */
export class NativeUsageLogins{
 private intervals:NativeLoginInterval[]=[];private catalog:NativeUsageAccount[]=[];private active=new Map<NativeUsageProvider,NativeLoginInterval>();
 private error='';private pending=Promise.resolve();
 private constructor(private root:string){}
 static async open(root:string){const store=new NativeUsageLogins(root);try{const raw=await readConfig(pathFor(root));if(raw){const data=saved.parse(JSON.parse(raw));store.intervals=data.intervals;store.catalog=data.accounts;}}catch{store.error='本机账号识别记录暂不可用，已保留原文件；无法识别的用量仍单独显示。';}return store;}
 get warning(){return this.error;}
 accounts(){return this.catalog;}
 observe(logins:Record<NativeUsageProvider,NativeUsageLogin|null>,now=Date.now()){
  const work=async()=>{
   if(this.error)return;let changed=false;
   for(const provider of ['codex','claude'] as const){
    const login=logins[provider],previous=this.active.get(provider);
    if(!login){this.active.delete(provider);continue;}
    const value=hashed(login),key=identityKey(value);
    if(previous&&identityKey(previous)===key&&now>=previous.to&&now-previous.to<=15000)previous.to=now;
    else{const next={...value,from:now,to:now};this.intervals.push(next);this.active.set(provider,next);}
    const label=login.email?.trim()||`${provider==='codex'?'Codex':'Claude Code'} 本机账号 ${value.account.slice(0,8)}`;
    this.catalog=this.catalog.filter(a=>identityKey(a)!==key);this.catalog.push({...value,label:label.slice(0,320)});changed=true;
   }
   if(changed){this.intervals=this.intervals.slice(-2000);this.catalog=this.catalog.slice(-500);try{await writePrivate(pathFor(this.root),JSON.stringify({version:1,intervals:this.intervals,accounts:this.catalog}));}catch{this.error='本机账号归属暂时无法保存，后续用量继续单独显示。';this.active.clear();}}
  };
  this.pending=this.pending.then(work,work);return this.pending;
 }
 async close(){await this.pending;}
}
/** A login snapshot is an explicitly labelled fallback. Request-level identity always wins. */
export function enrichNativeLoginRows(rows:readonly LocalUsageRow[],intervals:readonly NativeLoginInterval[]):LocalUsageRow[]{
 return rows.map(row=>{
  if(row.nativeAccountId||row.nativeAccountEvidence==='conflict'||row.channel==='api'||!['codex','claude'].includes(row.target)||row.provider!==row.target)return row;
  const at=Date.parse(row.last),matches=intervals.filter(i=>i.provider===row.target&&i.from<=at&&i.to>=at&&i.to>i.from),unique=new Map(matches.map(i=>[identityKey(i),i]));
  if(unique.size!==1)return row;
  const match=[...unique.values()][0];return {...row,channel:'official',keyName:'官方登录',nativeAccountEvidence:'login-snapshot',nativeAccountId:match.account,...(match.email?{nativeEmailHash:match.email}:{}),...(match.organization?{nativeOrganizationId:match.organization}:{})};
 });
}
