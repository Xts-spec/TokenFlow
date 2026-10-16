import {z} from 'zod';
import type {TokenUsage} from '@cursor/sdk';
import type {QuotaReport,QuotaWindow} from './quota/types.js';

const origin='https://api2.cursor.sh';
const count=z.number().int().nonnegative().safe();
const integer=z.union([count,z.string().regex(/^\d+$/).transform(Number).pipe(count)]);
const tokens=z.object({inputTokens:count.default(0),outputTokens:count.default(0),cacheReadTokens:count.default(0),cacheWriteTokens:count.default(0)});
const eventPage=z.object({totalUsageEventsCount:count.default(0),usageEventsDisplay:z.array(z.object({conversationId:z.string().optional(),tokenUsage:tokens.optional()})).default([])});
const percent=z.number().finite().nonnegative();
const planResponse=z.object({isMerged:z.boolean().optional(),planInfo:z.object({planName:z.string(),includedUsagePeriod:z.union([z.string(),z.number()]).optional(),includedUsageResetsAt:integer.optional()}).optional()});
const periodResponse=z.object({billingCycleEnd:integer.optional(),planUsage:z.object({includedSpend:count.default(0),limit:count.optional(),remaining:count.optional(),bonusSpend:count.default(0),totalSpend:count.default(0),autoSpend:count.optional(),autoLimit:count.optional(),apiSpend:count.optional(),apiLimit:count.optional(),autoPercentUsed:percent.optional(),apiPercentUsed:percent.optional(),totalPercentUsed:percent.optional()}).optional(),spendLimitUsage:z.object({individualLimit:count.optional(),individualUsed:count.default(0)}).optional()});
const unifiedResponse=z.object({usagePercent:percent.optional(),currentPeriodEndMs:integer.optional(),prepaidBalanceCents:integer.optional(),prepaidBalanceWithheld:z.boolean().optional()});
const iso=(ms:number|undefined)=>ms&&ms<=8640000000000000?new Date(ms).toISOString():undefined;
const failed=(status:number)=>Object.assign(new Error(`Cursor 用量查询失败（${status}）`),{status});

/** Read-only dashboard RPCs used by the Cursor IDE. Access tokens use the SDK's
 * own API-key exchange; never borrow a different locally signed-in account. */
