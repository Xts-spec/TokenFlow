import {readFile,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';

/** Stores only the user's choice, never an OS permission claim or a decrypted credential. */
export async function rememberedCredentialAccess(root:string){
 try{const saved=JSON.parse(await readFile(join(root,'credential-access.json'),'utf8'));return saved?.version===1&&saved?.allowed===true;}
 catch{return false;}
}
export async function rememberCredentialAccess(root:string,allowed:boolean){
 const path=join(root,'credential-access.json');
 if(!allowed){await rm(path,{force:true});return;}
 const temporary=`${path}.${randomUUID()}.tmp`;
 try{await writeFile(temporary,JSON.stringify({version:1,allowed:true}),{mode:0o600});await rename(temporary,path);}
 finally{await rm(temporary,{force:true});}
}

/** A skipped startup decision must not be bypassed by polling, import, or account switching. */
export function guardCredentialAccess<Args extends unknown[],Result>(allowed:boolean,operation:(...args:Args)=>Promise<Result>){
 return async(...args:Args):Promise<Result>=>{
  if(!allowed)throw new Error('本次启动未允许读取客户端安全存储。请重启 TokenFlow 后选择“允许读取”。');
  return operation(...args);
 };
}
