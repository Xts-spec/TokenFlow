import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';
const fail=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export function cursorDatabasePath(){
 const base=process.platform==='darwin'?join(homedir(),'Library','Application Support'):process.platform==='win32'?(process.env.APPDATA??join(homedir(),'AppData','Roaming')):(process.env.XDG_CONFIG_HOME??join(homedir(),'.config'));
 return join(base,'Cursor','User','globalStorage','state.vscdb');
}
/** Explicit import only. Never refresh, rotate, or write the native IDE session. */
export async function localCursorSession(path=cursorDatabasePath()){
 let db:DatabaseSync|undefined;let accessToken:string;
 try{db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');accessToken=z.string().min(1).max(20000).parse(db.prepare('SELECT value FROM ItemTable WHERE key=?').get('cursorAuth/accessToken')?.value);}
 catch{throw fail('未找到本机 Cursor 登录，请先在 Cursor 客户端登录，再从本机导入。');}
 finally{db?.close();}
 const call=async(method:'GetMe'|'CreateUserApiKey',body:unknown={})=>{
  let response:Response;
  try{response=await fetch(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','Connect-Protocol-Version':'1'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw fail('连接 Cursor 官方服务失败，请稍后重试。');}
  if(!response.ok)throw fail(response.status===401?'本机 Cursor 登录已过期，请在 Cursor 重新登录。':response.status===403?'此账号不允许创建 SDK Key，请检查 Cursor 套餐或团队权限。':`Cursor 本机登录导入失败（${response.status}），请稍后重试。`);
  return response.json();
 };
 let email:string;try{email=z.object({email:z.string().email()}).parse(await call('GetMe')).email;}catch(error){if(error instanceof z.ZodError)throw fail('Cursor 未返回可确认的账号身份，请使用官方授权登录。');throw error;}
 return {email,createCredential:async()=>{
  const apiKeyExpiresAtMs=Date.now()+90*86400000;
  const result=await call('CreateUserApiKey',{name:'token-flow-local-import',expiresAt:String(apiKeyExpiresAtMs)});
  const parsed=z.object({apiKey:z.string().min(1)}).safeParse(result);if(!parsed.success)throw fail('Cursor 未返回 SDK Key，请使用官方授权登录。');
  return {apiKey:parsed.data.apiKey,email,apiKeyExpiresAtMs,disabled:false};
 }};
}
