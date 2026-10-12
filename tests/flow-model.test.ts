import { describe, expect, it } from 'vitest';
import { keyScopes, modelGroups, providerQuotaText, usageOf, usageText, usedModels } from '../apps/console/src/flow-model';
import type { LocalAgentSnapshot } from '../packages/core/src/cliproxy';
import { GatewayActivity } from '../packages/core/src/gateway-activity';

const local={
 state:'running',providers:[{id:'codex',label:'Codex'},{id:'claude',label:'Claude Code'}],
 accounts:[{id:'a1',provider:'codex',label:'me@example.test',status:'active',disabled:false,unavailable:false,models:['codex/gpt-5']},{id:'a2',provider:'claude',label:'x@example.test',status:'active',disabled:false,unavailable:false,models:['claude/sonnet']}],
 models:[{id:'codex/gpt-5',provider:'codex'},{id:'claude/sonnet',provider:'claude'},{id:'api-'+'b'.repeat(24)+'/my-model',provider:'api',displayName:'my-model'}],
 quotas:{a1:{status:'ok',windows:[{usedPercent:30},{usedPercent:60}]}},
 apiSources:[{id:'b'.repeat(24),name:'example.com',enabled:true,hasKey:true,models:['my-model']}],
} as unknown as LocalAgentSnapshot;

describe('flow model',()=>{
 it('lists used models current first, then newest, without duplicates or unavailable ones',()=>{
  const available=[{id:'a1',models:['codex/gpt-5','codex/mini']},{id:'a2',models:['claude/sonnet']}];
  const target={connection:{sourceId:'a1',model:'codex/gpt-5'},backups:[
   {sourceId:'a1',model:'codex/gpt-5'},{sourceId:'a2',model:'claude/sonnet'},{sourceId:'gone',model:'x'},{sourceId:'a1',model:'codex/mini'},{sourceId:'a2',model:'claude/sonnet'},
  ]};
  expect(usedModels(target,available)).toEqual([{sourceId:'a1',model:'codex/gpt-5'},{sourceId:'a2',model:'claude/sonnet'},{sourceId:'a1',model:'codex/mini'}]);
  expect(usedModels({connection:null,backups:[]},available)).toEqual([]);
 });
 it('groups usable models by the account or API that serves them',()=>{
  expect(modelGroups(local).map(g=>[g.id,g.label,g.models.length])).toEqual(expect.arrayContaining([['a1','Codex · me@example.test',1],['b'.repeat(24),'example.com',1]]));
  expect(modelGroups(local).find(g=>g.id==='a1')).toMatchObject({provider:'codex',providerLabel:'Codex',accountLabel:'me@example.test',remaining:40});
  expect(modelGroups(local).find(g=>g.provider==='api')).toMatchObject({providerLabel:'API 接口',accountLabel:'example.com',remaining:null});
 });
 it('keeps identical models bound to their own account and never presents failed quota as current',()=>{
  const second={...local.accounts[0],id:'other',label:'work@example.test'};
  const failed={...local.quotas.a1,status:'error' as const,error:'查询失败'};
  const groups=modelGroups({...local,accounts:[...local.accounts,second],quotas:{...local.quotas,other:failed}});
  const matches=groups.filter(g=>g.models.some(m=>m.id==='codex/gpt-5'));
  expect(matches.map(g=>[g.id,g.accountLabel,g.remaining])).toEqual([['a1','me@example.test',40],['other','work@example.test',null]]);
  expect(matches[1].quota?.status).toBe('error');
 });
 it('scopes exported Keys by provider or API source',()=>{
  expect(keyScopes(local).map(g=>[g.label,g.models.length])).toEqual([['Claude Code',1],['Codex',1],['example.com',1]]);
 });
 it('sums token usage for matching calls only, beyond the recent-call window',()=>{
  const activity=new GatewayActivity();
  const call=(model:string,status:number,input:number|null,at:string)=>activity.record({model,status,startedAt:at,inputTokens:input,outputTokens:input===null?null:1,keyId:'k',agent:'codex',protocol:'responses',durationMs:1});
  call('codex/gpt-5',200,10,'2026-01-02');call('codex/gpt-5',500,null,'2026-01-03');call('claude/x',200,99,'2026-01-04');
  for(let i=0;i<150;i++)call('claude/x',200,1,'2026-01-05');
  const {recent,usage:rows}=activity.snapshot();
  expect(recent).toHaveLength(100);
  const usage=usageOf(rows,c=>c.model==='codex/gpt-5');
  expect(usage).toEqual({requests:2,failed:1,inputTokens:10,outputTokens:1,last:'2026-01-03'});
  expect(usageOf(rows,c=>c.model==='claude/x').requests).toBe(151);
  expect(usageText(usage)).toBe('2 次请求（1 次失败） · 11 tokens');
  expect(usageText(usageOf([],()=>true))).toBe('本次运行还没有请求');
 });
 it('reports the tightest quota and stays silent when none is known',()=>{
  expect(providerQuotaText(local,['a1'])).toBe('剩余 40%');expect(providerQuotaText(local,['a2'])).toBe('');
 });
});
