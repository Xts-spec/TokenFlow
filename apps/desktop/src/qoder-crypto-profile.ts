import {mkdtempSync,readFileSync,writeFileSync,lstatSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';

/** Electron initializes Windows OSCrypt from Local State before app.ready.
 * Copy only the DPAPI-wrapped key into an isolated profile, never open Qoder's live profile. */
export type QoderClient='qoder'|'qoder-ide';
export function qoderCryptoProfile(platform:NodeJS.Platform,appData:string,tempRoot=tmpdir(),client:QoderClient='qoder'){
 let state:{os_crypt:{encrypted_key:string;audit_enabled:boolean}}|undefined;
 if(platform==='win32'){
  try{
   const file=join(appData,client==='qoder-ide'?'Qoder':'com.qoder.app.stable','Local State'),info=lstatSync(file);
   if(!info.isFile()||info.size>2*1024*1024)throw Error();
   const key=JSON.parse(readFileSync(file,'utf8'))?.os_crypt?.encrypted_key;
   if(typeof key!=='string'||key.length>20000||!/^[A-Za-z0-9+/]+={0,2}$/.test(key)||!Buffer.from(key,'base64').subarray(0,5).equals(Buffer.from('DPAPI')))throw Error();
   state={os_crypt:{encrypted_key:key,audit_enabled:true}};
  }catch{throw new Error('无法读取 Qoder 本地加密配置，请先在此 Windows 用户下打开一次 Qoder，再刷新登录状态。');}
 }
 const path=mkdtempSync(join(tempRoot,'tokenflow-qoder-crypto-'));
 try{if(state)writeFileSync(join(path,'Local State'),JSON.stringify(state),{mode:0o600,flag:'wx'});return path;}
 catch(error){rmSync(path,{recursive:true,force:true});throw error;}
}
