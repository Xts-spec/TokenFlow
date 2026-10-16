import type {ReactNode} from 'react';
import type {useNativeLogin} from './native-login';
import {Icon} from './Icons';

/** Identity belongs on the account; this group only provides status errors and actions. */
export function NativeLoginStatus({name,login,children,showRefresh=true}:{name:string;login:ReturnType<typeof useNativeLogin>;children?:ReactNode;showRefresh?:boolean}){
 const status=login.status,message=login.error||(status?.readError?status.readError:!status?'正在读取…':!login.nativeLabel?'本机未登录':'');
 return <div className="tfNativeLogin" aria-label={`${name} 本机登录操作`}>
  {message&&<span role="status">{message}</span>}
  {children}
  {showRefresh&&<button className="textButton tfNativeRefresh" aria-label={`刷新 ${name} 本机登录`} title="刷新本机登录" onClick={()=>void login.refresh(true)}><Icon name="refresh" size={13}/></button>}
 </div>;
}
