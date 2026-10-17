import {DatabaseSync} from 'node:sqlite';
import {lstat,appendFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {safePath} from './agent-connections.js';
import {nativeIdentity} from './local-usage.js';

export type CursorConversation={hash:string;createdAt:number};
export const cursorConversationHash=(id:string)=>nativeIdentity('cursor-conversation',id);
const validId=(id:unknown):id is string=>typeof id==='string'&&/^[\w-]{1,128}$/.test(id);

/** Select metadata inside SQLite, never return conversation bodies or login keys.
 * Both the current header table and older composerData storage belong to the IDE;
 * SDK agents are not local composers, even when billing says isHeadless=false. */
export async function readCursorConversations(path:string):Promise<CursorConversation[]>{
 for(const p of [path,path+'-wal',path+'-shm'])await safePath(p);
 const info=await lstat(path);if(!info.isFile()||info.size>2*1024**3)throw Error('Unsupported Cursor database');
 const db=new DatabaseSync(path,{readOnly:true});
 try{
  db.exec('PRAGMA busy_timeout=1000;BEGIN');
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name));
  const result=new Map<string,CursorConversation>();let supported=false;
  const accept=(id:unknown,time:unknown)=>{const createdAt=Number(time);if(validId(id)&&Number.isSafeInteger(createdAt)&&createdAt>=946684800000&&createdAt<=Date.now()+86400000){const hash=cursorConversationHash(id),old=result.get(hash);if(!old||createdAt<old.createdAt)result.set(hash,{hash,createdAt});}};
  if(tables.has('composerHeaders')){supported=true;const rows=db.prepare('SELECT composerId,createdAt FROM composerHeaders LIMIT 10001').all();if(rows.length>10000)throw Error('Large Cursor index');for(const row of rows)accept(row.composerId,row.createdAt);}
  if(tables.has('cursorDiskKV')){
   supported=true;
   const rows=db.prepare("SELECT json_extract(value,'$.composerId') AS id,json_extract(value,'$.createdAt') AS time FROM cursorDiskKV WHERE key LIKE 'composerData:%' AND length(value)<=8388608 AND json_valid(value) LIMIT 10001").all();
   if(rows.length>10000)throw Error('Large Cursor index');for(const row of rows)accept(row.id,row.time);
  }
  if(tables.has('ItemTable')){
   // Legacy workspace/global composer headers; no messages are selected.
   const rows=db.prepare("SELECT json_extract(j.value,'$.composerId') AS id,json_extract(j.value,'$.createdAt') AS time FROM ItemTable AS t,json_each(CASE WHEN json_valid(t.value) THEN t.value ELSE '{}' END,'$.allComposers') AS j WHERE t.key IN ('composer.composerData','composer.composerHeaders') AND length(t.value)<=8388608 LIMIT 10001").all();
   if(rows.length>10000)throw Error('Large Cursor index');for(const row of rows)accept(row.id,row.time);
   if(rows.length)supported=true;
  }
  if(!supported)throw Error('Unsupported Cursor conversation schema');return [...result.values()];
 }finally{db.close();}
}

const gatewayPath=(root:string)=>join(root,'cursor-gateway-conversations.jsonl');
/** Persist before running inference. Traces can expire or be cleared; this
 * counter-only exclusion must survive that, restart and later IDE imports. */
export async function rememberCursorGatewayConversation(root:string,id:string,startedAt:number){
 if(!validId(id)||!Number.isSafeInteger(startedAt))throw Error('Invalid Cursor gateway identity');
 const path=gatewayPath(root);await safePath(path);const size=(await lstat(path).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;}))?.size??0;
 if(size>32*1024*1024)throw Error('Cursor gateway evidence is full');
 await appendFile(path,JSON.stringify({hash:cursorConversationHash(id),time:startedAt})+'\n',{mode:0o600});
}
export async function cursorGatewayConversations(root:string):Promise<Set<string>>{
 const path=gatewayPath(root);await safePath(path);let raw:string;
 try{const info=await lstat(path);if(!info.isFile()||info.size>32*1024*1024)throw Error('Large Cursor gateway evidence');raw=await readFile(path,'utf8');}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return new Set();throw e;}
 const result=new Set<string>();for(const line of raw.split('\n')){if(!line)continue;const value=JSON.parse(line);if(!/^[a-f0-9]{64}$/.test(value.hash)||!Number.isSafeInteger(value.time))throw Error('Invalid Cursor gateway evidence');result.add(value.hash);}return result;
}
