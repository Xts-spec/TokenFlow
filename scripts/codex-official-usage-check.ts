/** Official read-only app-server API. No login, inference, credential export or raw RPC output. */
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {z} from 'zod';
import {nativeIdentity} from '../packages/core/src/local-usage.js';
import {readNativeLoginIntervals} from '../packages/core/src/native-usage-logins.js';
const counter=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
const usage=z.object({summary:z.object({lifetimeTokens:counter,peakDailyTokens:counter,longestRunningTurnSec:counter,currentStreakDays:counter,longestStreakDays:counter}),dailyUsageBuckets:z.array(z.object({startDate:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),tokens:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)})).nullable()});
export function safeOfficialUsage(value:unknown,day:string){
 const parsed=usage.safeParse(value);if(!parsed.success)throw Error('Unexpected usage response shape');
 const selected=parsed.data.dailyUsageBuckets?.filter(b=>b.startDate===day)??null;
 return {summary:parsed.data.summary,selectedDate:day,dailyBucketsAvailable:parsed.data.dailyUsageBuckets!==null,selectedBuckets:selected};
}
export async function readOfficialUsage(binary:string){
 const child=spawn(binary,['app-server','--listen','stdio://'],{stdio:['pipe','pipe','ignore']});
 const lines=createInterface({input:child.stdout}),pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void;timer:ReturnType<typeof setTimeout>}>();let next=0;
 const fail=()=>{for(const p of pending.values()){clearTimeout(p.timer);p.reject(Error('App server unavailable'));}pending.clear();};
 child.on('error',fail);child.stdin.on('error',fail);child.on('exit',fail);
 lines.on('line',line=>{try{const v=JSON.parse(line),p=pending.get(v.id);if(!p)return;pending.delete(v.id);clearTimeout(p.timer);if(v.error)p.reject(Error('App server rejected request'));else p.resolve(v.result);}catch{/* Never log raw server data. */}});
 const send=(value:unknown)=>child.stdin.write(JSON.stringify(value)+'\n');
 const call=(method:string,params?:unknown)=>new Promise<any>((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('App server timeout'));},25000);pending.set(id,{resolve,reject,timer});send({id,method,...(params===undefined?{}:{params})});});
 try{
  await call('initialize',{clientInfo:{name:'tokenflow_usage_audit',version:'1.0'},capabilities:{experimentalApi:true}});send({method:'initialized',params:{}});
  const identity=await call('account/read',{refreshToken:false});
  if(identity?.account?.type!=='chatgpt')throw Error('ChatGPT authentication required');
  return {usage:await call('account/usage/read'),email:typeof identity.account.email==='string'?identity.account.email:undefined};
 }finally{fail();lines.close();child.stdin.end();child.kill('SIGTERM');const force=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},3000);force.unref();}
}
async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const binary=arg('--binary'),day=arg('--day'),root=arg('--data-root');
 if(!args.includes('--check')||!binary||!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Usage: --check --binary PATH --day YYYY-MM-DD [--data-root PATH]');
 const result=await readOfficialUsage(resolve(binary)),intervals=root?await readNativeLoginIntervals(resolve(root)):[];
 const latest=intervals.filter(i=>i.provider==='codex').sort((a,b)=>b.to-a.to)[0];
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),method:'account/usage/read',...safeOfficialUsage(result.usage,day),emailMatchesLatestObservedCodex:latest?.email&&result.email?nativeIdentity('email',result.email.trim().toLowerCase())===latest.email:null},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error(JSON.stringify({status:'unavailable',note:'Official usage check failed; no raw RPC, identity or credentials emitted.'}));process.exitCode=1;});
