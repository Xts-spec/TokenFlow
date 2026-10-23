import {spawn} from 'node:child_process';
import {app,safeStorage} from 'electron';
import {readSync,rmSync} from 'node:fs';
import {isAbsolute} from 'node:path';
import {qoderCryptoProfile,type QoderClient} from './qoder-crypto-profile.js';
import type {QoderCrypto} from '../../../packages/core/src/desktop-accounts.js';

/** A separate Electron process initializes Qoder's own OS encryption identity.
 * No credentials enter argv/environment/logs, and TokenFlow's keychain identity stays unchanged. */
export const qoderCryptoFor=(client:QoderClient):QoderCrypto=>async(operation,value)=>{
 const profile=qoderCryptoProfile(process.platform,app.getPath('appData'),undefined,client);
 const environment={...process.env};
 // Node would serialize an undefined value as the literal string "undefined", which
 // makes Electron start as Node and lose safeStorage.
 delete environment.ELECTRON_RUN_AS_NODE;
 let closed=Promise.resolve();
 try{return await new Promise<string>((resolve,reject)=>{
 const child=spawn(process.execPath,[...(app.isPackaged?[]:[app.getAppPath()]),'--tokenflow-qoder-crypto',`--tokenflow-qoder-client=${client}`,`--tokenflow-qoder-profile=${profile}`],{stdio:['pipe','pipe','ignore'],windowsHide:true,env:environment});
 closed=new Promise<void>(resolve=>child.once('close',()=>resolve()));
 let output='';let settled=false;
 const fail=()=>{if(settled)return;settled=true;clearTimeout(timer);child.kill();reject(new Error('Qoder 系统安全存储不可用，请允许系统钥匙串访问后重试。'));};
 const timer=setTimeout(fail,60000);
 child.on('error',fail);child.stdin.on('error',fail);
 child.stdout.on('data',chunk=>{output+=chunk.toString();if(output.length>5_000_000)fail();});
 child.on('close',code=>{if(settled)return;try{const line=output.split('\n').find(l=>l.startsWith('TOKENFLOW_CRYPTO:'));const result=JSON.parse(line?.slice('TOKENFLOW_CRYPTO:'.length)??'null');if(code!==0||typeof result?.value!=='string')return fail();settled=true;clearTimeout(timer);resolve(result.value);}catch{fail();}});
 child.stdin.end(JSON.stringify({operation,value}));
 });}finally{await closed;rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:100});}
};
export const qoderCrypto=qoderCryptoFor('qoder');
export const qoderIdeCrypto=qoderCryptoFor('qoder-ide');
export async function runQoderCrypto(){
 try{
  if(!['darwin','win32'].includes(process.platform))throw Error();
  // Must run before the first await: Electron captures the identity and Windows
  // Local State during initialization, before app.ready.
  const client=process.argv.find(arg=>arg.startsWith('--tokenflow-qoder-client='))?.slice('--tokenflow-qoder-client='.length)??'qoder';
  if(client!=='qoder'&&client!=='qoder-ide')throw Error();
  if(process.platform==='darwin')app.setActivationPolicy('prohibited');
  app.setName(process.platform==='darwin'&&client==='qoder'?'Qoder App':'Qoder');
  const profile=process.argv.find(arg=>arg.startsWith('--tokenflow-qoder-profile='))?.slice('--tokenflow-qoder-profile='.length);
  if(!profile||!isAbsolute(profile))throw Error();
  app.setPath('userData',profile);app.setPath('sessionData',profile);
  // Electron's GUI main process does not deliver piped stdin through process.stdin on Windows.
  const chunks:Buffer[]=[];let total=0;const buffer=Buffer.alloc(64*1024);
  for(;;){const read=readSync(0,buffer,0,buffer.length,null);if(!read)break;total+=read;if(total>4_000_000)throw Error();chunks.push(Buffer.from(buffer.subarray(0,read)));}
  const request=JSON.parse(Buffer.concat(chunks).toString());await app.whenReady();app.dock?.hide();
  if(!safeStorage.isEncryptionAvailable())throw Error();
  let value:string;
  if(request.operation==='encrypt'&&typeof request.value==='string')value=safeStorage.encryptString(request.value).toString('base64');
  else if(request.operation==='decrypt'&&typeof request.value==='string')value=safeStorage.decryptString(Buffer.from(request.value,'base64'));
  else throw Error();
  process.stdout.write(`TOKENFLOW_CRYPTO:${JSON.stringify({value})}\n`,()=>app.exit(0));
 }catch{app.exit(1);}
}
