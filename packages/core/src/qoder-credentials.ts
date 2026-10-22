import {z} from 'zod';
import {credentialEmail} from './credential-identity.js';

const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():undefined;
const uid=(value:unknown)=>text(value)??(typeof value==='number'&&Number.isSafeInteger(value)?String(value):undefined);
export const qoderCredentialSchema=z.object({access_token:z.string().min(1).max(30000),uid:z.string().min(1).max(200),refresh_token:z.string().max(30000).optional(),email:z.string().optional(),expired:z.string().optional()}).passthrough();
export class QoderIdentityError extends Error {
 readonly statusCode=409;
 constructor(message:string,readonly reauthorize=false){super(message);}
}
export function qoderProfile(value:unknown,expected?:string){
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const id=uid(raw.id??raw.user_id??raw.uid);
 if(!id||id.length>200)throw new QoderIdentityError('Qoder 官方资料未返回账号身份，无法恢复此授权，请重新授权。',true);
 if(expected&&id!==expected)throw new QoderIdentityError('Qoder 官方身份与本机登录不一致，请重新授权。',true);
 return {uid:id,...(credentialEmail(raw.email)?{email:credentialEmail(raw.email)}:{})};
}
function expiry(value:unknown){
 if(value===undefined||value===null||value==='')return undefined;
 const n=typeof value==='number'?value:typeof value==='string'&&/^\d+$/.test(value)?Number(value):NaN;
 const ms=Number.isFinite(n)?(n<1e11?n*1000:n):Date.parse(String(value));
 return Number.isFinite(ms)&&ms>0?new Date(ms).toISOString():undefined;
}
/** Convert only known native fields. Do not copy client state or unverified model permissions. */
export function nativeQoderCredential(value:Record<string,unknown>,ide=false){
 const user=ide?value:value.user as Record<string,unknown>|undefined;
 const token=text(value.token),id=uid(user?.id);
 if(!token||!id)throw new QoderIdentityError('未找到完整的 Qoder 本机登录，请先在客户端登录。',true);
 return {access_token:token,uid:id,...(text(value.refreshToken)?{refresh_token:text(value.refreshToken)}:{}),...(expiry(ide?value.expireTime:value.expiresAt)?{expired:expiry(ide?value.expireTime:value.expiresAt)}:{}),...(credentialEmail(user?.email)?{email:credentialEmail(user?.email)}:{})};
}
/** Verify ownership before importing; refresh an expired local access token without changing the client. */
export async function verifyNativeQoder(raw:Record<string,unknown>,fetcher:typeof fetch=fetch){
 let credential={...raw};
 const request=async(path:string,init:RequestInit)=>{
  try{return await fetcher(`https://openapi.qoder.sh${path}`,{...init,redirect:'error',signal:AbortSignal.timeout(15000)});}
  catch{throw new QoderIdentityError('Qoder 官方服务暂不可达，请检查网络后重试；本机登录已保留。');}
 };
 const profile=()=>request('/api/v1/userinfo',{headers:{Accept:'application/json',Authorization:`Bearer ${credential.access_token}`}});
 let response=await profile();
 if(response.status===401&&text(credential.refresh_token)){
  const refreshed=await request('/api/v1/deviceToken/refresh',{method:'POST',headers:{'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({refresh_token:credential.refresh_token,refreshToken:credential.refresh_token})});
  if(refreshed.status===401||refreshed.status===403)throw new QoderIdentityError('Qoder 本机授权已失效，自动刷新失败，请重新授权。',true);
  if(!refreshed.ok)throw new QoderIdentityError('Qoder 授权刷新暂时失败，请稍后重试。');
  let body:Record<string,unknown>;try{const result=await refreshed.json();body={...result,...result.data};}catch{throw new QoderIdentityError('Qoder 授权刷新返回异常，请稍后重试。');}
  const token=text(body.access_token??body.accessToken??body.token??body.device_token??body.deviceToken??body.securityOauthToken);
  if(!token)throw new QoderIdentityError('Qoder 授权刷新未返回令牌，请重新授权。',true);
  credential={...credential,access_token:token,refresh_token:text(body.refresh_token??body.refreshToken)??credential.refresh_token,expired:expiry(body.expires_at??body.tokenExpireTime)??(typeof body.expires_in==='number'?new Date(Date.now()+body.expires_in*1000).toISOString():undefined)};
  response=await profile();
 }
 if(response.status===401||response.status===403)throw new QoderIdentityError('Qoder 官方服务未接受本机授权，无法恢复，请重新授权。',true);
 if(!response.ok)throw new QoderIdentityError('Qoder 官方资料暂时不可用，请稍后重试。');
 let body:unknown;try{body=await response.json();}catch{throw new QoderIdentityError('Qoder 官方资料返回异常，请稍后重试。');}
 return qoderCredentialSchema.parse({...credential,...qoderProfile(body,String(raw.uid))});
}
