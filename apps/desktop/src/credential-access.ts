/** A skipped startup decision must not be bypassed by polling, import, or account switching. */
export function guardCredentialAccess<Args extends unknown[],Result>(allowed:boolean,operation:(...args:Args)=>Promise<Result>){
 return async(...args:Args):Promise<Result>=>{
  if(!allowed)throw new Error('本次启动未允许读取客户端安全存储。请重启 TokenFlow 后选择“允许读取”。');
  return operation(...args);
 };
}
