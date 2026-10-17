// Invoked by cursor-usage-live.cjs with explicit --live. One tiny real request.
import {mkdtemp,mkdir,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {createDesktopService} from '../packages/core/src/service.js';
import {createNetworkProxy} from '../packages/core/src/network-proxy.js';
import {CursorUsage} from '../packages/core/src/cursor-usage.js';
import {Agent} from '@cursor/sdk';
import {compareCredentials} from '../packages/core/src/credential-identity.js';
if(!process.argv.includes('--live')||!process.send)throw Error('Explicit live helper required');
const input:string[]=[];for await(const chunk of process.stdin)input.push(String(chunk));const {saved,native}=JSON.parse(input.join(''));
let sequence=0;const waiting=new Map<number,(value:string)=>void>();process.on('message',(m:any)=>{const done=waiting.get(m?.id);if(done){waiting.delete(m.id);done(m.result);}});
const network=await createNetworkProxy(url=>new Promise(resolve=>{const id=++sequence;waiting.set(id,resolve);process.send!({type:'resolve-proxy',id,url});}));network.installFetch();
const root=await mkdtemp(join(await realpath(tmpdir()),'tf-cursor-live-')),vault=new Map<string,string>();
let service:Awaited<ReturnType<typeof createDesktopService>>|undefined,createdAgentId:string|undefined,phase='native-identity';
const original=Agent.create;
Agent.create=async(...args)=>{const agent=await original.apply(Agent,args);createdAgentId=agent.agentId;return agent;};
try{
 let nativeEmail:string|undefined;
 try{const token=JSON.parse(native).accessToken;if(token){const r=await fetch('https://api2.cursor.sh/aiserver.v1.DashboardService/GetMe',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json','Connect-Protocol-Version':'1'},body:'{}',signal:AbortSignal.timeout(10000),redirect:'error'});if(r.ok)nativeEmail=(await r.json() as {email?:string}).email?.toLowerCase();}}catch{}
 phase='saved-authorization';const credentials=JSON.parse(saved),all=Array.isArray(credentials.accounts)?credentials.accounts:[credentials];
 const enabled=all.filter((c:any)=>!c.disabled).sort((a:any,b:any)=>compareCredentials({raw:a},{raw:b}));
 const chosen=enabled.find((c:any)=>nativeEmail&&c.email?.toLowerCase()===nativeEmail)??enabled[0];
 if(!chosen?.apiKey)throw Error('No enabled authorization');
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'workspace'));const paths=Object.fromEntries(['codex','claude','qoder','workbuddy','pi','deepseek'].map(p=>[p,join(root,p,p==='codex'?'config.toml':'settings.json')]));
 service=await createDesktopService({root,proxyPort:port,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),token:'live-test-admin',localKey:'live-test-internal',outboundProxyURL:network.url,agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],desktopProcesses:async()=>[],antigravityPath:join(root,'no-antigravity.db'),claudeCredentialStore:null,desktopAccounts:{paths:{workbuddy:join(root,'no-workbuddy'),'workbuddy-ai':join(root,'no-ai'),qoder:join(root,'no-qoder')}},secrets:{get:async name=>name==='cursor-account'?JSON.stringify(chosen):vault.get(name)??'',set:async(name,value)=>{if(name==='cursor-account')throw Error('Read-only Cursor credentials');vault.set(name,value);}}});
 phase='catalog';await service.proxy.start();for(let i=0;i<180;i++){const state=service.proxy.snapshot();if(state.models.some(m=>m.provider==='cursor')||state.accounts.some(a=>a.provider==='cursor'&&a.modelError))break;await new Promise(r=>setTimeout(r,250));}
 const snapshot=service.proxy.snapshot(),source=snapshot.accounts.find(a=>a.provider==='cursor'&&!a.disabled);if(!source)throw Error('Cursor catalog unavailable');
 const models=snapshot.models.filter(m=>m.provider==='cursor'&&source.models?.includes(m.id));const model=models.find(m=>/mini|flash|haiku|luna|grok.*fast/i.test(m.id))??models.find(m=>/auto/i.test(m.id))??models[0];if(!model)throw Error('No available Cursor model');
 phase='isolated-key';const headers={host:'127.0.0.1:9527',authorization:'Bearer live-test-admin'};
 const key=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'Temporary Cursor usage check',sourceId:source.id,models:[model.id],agents:['openai']}});if(key.statusCode!==200)throw Error('Could not create isolated key');
 phase='inference';const start=Date.now();const response=await service.app.inject({method:'POST',url:'/v1/responses',headers:{host:headers.host,authorization:`Bearer ${key.json().apiKey}`},payload:{model:model.id,input:'Reply exactly OK. No tools or explanation.',max_output_tokens:16}});
 const value=response.json();const overview=(await service.app.inject({url:'/api/usage/overview?days=0',headers})).json();const ledger=overview.rows.find((r:any)=>r.sourceId===source.id&&r.model===model.id);
 phase='official-settlement';let official;try{if(createdAgentId)official=await new CursorUsage(chosen.apiKey).runUsage(createdAgentId,start,new AbortController().signal);}catch{}
 const counters=official?{inputTokens:official.inputTokens+official.cacheReadTokens+official.cacheWriteTokens,cachedTokens:official.cacheReadTokens,cacheWriteTokens:official.cacheWriteTokens,outputTokens:official.outputTokens}:undefined;
 console.log(JSON.stringify({check:'cursor-live-usage',status:response.statusCode===200?'completed':'failed',model:model.displayName??model.id,http:response.statusCode,hasText:value.output?.some((o:any)=>o.content?.some((c:any)=>typeof c.text==='string'&&!!c.text.trim()))??false,elapsedMs:Date.now()-start,nativeClientAccountMatched:!!nativeEmail&&nativeEmail===chosen.email?.toLowerCase(),agentHash:createdAgentId?createHash('sha256').update(createdAgentId).digest('hex').slice(0,12):undefined,responseUsage:value.usage,official:counters,ledger:ledger?{requests:ledger.requests,failed:ledger.failed,inputTokens:ledger.inputTokens,outputTokens:ledger.outputTokens,cachedTokens:ledger.cachedTokens,unmeasured:ledger.unmeasured}:undefined,matchesOfficial:!!counters&&counters.inputTokens===ledger?.inputTokens&&counters.outputTokens===ledger?.outputTokens,origin:'gateway',nativeDirectCollector:'pending'}));
 if(response.statusCode!==200||!counters)process.exitCode=1;
}catch{const state=service?.proxy.snapshot();console.log(JSON.stringify({check:'cursor-live-usage',status:'unavailable',phase,backendState:state?.state,cursorAccounts:state?.accounts.filter(a=>a.provider==='cursor').length,cursorModels:state?.models.filter(m=>m.provider==='cursor').length,accountErrors:state?.accounts.filter(a=>a.provider==='cursor').map(a=>a.modelError).filter(Boolean),reason:'隔离后端测试未完成；未修改正常账号、客户端配置或本机用量。'}));process.exitCode=1;}
finally{Agent.create=original;await service?.app.close();await network.close();await rm(root,{recursive:true,force:true});process.disconnect?.();}
