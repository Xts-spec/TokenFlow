import {describe,it,expect} from 'vitest';
import {traeQuota} from '../packages/core/src/quota/trae.js';
const pack=(extra={})=>({display_desc:'Free plan',status:1,is_hide:false,is_last_period:false,entitlement_base_info:{end_time:1993491199,quota:{basic_usage_limit:1,bonus_usage_limit:0}},usage:{basic_usage_amount:0.0195},...extra});
const response=(data:unknown)=>({statusCode:200,header:{},body:JSON.stringify(data)});
describe('Trae official entitlement quota',()=>{
 it('reads dollar usage, preserves fractional amounts and excludes old packs',async()=>{
  const report=await traeQuota.fetch(async req=>{expect(req.url).toBe('https://api-us-east.trae.ai/trae/api/v1/pay/ide_user_ent_usage');expect(req.header.Authorization).toBe('Cloud-IDE-JWT $TOKEN$');return response({is_dollar_usage_billing:true,user_entitlement_pack_list:[pack(),pack({is_last_period:true}),pack({is_hide:true})]})},{provider:'trae'});
  expect(report.plan).toBe('Free plan');expect(report.windows).toHaveLength(1);expect(report.windows[0]).toMatchObject({used:0.0195,limit:1,unit:'USD',usedPercent:1.95});
 });
 it('never fabricates zero usage when the amount is missing',async()=>{
  const report=await traeQuota.fetch(async()=>response({is_dollar_usage_billing:true,user_entitlement_pack_list:[pack({usage:{}})]}),{provider:'trae'});
  expect(report.windows[0].used).toBeUndefined();expect(report.windows[0].usedPercent).toBeNull();
 });
 it('rejects business errors and non official credential destinations',async()=>{
  await expect(traeQuota.fetch(async()=>response({code:1001}),{provider:'trae'})).rejects.toThrow();
  await expect(traeQuota.fetch(async()=>{throw Error('must not call')},{provider:'trae',domain:'https://example.com'})).rejects.toThrow('地区');
 });
});
