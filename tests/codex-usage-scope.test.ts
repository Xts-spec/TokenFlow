import {expect,it} from 'vitest';
import {codexScopeMatrix} from '../scripts/codex-usage-scope.js';
import type {LocalUsageRow} from '../packages/core/src/local-usage.js';
const row=(sampleId:string,last:string,nativeAccountId?:string,nativeEmailHash?:string):LocalUsageRow=>({sampleId,last,day:last.slice(0,10),target:'codex',keyId:'native',keyName:'fixture',sourceId:'',model:'fixture',requests:1,failed:0,unmeasured:0,inputTokens:100,cachedTokens:60,cacheBaseTokens:100,outputTokens:20,durationMs:0,origin:'native',channel:'official',provider:'codex',nativeAccountId,nativeEmailHash});
it('uses half-open day windows, keeps account partitions additive and marks unfinished timezone days',()=>{
 const input=[row('before','2026-10-15T15:59:59Z','A','mail'),row('start','2026-10-15T16:00:00Z','A','mail'),row('other','2026-10-16T01:00:00Z','B','other'),row('unknown','2026-10-16T02:00:00Z'),row('end','2026-10-16T16:00:00Z','A','mail')];
 const matrix=codexScopeMatrix(input,'2026-10-16',{account:'A',email:'mail'},Date.parse('2026-10-16T17:00:00Z'));
 const local=matrix.find(m=>m.offsetHours===8)!;expect(local).toMatchObject({totalTokens:360,latestObservedAccountTokens:120,otherAccountTokens:120,unassignedTokens:120,periodComplete:true,fromUtc:'2026-10-15T16:00:00.000Z',toUtcExclusive:'2026-10-16T16:00:00.000Z'});
 expect(matrix.find(m=>m.offsetHours===0)?.periodComplete).toBe(false);
 for(const m of matrix)expect(m.totalTokens).toBe(m.latestObservedAccountTokens+m.otherAccountTokens+m.unassignedTokens);
});
it('does not double copied responses, mix member emails or count future samples',()=>{
 const a=row('same','2026-10-16T01:00:00Z','A','mail'),other=row('member','2026-10-16T02:00:00Z','A','different');
 const local=codexScopeMatrix([a,{...a},other,row('future','2026-10-17T01:00:00Z')],'2026-10-16',{account:'A',email:'mail'},Date.parse('2026-10-16T20:00:00Z')).find(m=>m.offsetHours===8)!;
 expect(local).toMatchObject({totalTokens:240,latestObservedAccountTokens:120,otherAccountTokens:120,unassignedTokens:0});
 expect(()=>codexScopeMatrix([],'2026-02-31')).toThrow('Invalid calendar day');
});

it('separates exact account evidence from login observations without changing the total',()=>{
 const exact={...row('exact','2026-10-16T01:00:00Z','A','mail'),nativeAccountEvidence:'otel' as const};
 const observed={...row('observed','2026-10-16T02:00:00Z','A','mail'),nativeAccountEvidence:'login-snapshot' as const};
 const local=codexScopeMatrix([exact,{...exact,nativeAccountEvidence:'login-snapshot'},observed,row('direct','2026-10-16T03:00:00Z','A','mail'),row('unknown','2026-10-16T04:00:00Z')],'2026-10-16',{account:'A',email:'mail'},Date.parse('2026-10-17T00:00:00Z')).find(m=>m.offsetHours===8)!;
 expect(local).toMatchObject({totalTokens:480,latestObservedAccountTokens:360,unassignedTokens:120,latestObservedAccountEvidence:{otel:{requests:1,tokens:120},'login-snapshot':{requests:1,tokens:120},record:{requests:1,tokens:120}}});
});
