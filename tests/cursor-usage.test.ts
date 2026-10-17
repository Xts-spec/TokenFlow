import {afterEach,expect,it,vi} from 'vitest';
import {CursorUsage} from '../packages/core/src/cursor-usage.js';
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers();});
const signal=()=>new AbortController().signal;
function transport(handler:(method:string,body:Record<string,unknown>)=>unknown){return vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
 const url=String(input);expect(url.startsWith('https://api2.cursor.sh/')).toBe(true);expect(init?.redirect).toBe('error');
 if(url.endsWith('/auth/exchange_user_api_key')){expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-key');return Response.json({accessToken:'fixture-session'});}
 expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-session');
 return Response.json(handler(url.split('/').pop()!,JSON.parse(String(init?.body))));
});}
it('uses official separate pool percentages instead of treating the legacy dollar limit as total quota',async()=>{
 const fetcher=transport(method=>method==='GetPlanInfo'?{planInfo:{planName:'Pro',includedUsagePeriod:'INCLUDED_USAGE_PERIOD_MONTHLY'}}:{billingCycleEnd:'1794805091000',planUsage:{includedSpend:2000,totalSpend:12393,bonusSpend:10393,limit:2000,autoPercentUsed:17.633333333333,apiPercentUsed:99.0666666666},spendLimitUsage:{limitType:'user'}});
 const quota=await new CursorUsage('fixture-key').quota();expect(quota.plan).toBe('Pro');expect(quota.windows[0]).toMatchObject({label:'Cursor Models',usedPercent:17.633333333333,resetsAt:'2026-11-16T04:58:11.000Z'});expect(quota.windows[1]).toMatchObject({label:'Other Models',usedPercent:99.0666666666});expect(quota.windows[0].limit).toBeUndefined();
 expect(fetcher.mock.calls.filter(([url])=>String(url).includes('/auth/'))).toHaveLength(1);expect(JSON.stringify(quota)).not.toContain('fixture-');
});
it('shows unified weekly usage and shared prepaid balance without a fabricated monthly Other Models pool',async()=>{
 transport(method=>method==='GetPlanInfo'?{isMerged:true,planInfo:{planName:'Premium',includedUsagePeriod:'INCLUDED_USAGE_PERIOD_WEEKLY'}}:method==='GetCurrentPeriodUsage'?{billingCycleEnd:'1794805091000',planUsage:{limit:2000,apiPercentUsed:0}}:{usagePercent:32.5,currentPeriodEndMs:'1792540800000',prepaidBalanceCents:'1250'});
 const quota=await new CursorUsage('fixture-key').quota();expect(quota.windows).toHaveLength(2);expect(quota.windows[0]).toMatchObject({label:'Cursor Models',usedPercent:32.5,resetsAt:new Date(1792540800000).toISOString()});expect(quota.windows[1]).toMatchObject({label:'Other Models',usedPercent:null,remaining:12.5,unit:'USD'});expect(quota.windows[1].resetsAt).toBeUndefined();
});
it('keeps a missing or withheld new-plan balance unknown and does not use the billing date as weekly reset',async()=>{
 transport(method=>method==='GetPlanInfo'?{isMerged:true,planInfo:{planName:'Ultra',includedUsagePeriod:2}}:method==='GetCurrentPeriodUsage'?{billingCycleEnd:'1794805091000',planUsage:{limit:2000,includedSpend:1000}}:{prepaidBalanceWithheld:true,prepaidBalanceCents:'100'});
 const quota=await new CursorUsage('fixture-key').quota();expect(quota.windows[0].usedPercent).toBeNull();expect(quota.windows[0].resetsAt).toBeUndefined();expect(quota.windows[1].remaining).toBeUndefined();
});
it('sums only the exact fresh agent, including cache tokens and every page',async()=>{
 transport((method,body)=>{expect(method).toBe('GetFilteredUsageEvents');return body.page===1?{totalUsageEventsCount:101,usageEventsDisplay:[{conversationId:'another-agent',tokenUsage:{inputTokens:9000}},{conversationId:'agent-target',tokenUsage:{inputTokens:10,outputTokens:2,cacheReadTokens:20}}]}:{totalUsageEventsCount:101,usageEventsDisplay:[{conversationId:'agent-target',tokenUsage:{inputTokens:3,outputTokens:4,cacheWriteTokens:5}}]};});
 expect(await new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),signal())).toEqual({inputTokens:13,outputTokens:6,cacheReadTokens:20,cacheWriteTokens:5,totalTokens:44});
});
it('retries delayed billing without borrowing a neighbouring request',async()=>{
 vi.useFakeTimers();let calls=0;transport(()=>({totalUsageEventsCount:1,usageEventsDisplay:[{conversationId:++calls===1?'other':'agent-target',tokenUsage:{inputTokens:100,outputTokens:7}}]}));
 const result=new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),signal());await vi.runAllTimersAsync();expect((await result)?.totalTokens).toBe(107);expect(calls).toBe(2);
});
it('leaves usage unknown when any matching event lacks its token bill',async()=>{
 transport(()=>({totalUsageEventsCount:2,usageEventsDisplay:[{conversationId:'agent-target',tokenUsage:{inputTokens:10}},{conversationId:'agent-target'}]}));
 expect(await new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),signal())).toBeUndefined();
});
it('does not turn missing billing events into zero tokens',async()=>{
 vi.useFakeTimers();transport(()=>({totalUsageEventsCount:0}));const result=new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),signal());await vi.runAllTimersAsync();expect(await result).toBeUndefined();
});
it('reports errors without echoing upstream bodies or credentials',async()=>{
 vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('secret error body',{status:401}));await expect(new CursorUsage('fixture-key').quota()).rejects.toThrow('Cursor 用量查询失败（401）');
});
it('rejects malformed negative billing and respects cancellation',async()=>{
 transport(()=>({totalUsageEventsCount:1,usageEventsDisplay:[{conversationId:'agent-target',tokenUsage:{inputTokens:-1}}]}));await expect(new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),signal())).rejects.toThrow();
 const controller=new AbortController();controller.abort();await expect(new CursorUsage('fixture-key').runUsage('agent-target',Date.now(),controller.signal)).rejects.toThrow();
});

