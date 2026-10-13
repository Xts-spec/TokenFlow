import {describe,it,expect} from 'vitest';
import {moveOrder,orderModels,orderKeys} from '../apps/console/src/display-order';
const api=`api-${'a'.repeat(24)}/z-model`;
describe('persistent manual display ordering',()=>{
 it('defaults to API first and natural model names without mutating configuration order',()=>{
  const input=['codex/model-10',api,'codex/model-2'];expect(orderModels(input,id=>id)).toEqual([api,'codex/model-2','codex/model-10']);expect(input).toEqual(['codex/model-10',api,'codex/model-2']);
  expect(orderModels(input,id=>id,'manual',['codex/model-10','codex/model-2',api])).toEqual(['codex/model-10','codex/model-2',api]);
 });
 it('moves a filtered subset without losing hidden or temporarily unavailable models',()=>{
  const saved=['a','hidden','b','missing','c'];const next=moveOrder(saved,['a','b','c'],'c','a');expect(next).toEqual(['c','hidden','a','missing','b']);expect(saved).toEqual(['a','hidden','b','missing','c']);
  const resumed=orderModels(['a','hidden','b','missing','c','new'],id=>id,'manual',next);expect(resumed).toEqual(['c','hidden','a','missing','b','new']);expect(moveOrder(next,['c','a','b'],'outside','a')).toEqual(next);
 });
 it('supports moving down with the keyboard and deterministic key ordering after a reload',()=>{
  const keys=[{id:'2',name:'Key 10',createdAt:'2026-10-12',usedTokens:30},{id:'1',name:'Key 2',createdAt:'2026-10-13',usedTokens:10}];
  expect(orderKeys(keys).map(k=>k.id)).toEqual(['1','2']);expect(orderKeys([{...keys[0],models:[api]},{...keys[1],models:['codex/a']}]).map(k=>k.id)).toEqual(['2','1']);const saved=JSON.parse(JSON.stringify(moveOrder([],['1','2'],'1','2',true)));expect(orderKeys(keys,'manual',saved).map(k=>k.id)).toEqual(['2','1']);expect(orderKeys(keys,'tokens').map(k=>k.id)).toEqual(['2','1']);
 });
});
