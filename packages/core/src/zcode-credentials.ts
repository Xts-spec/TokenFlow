import {z} from 'zod';
import {nativeConflict} from './native-accounts.js';
const scopeSchema=z.object({organizationId:z.string().trim().min(1).max(200),projectId:z.string().trim().min(1).max(200),apiKeyId:z.string().trim().min(1).max(200)});
const responseSchema=z.object({code:z.union([z.literal(0),z.literal(200)]),data:z.object({enable:z.literal(true),accessToken:z.string().trim().min(1).max(30000),tokenType:z.literal('Bearer'),expiresIn:z.number().positive(),expiresAt:z.number().positive()})});
/** Native OAuth is a website login, not an inference key. Match the client's
 * project-token exchange and preserve the login for renewing the same grant. */
export async function zcodeProjectCredential(raw:Record<string,unknown>,fetcher:typeof fetch=fetch){
 if(raw.native_oauth!==true&&typeof raw.oauth_access_token!=='string')return raw;
 if(raw.auth_kind==='project_access'&&typeof raw.oauth_access_token==='string'&&typeof raw.expired==='string'&&Date.parse(raw.expired)>Date.now()+60000)return raw;
 const project=scopeSchema.safeParse(raw.native_project);
 if(!project.success)throw nativeConflict('已识别 ZCode 本机登录，但缺少当前账号的编程项目授权。请先在 ZCode 选择官方编程模型，再从本机导入。');
 const origin=raw.provider==='bigmodel'?'https://bigmodel.cn':raw.provider==='zai'?'https://api.z.ai':undefined;
 const token=typeof raw.oauth_access_token==='string'?raw.oauth_access_token:raw.access_token;
 if(!origin||typeof token!=='string'||!token)throw nativeConflict('ZCode 登录区域或授权不完整，请在客户端确认后重试。');
 const {organizationId,projectId,apiKeyId}=project.data;
 let response:Response;
 try{response=await fetcher(`${origin}/api/biz/v1/organization/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(projectId)}/api_keys/${encodeURIComponent(apiKeyId)}/access_tokens`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',Accept:'application/json'},body:JSON.stringify({clientType:'zcode',clientVersion:'3.15.3'}),redirect:'error',signal:AbortSignal.timeout(15000)});}catch{throw nativeConflict('ZCode 项目调用授权暂时不可达，请检查网络后重试；本机登录已保留。');}
 if(response.status===401||response.status===403)throw nativeConflict('ZCode 官方未接受当前项目授权，请在 ZCode 确认登录和编程套餐后重试。');
 const result=responseSchema.safeParse(await response.json().catch(()=>null));
 if(!response.ok||!result.success)throw nativeConflict('ZCode 本机登录已识别，但官方未返回可用的项目调用凭据。请在 ZCode 确认编程模型可用后重试；不能仅凭登录成功判定模型可调用。');
 const expiry=Math.min(result.data.data.expiresAt*1000,Date.now()+result.data.data.expiresIn*1000);
 if(expiry<=Date.now()+60000)throw nativeConflict('ZCode 项目调用授权即将过期，请稍后重新导入。');
 return {...raw,oauth_access_token:token,access_token:result.data.data.accessToken,auth_kind:'project_access',expired:new Date(expiry).toISOString()};
}
