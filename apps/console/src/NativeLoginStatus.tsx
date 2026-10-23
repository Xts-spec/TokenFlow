import {useRef,useState,type ReactNode} from 'react';
import type {useNativeLogin} from './native-login';
import {Icon} from './Icons';

/** Identity belongs on the account; this group only provides status errors and actions. */
export function NativeLoginStatus({name,login,children,showRefresh=true,onRefresh}:{name:string;login:ReturnType<typeof useNativeLogin>;children?:ReactNode;showRefresh?:boolean;onRefresh?:()=>Promise<void>}){
 const lock=useRef(false),[refreshing,setRefreshing]=useState(false),[refreshError,setRefreshError]=useState('');
 const refresh=async()=>{if(lock.current)return;lock.current=true;setRefreshing(true);setRefreshError('');try{await (onRefresh?onRefresh():login.refresh(true));}catch(error){setRefreshError(error instanceof Error?error.message:'刷新失败，请重试。');}finally{lock.current=false;setRefreshing(false);}};
 const status=login.status,message=login.error||(status?.readError?status.readError:!status?'正在读取…':'');
 return <div className="tfNativeLogin" aria-label={`${name} 本机登录操作`}>
  {message&&<span role="status">{message}</span>}
  {children}
  {refreshError&&<span className="tfError" role="alert">{refreshError}</span>}
  {showRefresh&&<button className={`textButton tfNativeRefresh${refreshing?' tfRefreshing':''}`} disabled={refreshing} aria-busy={refreshing} aria-label={`刷新 ${name} ${onRefresh?'账号与额度':'本机登录'}`} title={refreshing?'正在刷新…':onRefresh?'刷新本机登录、账号与额度':'刷新本机登录'} onClick={()=>void refresh()}><Icon name="refresh" size={13}/></button>}
 </div>;
}
