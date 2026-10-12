import { useCallback, useEffect, useState } from 'react';
import type { GatewayActivitySnapshot } from '../../../packages/core/src/gateway-activity';
import type { GatewayKey } from '../../../packages/core/src/gateway-keys';

/** Recent gateway calls and exported Keys, refreshed every few seconds. */
export function useGatewayOverview(){
 const [activity,setActivity]=useState<GatewayActivitySnapshot>();const [keys,setKeys]=useState<GatewayKey[]>([]);const [error,setError]=useState('');
 const reload=useCallback(async()=>{
  try{
   const values=await Promise.all(['/api/gateway/activity','/api/gateway-keys'].map(async path=>{const r=await fetch(path);if(!r.ok)throw new Error('网关状态读取失败');return r.json();}));
   setActivity(values[0]);setKeys(values[1].keys);setError('');
  }catch{setError('暂时无法刷新网关数据，请检查本地服务。');}
 },[]);
 useEffect(()=>{void reload();const timer=setInterval(()=>void reload(),3000);return()=>clearInterval(timer);},[reload]);
 return {activity,keys,error,reload};
}
export type GatewayOverview=ReturnType<typeof useGatewayOverview>;
