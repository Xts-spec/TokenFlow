import {createHmac} from 'node:crypto';
import {readFile,stat} from 'node:fs/promises';
import {join} from 'node:path';
import type {UsageChannel} from './local-usage.js';
import {nativeIdentity} from './local-usage.js';
import {appendGatewayResponseHashes,readGatewayResponseHashes} from './gateway-response-evidence.js';

export type RouteEvidence={threadId:string;time:number;channel:UsageChannel|'gateway'};
/** A nearby inference endpoint in the same thread is evidence; model names and current logins aren't. */
export function routeChannel(routes:readonly RouteEvidence[],threadId:string,time:string):UsageChannel|'gateway'{
 const timestamp=Date.parse(time);const channels=new Set(routes.filter(r=>r.threadId===threadId&&Math.abs(r.time-timestamp)<=120_000).map(r=>r.channel));
 return channels.size===1?[...channels][0]:'unknown';
}
export async function codexRouteEvidence(home:string,gatewayPorts:number[]=[]):Promise<RouteEvidence[]>{
 let db:import('node:sqlite').DatabaseSync|undefined;
 try{
  const {DatabaseSync}=await import('node:sqlite');db=new DatabaseSync(join(home,'logs_2.sqlite'),{readOnly:true});
  const rows=db.prepare("SELECT ts,thread_id,feedback_log_body FROM logs WHERE thread_id IS NOT NULL AND target IN ('codex_http_client::client','codex_api::endpoint::responses_websocket') AND (feedback_log_body LIKE '%/responses%' OR feedback_log_body LIKE '%/chat/completions%') ORDER BY id DESC LIMIT 20000").all();
  const routes:RouteEvidence[]=[];
  for(const row of rows)for(const raw of String(row.feedback_log_body??'').match(/(?:https?|wss?):\/\/[^\s"<>]+/g)??[]){
   let url:URL;try{url=new URL(raw.replace(/[.,;)]+$/,''));}catch{continue;}
   let channel:UsageChannel|'gateway'='unknown';
   if(url.hostname==='chatgpt.com'&&url.pathname==='/backend-api/codex/responses')channel='official';
   if(url.hostname==='api.openai.com'&&/^\/v1\/(responses|chat\/completions)$/.test(url.pathname))channel='api';
   if(['127.0.0.1','localhost','[::1]'].includes(url.hostname)&&gatewayPorts.includes(Number(url.port))&&/^\/v1\/(responses|chat\/completions)$/.test(url.pathname))channel='gateway';
   // Other endpoints are not evidence of authentication. Keep them as conflicts instead of guessing.
   if(/\/(responses|chat\/completions)$/.test(url.pathname))routes.push({threadId:String(row.thread_id),time:Number(row.ts)*1000,channel});
  }return routes;
 }catch{return [];}finally{db?.close();}
}
/** Old traces used a salted response reference. Match exactly without copying messages or response IDs. */
export async function gatewayResponseEvidence(root:string){
 const hashes=await readGatewayResponseHashes(root),discovered=new Set<string>(),refs=new Map<string,Set<string>>();
 try{
  const path=join(root,'gateway-traces.json');if((await stat(path)).size>32*1024*1024)throw Error('large trace file');
  const data=JSON.parse(await readFile(path,'utf8'));if(!/^[a-f0-9]{64}$/.test(data.salt))throw Error('invalid salt');
  for(const row of (data.records??[]).slice(0,1000)){
   if(/^[a-f0-9]{64}$/.test(row.responseHash??'')&&!hashes.has(row.responseHash)){hashes.add(row.responseHash);discovered.add(row.responseHash);}
   if(typeof row.keyId==='string'&&/^[a-f0-9]{64}$/.test(row.responseRef??'')){const set=refs.get(row.keyId)??new Set<string>();set.add(row.responseRef);refs.set(row.keyId,set);}
  }
  // Promote exact legacy matches too, before those traces can expire.
  const matches=(id:string)=>{const hash=nativeIdentity('response',id);if(hashes.has(hash))return true;for(const[key,set]of refs)if(set.has(createHmac('sha256',data.salt).update(`${key}\n${id}`).digest('hex'))){hashes.add(hash);discovered.add(hash);return true;}return false;};
  return {hashes,matches,flush:async()=>{await appendGatewayResponseHashes(root,discovered);discovered.clear();}};
 }catch{return {hashes,matches:(id:string)=>hashes.has(nativeIdentity('response',id)),flush:async()=>{}};}
}