it('reads paginated direct bills under the key’s verified identity without creating credentials or using headless=false as IDE proof',async()=>{
 const at=Date.now(),fetcher=transport((method,body)=>method==='GetMe'?{email:'BILLING@example.test'}:body.page===1?{totalUsageEventsCount:101,usageEventsDisplay:[{timestamp:String(at),model:'gemini-fixture',conversationId:'local-composer',isHeadless:false,tokenUsage:{inputTokens:4,outputTokens:2}}]}:{totalUsageEventsCount:101,usageEventsDisplay:[{timestamp:String(at+1),model:'gemini-fixture',conversationId:'sdk-agent',isHeadless:false,tokenUsage:{inputTokens:9}}]});
 const result=await new CursorUsage('fixture-key').events(at-1000,at+1000,signal());expect(result).toMatchObject({email:'billing@example.test',complete:true});expect(result.events).toHaveLength(2);expect(result.events[0]).toMatchObject({timestamp:at,tokenUsage:{inputTokens:4,outputTokens:2,cacheReadTokens:0,cacheWriteTokens:0}});
 expect(fetcher.mock.calls.map(([url])=>String(url).split('/').pop())).toEqual(['exchange_user_api_key','GetMe','GetFilteredUsageEvents','GetFilteredUsageEvents']);
});
it('bounds direct pagination and marks truncated bills incomplete instead of replacing measured history',async()=>{
 const fetcher=transport(method=>method==='GetMe'?{email:'a@example.test'}:{totalUsageEventsCount:2001,usageEventsDisplay:[]});
 expect(await new CursorUsage('fixture-key').events(0,Date.now(),signal())).toMatchObject({complete:false});expect(fetcher.mock.calls.filter(([url])=>String(url).endsWith('/GetFilteredUsageEvents'))).toHaveLength(20);
});
it('accepts a protobuf empty bill with omitted zero defaults as an empty verified period',async()=>{
 transport(method=>method==='GetMe'?{email:'a@example.test'}:{});
 expect(await new CursorUsage('fixture-key').events(0,Date.now(),signal())).toEqual({email:'a@example.test',events:[],complete:true});
});
