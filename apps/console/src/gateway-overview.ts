import {requestJSON} from './request';
import { useCallback, useEffect, useState } from 'react';
import type { GatewayActivitySnapshot } from '../../../packages/core/src/gateway-activity';
import type { GatewayKey } from '../../../packages/core/src/gateway-keys';

/** Recent gateway calls and exported Keys, refreshed every few seconds. */
export function useGatewayOverview(){
 const [loaded,setLoaded]=useState(false);
 const [activity,setActivity]=useState<GatewayActivitySnapshot>();const [keys,setKeys]=useState<GatewayKey[]>([]);const [error,setError]=useState('');
 const reload=useCallback(async()=>{
  try{
   const values=await Promise.all([requestJSON<GatewayActivitySnapshot>('/api/gateway/activity'),requestJSON<{keys:GatewayKey[]}>('/api/gateway-keys')]);
   setActivity(values[0]);setKeys(values[1].keys);setError('');setLoaded(true);
  }catch{setError('暂时无法刷新网关数据，请检查本地服务。');}
 },[]);
 useEffect(()=>{const reconnect=()=>void reload();window.addEventListener('online',reconnect);void reload();const timer=setInterval(()=>void reload(),3000);return()=>{clearInterval(timer);window.removeEventListener('online',reconnect);};},[reload]);
 return {activity,keys,error,loaded,reload};
}
export type GatewayOverview=ReturnType<typeof useGatewayOverview>;
