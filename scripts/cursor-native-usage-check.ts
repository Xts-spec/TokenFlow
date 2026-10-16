import {Worker} from 'node:worker_threads';
import {mkdtemp,rm,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createDesktopService} from '../packages/core/src/service.js';
import {createNetworkProxy} from '../packages/core/src/network-proxy.js';
import {cursorDatabasePath} from '../packages/core/src/cursor-local.js';
import {cursorConversationHash} from '../packages/core/src/cursor-conversations.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import type {LocalUsageSnapshot} from '../packages/core/src/local-usage.js';
if(!process.argv.includes('--check')||!process.send)throw Error('Explicit helper required');
const chunks=[];for await(const chunk of process.stdin)chunks.push(String(chunk));const saved=chunks.join('');
let seq=0;const waiting=new Map<number,(value:string)=>void>();process.on('message',(m:any)=>{const done=waiting.get(m?.id);if(done){waiting.delete(m.id);done(m.result);}});
const network=await createNetworkProxy(url=>new Promise(resolve=>{const id=++seq;waiting.set(id,resolve);process.send!({type:'resolve-proxy',id,url});}));network.installFetch();
const root=await mkdtemp(join(await realpath(tmpdir()),'tf-cursor-native-check-')),path=cursorDatabasePath(),before=await readFile(path),vault=new Map<string,string>();
let worker:Worker|undefined,service:Awaited<ReturnType<typeof createDesktopService>>|undefined;
try{
 const production=await new Promise<LocalUsageSnapshot>((resolve,reject)=>{
  worker=new Worker(new URL('../dist/local-usage-worker.js',import.meta.url),{workerData:{root,sources:{codex:[join(root,'no-codex')],cursor:[path]}}});const timer=setTimeout(()=>reject(Error('Worker timeout')),15000);
  worker.on('message',state=>{if(!state.scanning){clearTimeout(timer);resolve(state);}});worker.on('error',error=>{clearTimeout(timer);reject(error);});
 });await worker?.terminate();worker=undefined;
 service=await createDesktopService({root,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),token:'check-admin',localKey:'check-internal',cursorLocalPath:path,agentPaths:agentPaths(root),agentProcesses:async()=>[],nativeProcesses:async()=>[],antigravityPath:join(root,'no-antigravity.db'),claudeCredentialStore:null,desktopAccounts:{paths:{workbuddy:join(root,'no-workbuddy'),'workbuddy-ai':join(root,'no-ai'),qoder:join(root,'no-qoder')}},secrets:{get:async name=>name==='cursor-account'?saved:vault.get(name)??'',set:async(name,value)=>{if(name==='cursor-account')throw Error('Read-only authorization');vault.set(name,value);}}});
 await service.proxy.cursor.load();const headers={host:'127.0.0.1:9527',authorization:'Bearer check-admin'};
 let data:any;for(let i=0;i<240;i++){data=(await service.app.inject({url:'/api/usage/overview?days=0',headers})).json();if(!data.scanning)break;await new Promise(resolve=>setTimeout(resolve,250));}
 const native=data.nativeRows.filter((r:any)=>r.target==='cursor'),sum=(field:string)=>native.reduce((n:number,r:any)=>n+(r[field]??0),0),proofs=new Set(production.cursorConversations?.map(c=>c.hash));
 const expected={requests:0,inputTokens:0,outputTokens:0,cachedTokens:0},seen=new Set<string>();let billEvents=0;const end=Date.now(),start=Math.max(end-180*86400000,Math.min(...(production.cursorConversations??[]).map(c=>c.createdAt))-60000);
 for(const source of service.proxy.cursor.nativeUsageReaders()){
  const result=await source.read(start,end,new AbortController().signal);if(!result.complete||source.email&&result.email!==source.email)throw Error();billEvents+=result.events.length;
  for(const event of result.events){if(!event.conversationId||!proofs.has(cursorConversationHash(event.conversationId))||!event.tokenUsage||event.isHeadless||event.cloudAgentId||event.automationId||event.clientType&&/sdk|cli|cloud|headless|automation/i.test(event.clientType)||event.userEmail&&event.userEmail.toLowerCase()!==result.email)continue;const key=`${result.email}:${event.conversationId}:${event.timestamp}:${event.model}`;if(seen.has(key))continue;seen.add(key);const u=event.tokenUsage;expected.requests++;expected.inputTokens+=u.inputTokens+u.cacheReadTokens+u.cacheWriteTokens;expected.outputTokens+=u.outputTokens;expected.cachedTokens+=u.cacheReadTokens;}
 }
 const activity=(await service.app.inject({url:'/api/activity/traces?days=0',headers})).json().records.filter((r:any)=>r.origin==='native'&&r.target==='cursor'),accounts=service.proxy.cursor.snapshot().accounts;
 const matches=Object.entries(expected).every(([key,value])=>sum(key)===value),nativeUnchanged=(await readFile(path)).equals(before);
 const cache=await readFile(join(root,'cursor-native-usage.json'),'utf8'),redacted=!accounts.some(a=>cache.includes(a.label))&&!/apiKey|accessToken|conversationId/.test(cache);
 const passed=!data.scanning&&!data.warning&&expected.requests>0&&matches&&nativeUnchanged&&redacted&&activity.length===expected.requests&&native.every((r:any)=>accounts.some(a=>a.id===r.sourceId));
 console.log(JSON.stringify({check:'cursor-native-usage',status:passed?'passed':'incomplete',productionWorker:production.coverage.find(c=>c.target==='cursor'),localConversations:proofs.size,billEvents,excludedUnmatchedEvents:billEvents-expected.requests,measured:{requests:sum('requests'),inputTokens:sum('inputTokens'),outputTokens:sum('outputTokens'),cachedTokens:sum('cachedTokens')},officialMatched:matches,accountsMatched:native.every((r:any)=>accounts.some(a=>a.id===r.sourceId)),activityRecords:activity.length,gatewayRequests:data.rows.reduce((n:number,r:any)=>n+r.requests,0),nativeDatabaseUnchanged:nativeUnchanged,cacheRedacted:redacted,coverage:data.coverage.find((c:any)=>c.target==='cursor')}));
 if(!passed)process.exitCode=1;
}catch{console.log(JSON.stringify({check:'cursor-native-usage',status:'unavailable',reason:'生产 Worker 或官方账单核对未完成；没有发起推理或修改现有授权。'}));process.exitCode=1;}
finally{await worker?.terminate();await service?.app.close();await network.close();await rm(root,{recursive:true,force:true});process.disconnect?.();}
