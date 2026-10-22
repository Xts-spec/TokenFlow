import {credentialPreference} from './credential-identity.js';
export type QoderAuthorization={id:string;source:string;status:'disabled'|'expired'|'revoked'|'unavailable'|'refreshable'|'usable'|'unverified';preferred:boolean;authorizedAt?:string;refreshedAt?:string;expiresAt?:string};
const date=(value:unknown)=>{if(typeof value!=='string'&&typeof value!=='number')return;const time=typeof value==='number'?(value<1e11?value*1000:value):Date.parse(value);return Number.isFinite(time)?new Date(time).toISOString():undefined;};
/** Public grant metadata only. File mtime is never presented as authorization time. */
export function qoderAuthorization(raw:Record<string,unknown>,account:{id:string;disabled:boolean;authenticationRequired?:boolean;unavailable:boolean;retryable?:boolean;models?:string[]},name:string,preferred:boolean):QoderAuthorization{
 const availability=credentialPreference(raw)[0];
 const status=account.disabled?'disabled':availability===0?'expired':account.authenticationRequired?'revoked':account.unavailable&&!account.retryable?'unavailable':account.models?.length?'usable':availability===1?'refreshable':'unverified';
 return {id:account.id,source:raw.native_client==='qoder-ide'?'Qoder IDE':raw.native_client==='qoder'?'Qoder':name.startsWith('local-qoder-')?'本机导入（客户端未知）':'已保存授权',status,preferred,authorizedAt:date(raw.authorizedAt??raw.authorized_at),refreshedAt:date(raw.last_refresh),expiresAt:date(raw.expired??raw.expires_at)};
}
