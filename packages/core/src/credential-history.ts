import {createHash} from 'node:crypto';
import {mkdir,writeFile,chmod,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {credentialIdentity,credentialFingerprint} from './credential-identity.js';
import type {Secrets} from './service.js';

/** Versioned grants stay outside public snapshots, using the desktop encrypted store when available. */
export class CredentialHistory {
 private writes=Promise.resolve();
 constructor(private root:string,private secrets?:Pick<Secrets,'get'|'set'>){}
 remember(provider:string,records:Record<string,unknown>[]){
  const save=async()=>{
   const unique=new Map(records.map(record=>{const raw=JSON.stringify(record);return [createHash('sha256').update(provider+'\0'+raw).digest('hex'),raw];}));
   const dir=join(this.root,'credential-history');
   for(const [key,raw] of unique){
    const name=`grant-${key}`;
    if(this.secrets){
     if(!await this.secrets.get(name))await this.secrets.set(name,JSON.stringify({provider,savedAt:new Date().toISOString(),credential:JSON.parse(raw)}));
     const index=`auth-history-index-${provider}-${credentialIdentity(provider,JSON.parse(raw))??credentialFingerprint(JSON.parse(raw))}`;
     const entries:string[]=JSON.parse(await this.secrets.get(index)||'[]');if(!entries.includes(name)){entries.push(name);await this.secrets.set(index,JSON.stringify(entries));}
    }
    else{await mkdir(dir,{recursive:true,mode:0o700});await chmod(dir,0o700);try{await writeFile(join(dir,`${key}.json`),JSON.stringify({provider,savedAt:new Date().toISOString(),credential:JSON.parse(raw)}),{mode:0o600,flag:'wx'});}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}}
   }
  };
  const result=this.writes.then(save);this.writes=result.catch(()=>{});return result;
 }
 async forget(provider:string,records:Record<string,unknown>[]){
  await this.writes;
  const identities=new Set(records.map(raw=>credentialIdentity(provider,raw)??credentialFingerprint(raw)));
  if(this.secrets){for(const identity of identities){const index=`auth-history-index-${provider}-${identity}`,entries:unknown=JSON.parse(await this.secrets.get(index)||'[]');
   if(!Array.isArray(entries)||entries.some(name=>typeof name!=='string'||!/^grant-[a-f0-9]{64}$/.test(name)))throw new Error('授权历史索引无法读取。');
   for(const name of entries)await this.secrets.set(name,'');await this.secrets.set(index,'');
  }}else{const dir=join(this.root,'credential-history');for(const name of await readdir(dir).catch(()=>[])){if(!/^[a-f0-9]{64}\.json$/.test(name))continue;const path=join(dir,name),entry=JSON.parse(await readFile(path,'utf8'));if(entry.provider===provider&&identities.has(credentialIdentity(provider,entry.credential)??credentialFingerprint(entry.credential)))await rm(path);}}
 }
}
