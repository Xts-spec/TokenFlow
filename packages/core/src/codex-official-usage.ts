/** Official read-only app-server API. No login, inference, credential export or raw RPC output. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {z} from 'zod';
import {runtimeLaunch} from './codex-runtime.js';
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const usage=z.object({summary:z.object({lifetimeTokens:counter,peakDailyTokens:counter,longestRunningTurnSec:counter,currentStreakDays:counter,longestStreakDays:counter}),dailyUsageBuckets:z.array(z.object({startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),tokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)})).nullable()});
export function safeOfficialUsage(value:unknown,day:string){
 const parsed=usage.safeParse(value);if(!parsed.success)throw Error('Unexpected usage response shape');
 const selected=parsed.data.dailyUsageBuckets?.filter(b=>b.startDate===day)??null;
 return {summary:parsed.data.summary,selectedDate:day,dailyBucketsAvailable:parsed.data.dailyUsageBuckets!==null,selectedBuckets:selected};
}
export type OfficialUsageOptions={signal?:AbortSignal;home?:string;proxyURL?:string};
export async function readOfficialUsage(binary:string,options:OfficialUsageOptions={}){
 options.signal?.throwIfAborted();
 const launch=await runtimeLaunch(binary);
 options.signal?.throwIfAborted();
 const child=spawn(launch.file,[...launch.args,'app-server','--listen','stdio://'],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:{...process.env,...launch.env,...(options.home?{CODEX_HOME:options.home}:{}),...(options.proxyURL?{HTTP_PROXY:options.proxyURL,HTTPS_PROXY:options.proxyURL}: {})}});
 const lines=createInterface({input:child.stdout}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let next=0;
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('App server unavailable'));}pending.clear();};
 let exited=false;const exitedPromise=new Promise<void>(resolve=>{child.once('exit',()=>{exited=true;resolve();});child.once('error',()=>{exited=true;resolve();});});
 const abort=()=>{fail();child.kill('SIGTERM');};
 options.signal?.addEventListener('abort',abort,{once:true});
 child.on('error',fail);child.stdin.on('error',fail);child.on('exit',fail);
 lines.on('line',line=>{try{const v=JSON.parse(line),p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);if(v.error)p.reject(Error('App server rejected request'));else p.resolve(v.result);}catch{/* Never log raw server data. */}});
 const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
 const call=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{if(options.signal?.aborted||exited)return reject(Error('App server unavailable'));const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('App server timeout'));},25000);pending.set(id,{resolve,reject,timer});send({id,method,...(params===undefined?{}:{params})});});
 try{
  await call('initialize',{clientInfo:{name:'tokenflow_usage_audit',version:'1.0'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
  const identity=await call('account/read',{refreshToken:false});
  if(identity?.account?.type!=='chatgpt')throw Error('ChatGPT authentication required');
  return {usage:await call('account/usage/read'),email:typeof identity.account.email==='string'?identity.account.email:undefined};
 }finally{options.signal?.removeEventListener('abort',abort);fail();lines.close();child.stdin.end();child.kill('SIGTERM');const force=setTimeout(()=>{if(!exited)child.kill('SIGKILL');},1000);try{await exitedPromise;}finally{clearTimeout(force);}}
}
