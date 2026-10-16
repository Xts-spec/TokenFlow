import {DatabaseSync} from 'node:sqlite';
import {homedir} from 'node:os';
import {win32,posix} from 'node:path';
import {statSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {z} from 'zod';
const fail=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export function cursorDatabasePath(platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env){
 const p=platform==='win32'?win32:posix;
 const base=platform==='darwin'?p.join(home,'Library','Application Support'):platform==='win32'?(env.APPDATA||p.join(home,'AppData','Roaming')):(env.XDG_CONFIG_HOME||p.join(home,'.config'));
 return p.join(base,'Cursor','User','globalStorage','state.vscdb');
}
/** Read only; a cached email alone is not proof that the client is signed in. */
function readLocalToken(path:string):string|null{
 let db:DatabaseSync|undefined;
 try{
  try{statSync(path);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
  db=new DatabaseSync(path,{readOnly:true});db.exec('PRAGMA busy_timeout=1000');
  const value=db.prepare('SELECT value FROM ItemTable WHERE key=?').get('cursorAuth/accessToken')?.value;
  if(value==null||value==='')return null;
  return z.string().trim().min(1).max(20000).parse(value);
 }catch{throw fail('无法读取本机 Cursor 登录，请检查客户端版本、登录文件权限后重试。');}
 finally{db?.close();}
}
/** Explicit import only. Never refresh, rotate, or write the native IDE session. */
export async function localCursorSession(path=cursorDatabasePath()){
 const accessToken=readLocalToken(path);
 if(!accessToken)throw fail('未找到本机 Cursor 登录，请先在 Cursor 客户端登录，再从本机导入。');
 return verifiedSession(accessToken);
}
async function verifiedSession(accessToken:string){
 const call=async(method:'GetMe'|'CreateUserApiKey',body:unknown={})=>{
  let response:Response;
  try{response=await fetch(`https://api2.cursor.sh/aiserver.v1.DashboardService/${method}`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json','Connect-Protocol-Version':'1'},body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(20000)});}catch{throw fail('连接 Cursor 官方服务失败，请稍后重试。');}
  if(!response.ok)throw fail(response.status===401?'本机 Cursor 登录已过期，请在 Cursor 重新登录。':response.status===403?(method==='CreateUserApiKey'?'此账号不允许创建 SDK Key，请检查 Cursor 套餐或团队权限。':'Cursor 未允许校验此登录，请在客户端确认账号后重试。'):`Cursor 本机登录导入失败（${response.status}），请稍后重试。`);
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

export type CursorLocalStatus={revision:string;loginState:'signed-in'|'signed-out'|'unreadable';email?:string;readError?:string};
/** Only GetMe is used for detection. Cache both success and failure; a changed token invalidates it. */
export class CursorLocalLogin {
 private cache?:{revision:string;checkedAt:number;pending:boolean;result:Promise<CursorLocalStatus>};
 constructor(private path=cursorDatabasePath()){}
 async status(force=false):Promise<CursorLocalStatus>{
  let token:string|null;
  try{token=readLocalToken(this.path);}catch(error){this.cache=undefined;return {revision:'unreadable',loginState:'unreadable',readError:(error as Error).message};}
  if(!token){this.cache=undefined;return {revision:'signed-out',loginState:'signed-out'};}
  const revision=createHash('sha256').update(token).digest('hex');
  if(this.cache?.revision===revision&&(this.cache.pending||!force&&Date.now()-this.cache.checkedAt<300000))return this.cache.result;
  const entry={revision,checkedAt:Date.now(),pending:true,result:Promise.resolve<CursorLocalStatus>({revision,loginState:'unreadable'})};
  entry.result=verifiedSession(token).then(({email}):CursorLocalStatus=>({revision,email,loginState:'signed-in'}),():CursorLocalStatus=>({revision,loginState:'unreadable',readError:'本机 Cursor 登录暂未通过验证，请检查网络或在 Cursor 重新登录后刷新。'})).finally(()=>{entry.checkedAt=Date.now();entry.pending=false;});
  this.cache=entry;
  return entry.result;
 }
}