export class CursorUsage {
 private token?:{value:string;expires:number};private exchanging?:Promise<string>;
 constructor(private apiKey:string){}
 private async accessToken(){
  if(this.token&&this.token.expires>Date.now())return this.token.value;
  if(this.exchanging)return this.exchanging;
  this.exchanging=(async()=>{
   const response=await fetch(`${origin}/auth/exchange_user_api_key`,{method:'POST',headers:{Authorization:`Bearer ${this.apiKey}`,'Content-Type':'application/json'},body:'{}',redirect:'error',signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw failed(response.status);
   const {accessToken}=z.object({accessToken:z.string().min(1)}).parse(await response.json());
   this.token={value:accessToken,expires:Date.now()+4*60000};return accessToken;
  })().finally(()=>{this.exchanging=undefined;});return this.exchanging;
 }
 private async call(method:string,body:unknown={},signal?:AbortSignal):Promise<unknown>{
  const token=await this.accessToken();signal?.throwIfAborted();
  const response=await fetch(`${origin}/aiserver.v1.DashboardService/${method}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Connect-Protocol-Version':'1'},body:JSON.stringify(body),redirect:'error',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000)});
  if(!response.ok){if(response.status===401)this.token=undefined;throw failed(response.status);}return response.json();
 }
 async quota():Promise<QuotaReport>{
  const [planResult,periodResult]=await Promise.allSettled([this.call('GetPlanInfo').then(v=>planResponse.parse(v)),this.call('GetCurrentPeriodUsage').then(v=>periodResponse.parse(v))]);
  if(planResult.status==='rejected')throw planResult.reason;const plan=planResult.value;
  const weekly=plan.planInfo?.includedUsagePeriod==='INCLUDED_USAGE_PERIOD_WEEKLY'||plan.planInfo?.includedUsagePeriod===2;
  const unified=plan.isMerged===true||weekly;
  if(!unified&&periodResult.status==='rejected')throw periodResult.reason;
  const period=periodResult.status==='fulfilled'?periodResult.value:{};
  const windows:QuotaWindow[]=[];const p=period.planUsage;
  if(unified){
   // This snapshot is the unified Grok/Cursor weekly allowance, not the legacy
   // dollar ledger or the separate legacy Grok Bot allowance.
   let shared:z.infer<typeof unifiedResponse>|undefined;
   try{shared=unifiedResponse.parse(await this.call('GetXaiUserUsageSnapshot'));}catch{/* Keep unavailable balances unknown; never substitute legacy amounts. */}
   windows.push({id:'cursor-models',label:'Cursor Models',usedPercent:shared?.usagePercent===undefined?null:Math.min(100,shared.usagePercent),resetsAt:iso(shared?.currentPeriodEndMs??plan.planInfo?.includedUsageResetsAt),note:'每周刷新 · 与 Grok 共用'});
   const balance=shared?.prepaidBalanceWithheld?undefined:shared?.prepaidBalanceCents;
   windows.push({id:'other-models',label:'Other Models',usedPercent:null,...(balance!==undefined?{remaining:balance/100,unit:'USD'}:{}),note:balance!==undefined?'预付费余额 · 也用于 Cursor Models 超额用量':'第三方模型按预付费余额计费；余额暂未提供，请查看官方账单。'});
  }else if(p){
   const resetsAt=iso(plan.planInfo?.includedUsageResetsAt??period.billingCycleEnd);
   const pool=(id:string,label:string,percentage:number|undefined,used:number|undefined,limit:number|undefined,note:string)=>windows.push({id,label,usedPercent:percentage!==undefined?Math.min(100,percentage):used!==undefined&&limit!==undefined&&limit>0?Math.min(100,used/limit*100):null,...(used!==undefined&&limit!==undefined?{used:used/100,limit:limit/100,unit:'USD'}:{}),resetsAt,note});
   pool('cursor-models','Cursor Models',p.autoPercentUsed,p.autoSpend,p.autoLimit,'每月刷新 · Grok、Composer；超额后可能使用 Other Models 或按量付费');
   pool('other-models','Other Models',p.apiPercentUsed,p.apiSpend,p.apiLimit,'每月刷新 · 第三方模型');
   const spend=period.spendLimitUsage;
   if(spend?.individualLimit!==undefined)windows.push({id:'on-demand',label:'按量付费用量',usedPercent:spend.individualLimit>0?Math.min(100,spend.individualUsed/spend.individualLimit*100):null,used:spend.individualUsed/100,limit:spend.individualLimit/100,unit:'USD',resetsAt:iso(period.billingCycleEnd)});
  }
  return {plan:plan.planInfo?.planName,windows,note:`${plan.planInfo?.planName?`${plan.planInfo.planName} · `:''}${unified?'新版套餐 · ':''}来自 Cursor 官方账单，包含该账号在各客户端的用量；账单可能延迟更新。`};
 }

 /** Each gateway request creates a fresh agent. Match its exact conversation ID,
  * never infer request usage from account-wide deltas or neighbouring timestamps. */
 async runUsage(agentId:string,startedAt:number,signal:AbortSignal):Promise<TokenUsage|undefined>{
  const deadline=AbortSignal.any([signal,AbortSignal.timeout(20000)]);
  for(const delay of [0,1000,2000,4000,6000]){
   if(delay)await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(deadline.reason);};const timer=setTimeout(()=>{deadline.removeEventListener('abort',abort);resolve();},delay);deadline.addEventListener('abort',abort,{once:true});if(deadline.aborted)abort();});
   deadline.throwIfAborted();let matched:ReturnType<typeof tokens.parse>[]=[];let complete=false;
   for(let page=1;page<=5;page++){
    const result=eventPage.parse(await this.call('GetFilteredUsageEvents',{startDate:String(startedAt-60000),endDate:String(Date.now()+1000),page,pageSize:100},deadline));
    const events=result.usageEventsDisplay.filter(e=>e.conversationId===agentId);
    if(events.some(e=>!e.tokenUsage))return undefined;
    matched.push(...events.map(e=>e.tokenUsage!));
    if(page*100>=result.totalUsageEventsCount){complete=true;break;}
   }
   if(complete&&matched.length){const sum=matched.reduce((a,b)=>({inputTokens:a.inputTokens+b.inputTokens,outputTokens:a.outputTokens+b.outputTokens,cacheReadTokens:a.cacheReadTokens+b.cacheReadTokens,cacheWriteTokens:a.cacheWriteTokens+b.cacheWriteTokens}),{inputTokens:0,outputTokens:0,cacheReadTokens:0,cacheWriteTokens:0});const totalTokens=Object.values(sum).reduce((a,b)=>a+b,0);if(Number.isSafeInteger(totalTokens)&&totalTokens>0)return {...sum,totalTokens};}
  }
  return undefined;
 }
}
