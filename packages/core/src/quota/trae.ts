import {record,str,num,isoFromAny,percent,parseJSON} from './shared.js';
import type {QuotaProvider,QuotaWindow} from './types.js';

/** Native account token belongs to the regional account API, not the inference host. */
export const traeQuota:QuotaProvider={
 id:'trae',
 async fetch(call,account){
  const host=account.domain??'https://api-us-east.trae.ai';
  if(host!=='https://api-us-east.trae.ai')throw new Error('此 TRAE 账号地区的额度接口尚未验证。');
  const data=record(parseJSON(await call({method:'POST',url:host+'/trae/api/v1/pay/ide_user_ent_usage',header:{Authorization:'Cloud-IDE-JWT $TOKEN$',Accept:'application/json','Content-Type':'application/json'},data:JSON.stringify({require_usage:true,full_data:true})}),'TRAE 额度'));
  if(!data||data.code!==undefined&&Number(data.code)!==0||!Array.isArray(data.user_entitlement_pack_list))throw new Error('TRAE 官方未返回有效的套餐额度。');
  const windows:QuotaWindow[]=[];const plans=new Set<string>();
  for(const [index,raw] of data.user_entitlement_pack_list.entries()){
   const pack=record(raw);if(!pack||pack.is_hide===true||pack.is_last_period===true||pack.status!==1)continue;
   const base=record(pack.entitlement_base_info),extra=record(base?.product_extra);
   const quota=record(base?.quota)??record(record(extra?.subscription_extra)?.quota)??record(record(extra?.package_extra)?.quota);
   const usage=record(pack.usage);const end=isoFromAny(base?.end_time);
   if(end&&Date.parse(end)<=Date.now())continue;
   const plan=str(pack.display_desc)??'TRAE 套餐';plans.add(plan);
   if(data.is_dollar_usage_billing===true){
    for(const [key,label] of [['basic','基础额度'],['bonus','奖励额度']] as const){
     const limit=num(quota?.[`${key}_usage_limit`]);if(limit===undefined||limit<=0)continue;
     const used=num(usage?.[`${key}_usage_amount`]);
     windows.push({id:`pack-${index}-${key}`,label:`${plan} · ${label}`,used,limit,unit:'USD',usedPercent:percent(used,limit),resetsAt:end});
    }
   }
  }
  return {plan:[...plans].join(' / ')||account.planType||'TRAE 账号',windows,...(!windows.length?{note:'官方未返回当前有效的金额额度窗口；未将未知余额显示为零。'}:{})};
 }
};
