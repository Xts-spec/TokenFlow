import {createHash} from 'node:crypto';
import {workbuddyLoginTarget} from './workbuddy-region.js';

type RecordValue=Record<string,unknown>;
const object=(value:unknown):RecordValue=>value&&typeof value==='object'&&!Array.isArray(value)?value as RecordValue:{};
const text=(value:unknown)=>typeof value==='string'&&value.trim()?value.trim():typeof value==='number'&&Number.isSafeInteger(value)?String(value):undefined;
export const credentialEmail=(value:unknown)=>{const email=text(value);return email&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email.toLowerCase():undefined;};
/** JWT claims are identity hints for grouping saved grants, never authentication or permission checks. */
function claims(value:unknown):RecordValue{try{return object(JSON.parse(Buffer.from(String(value).split('.')[1],'base64url').toString()));}catch{return {};}}
export const credentialSubject=(raw:RecordValue)=>text(raw.uid)??text(raw.user_id)??text(raw.userId)??text(raw.account_uuid)??text(claims(raw.access_token).user_id)??text(claims(raw.access_token).userId)??text(claims(raw.access_token).sub)??text(claims(raw.id_token).sub);
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function credentialIdentity(provider:string,raw:RecordValue,summary:RecordValue={}):string|undefined{
 const id=claims(raw.id_token),access=claims(raw.access_token),auth=object(id['https://api.openai.com/auth']),profile=object(id['https://api.openai.com/profile']);
 const email=credentialEmail(raw.email)??credentialEmail(summary.email)??credentialEmail(id.email)??credentialEmail(profile.email);
 const uid=credentialSubject(raw);
 let person=email??uid,scope:unknown[]=[];
 switch(provider){
  case 'codex': {
   const workspace=text(raw.account_id)??text(auth.chatgpt_account_id)??text(object(summary.id_token).chatgpt_account_id);
   person=email??text(auth.chatgpt_user_id)??text(id.sub);
   if(!workspace||!person)return undefined;scope=[workspace];break;
  }
  case 'claude': scope=[text(raw.organization_uuid)??'',text(raw.account_uuid)??''];break;
  case 'workbuddy': {
   const region=workbuddyLoginTarget(text(raw.domain));if(!region)return undefined;
   scope=[region,text(raw.enterprise_id)??''];break;
  }
  case 'antigravity': scope=[text(raw.project_id)??text(summary.project_id)??''];break;
  case 'kimi': scope=[text(access.region)??''];break;
  case 'trae': scope=[text(raw.host)??''];break;
  case 'zcode': scope=[text(raw.provider)??'zai'];break;
 }
 return person?hash([provider,person,...scope]):undefined;
}
/** Exact grant fingerprint; avoids overwriting an independent OAuth or SDK authorization. */
export function credentialFingerprint(raw:RecordValue){return hash([raw.apiKey??raw.api_key??raw.refresh_token??raw.access_token??raw.token??raw]);}
const timestamp=(value:unknown)=>{if(typeof value==='number'&&Number.isFinite(value))return value<1e11?value*1000:value;if(typeof value==='string'){if(/^\d+$/.test(value))return timestamp(Number(value));const parsed=Date.parse(value);if(Number.isFinite(parsed))return parsed;}return 0;};
export function credentialPreference(raw:RecordValue,modified?:unknown,now=Date.now()):[number,number,number]{
 const expiry=timestamp(raw.apiKeyExpiresAtMs??raw.expired??raw.expires_at??claims(raw.access_token).exp);
 const hasToken=!!(text(raw.apiKey)??text(raw.api_key)??text(raw.access_token)??text(raw.token));
 const availability=!hasToken?0:!expiry||expiry>now?2:text(raw.refresh_token)?1:0;
 const updated=timestamp(raw.authorizedAt??raw.last_refresh??raw.updated_at)||timestamp(claims(raw.access_token).iat)||timestamp(modified);
 return [availability,updated,expiry];
}
export function compareCredentials(a:{raw:RecordValue;modified?:unknown},b:{raw:RecordValue;modified?:unknown}){
 const x=credentialPreference(a.raw,a.modified),y=credentialPreference(b.raw,b.modified);return y[0]-x[0]||y[1]-x[1]||y[2]-x[2];
}
