// Opt-in load test: uses source quota. Isolated credentials/config; records metadata only.
// PROBE_CONCURRENCY=12 PROBE_HISTORY_TURNS=80 PROBE_ROUNDS=4 npx tsx scripts/source-stress-probe.ts --live qoder qoder/kmodel_latest
import {mkdtemp, mkdir, readdir, readFile, writeFile, rm, realpath} from 'node:fs/promises';
import {tmpdir, homedir} from 'node:os';
import {join, resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {WorkBuddySDKProvider} from '../packages/core/src/codebuddy.js';
import {runOfficialSDK} from '@token-flow/codebuddy-runtime';
import {createDesktopService} from '../packages/core/src/service.js';

if(process.argv[2]!=='--live')throw new Error('Pass --live to use saved source credentials and quota.');
const provider=process.argv[3]??'qoder';
assert.ok(['qoder','workbuddy','antigravity'].includes(provider),'Choose an enabled source provider');
const model=process.argv[4]??(provider==='qoder'?'qoder/kmodel_latest':'workbuddy/glm-5.3');
const authDir=process.argv[5]??join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
const concurrency=Number(process.env.PROBE_CONCURRENCY??'1');assert.ok(Number.isInteger(concurrency)&&concurrency>=1&&concurrency<=24,'Probe concurrency must be between 1 and 24');
let credential:Record<string,unknown>|undefined;let accountFingerprint:string|undefined;
for(const file of await readdir(authDir)){
 if(!file.endsWith('.json'))continue;
 const fingerprint=createHash('sha256').update(file).digest('hex').slice(0,12);if(process.env.PROBE_ACCOUNT&&process.env.PROBE_ACCOUNT!==fingerprint)continue;
 try{const value=JSON.parse(await readFile(join(authDir,file),'utf8'));if(value.type===provider&&value.access_token&&!value.disabled){credential=value;accountFingerprint=fingerprint;break;}}catch{/* Unrelated auth files. */}
}
if(!credential)throw new Error('No saved active source credential.');
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-source-live-'));
const nativeFetch=globalThis.fetch;
const requestScope=new AsyncLocalStorage<number>();
const sdkEvents:unknown[]=[];let quotaExhausted=false;
// Test-only instrumentation against the pinned SDK. Synthetic history only;
// redact selected credentials before retaining exceptions, never log CLI input.
const redact=(value:unknown)=>{
 let text=String(value);
 for(const [key,value] of Object.entries(credential!))if(typeof value==='string'&&value.length>3&&/token|jwt|email|uid|proxy|project/i.test(key))text=text.split(value).join('<REDACTED>');
 return text.replace(/Bearer\s+[^\s"']+/gi,'Bearer <REDACTED>').replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g,'<REDACTED>').replace(/https?:\/\/[^\s"']+/g,'<URL>').replace(/\/(?:Users|private|var|tmp)\/[^\s"']+/g,'<PATH>').slice(0,3000);
};
const sdkRequire=createRequire(resolve('packages/codebuddy-runtime/index.js'));
const {Query}=sdkRequire('@tencent-ai/agent-sdk');
const originalIterator=Query.prototype.createIterator;
const {ProcessTransport}=sdkRequire(resolve(sdkRequire.resolve('@tencent-ai/agent-sdk'),'../transport/process-transport.js'));
const originalStart=ProcessTransport.prototype.start;const instrumentedTransports=new WeakSet();
if(provider==='workbuddy')ProcessTransport.prototype.start=function(){
 if(instrumentedTransports.has(this))return originalStart.call(this);instrumentedTransports.add(this);
 const request=requestScope.getStore(),begin=Date.now(),stderr=this.options.stderr;
 const record=(event:Record<string,unknown>)=>sdkEvents.push({request,elapsedMs:Date.now()-begin,...event});
 if(process.env.PROBE_NETWORK==='1')this.options.env={...this.options.env,NODE_OPTIONS:[this.options.env?.NODE_OPTIONS??process.env.NODE_OPTIONS,`--require=${resolve('scripts/workbuddy-network-probe.cjs')}`].filter(Boolean).join(' ')};
 if(process.env.PROBE_FAULT_FIRST==='1'&&request===1)this.options.env={...this.options.env,TF_PROBE_STALL_ONCE:join(root,'injected-once')};
 let lines='';this.options.stderr=(chunk:string)=>{
  lines+=chunk;const complete=lines.split('\n');lines=complete.pop()!;
  for(const line of complete)if(line.startsWith('[TF_NETWORK_PROBE]')){try{record({event:'network',detail:JSON.parse(line.slice('[TF_NETWORK_PROBE]'.length))});}catch{}}else if(/retry|429|timeout|ECONN|EOF|overload|queue|backoff/i.test(line))record({event:'cli_stderr',message:redact(line)});
  stderr?.(chunk);
 };
 record({event:'cli_spawn'});const result=originalStart.call(this);this.process?.once('close',()=>record({event:'cli_exit'}));return result;
};
if(provider==='workbuddy')Query.prototype.createIterator=async function*(){
 const request=requestScope.getStore(),begin=Date.now();
 const record=(event:Record<string,unknown>)=>{const entry={request,elapsedMs:Date.now()-begin,...event};sdkEvents.push(entry);console.log(JSON.stringify({probeSDK:entry}));};
 const deltas:Record<string,{count:number;firstMs:number;lastMs:number;maxGapMs:number}>={};
 try{for await(const message of originalIterator.call(this)){
  if(message.type==='stream_event'&&message.event?.type==='content_block_delta'){
   const kind=String(message.event.delta?.type),now=Date.now()-begin,previous=deltas[kind];
   deltas[kind]=previous?{count:previous.count+1,firstMs:previous.firstMs,lastMs:now,maxGapMs:Math.max(previous.maxGapMs,now-previous.lastMs)}:{count:1,firstMs:now,lastMs:now,maxGapMs:0};
  }
  if(message.type==='stream_event'&&['message_start','message_stop','content_block_start','content_block_stop','message_delta'].includes(message.event?.type))record({event:message.event.type,index:message.event.index,block:message.event.content_block?.type,stopReason:message.event.delta?.stop_reason});
  if(message.type==='system')record({event:'system',subtype:redact(message.subtype)});
  if(message.type==='assistant')record({event:'assistant',model:message.message?.model,blocks:message.message?.content?.map((b:any)=>b.type),tools:message.message?.content?.filter((b:any)=>b.type==='tool_use').map((b:any)=>redact(b.name)),error:message.error?redact(message.error):undefined});
  yield message;
 }}catch(error){if(/额度已用尽|(?:quota|credits) (?:exhausted|exceeded)/i.test(String((error as Error).message)))quotaExhausted=true;record({event:'exception',name:(error as Error).name,message:redact((error as Error).message),errors:(error as any).errors?.map(redact)});throw error;}finally{record({event:'delta_summary',deltas});}
};
let faultProxy:Awaited<ReturnType<typeof import('./antigravity-fault-proxy.js').antigravityFaultProxy>>|undefined;
let service:Awaited<ReturnType<typeof createDesktopService>>|undefined;
try{
const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));
const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
globalThis.fetch=async (...args)=>{
 const response=await nativeFetch(...args);
 if(String(args[0]).startsWith(`http://127.0.0.1:${port}/v1/`)&&!response.ok){
  const text=await response.clone().text();
  let parsed:any;try{parsed=JSON.parse(text);}catch{}
  console.log(JSON.stringify({check:'upstream error',detail:redact(parsed?.error?.message??''),http:response.status,errorCode:parsed?.error?.code,type:parsed?.error?.type,category:/RESOURCE_EXHAUSTED|Resource has been exhausted/.test(text)?'upstream resource exhausted':/cooling down/.test(text)?'upstream cooldown':'other'}));
  const known=['upstream returned no model events','upstream reported an error','model response reported an error','upstream stream ended before completion','upstream stream read failed','invalid model response'];
  console.log(JSON.stringify({check:'sidecar failure category',provider,http:response.status,category:known.find(value=>text.includes(value))??'other'}));
 }
 return response;
};
await mkdir(join(root,'cliproxy/auth'),{recursive:true,mode:0o700});
// Access token only: this isolated probe must never rotate a shared refresh token.
const isolated=Object.fromEntries(['type','provider','jwt','access_token','uid','email','domain','proxy_url','project_id','expired','expires_in','timestamp'].filter(k=>credential![k]!==undefined).map(k=>[k,credential![k]]));
if(process.env.PROBE_PREHEADER_EOF==='1'){assert.equal(provider,'antigravity');faultProxy=await (await import('./antigravity-fault-proxy.js')).antigravityFaultProxy();isolated.base_url=faultProxy.url;}
await writeFile(join(root,'cliproxy/auth/source-probe.json'),JSON.stringify(isolated),{mode:0o600});
const diagnostics:any[]=[];let requestIndex=0;
service=await createDesktopService({workbuddySDKFactory:proxy=>new WorkBuddySDKProvider(root,(id,model)=>proxy.workbuddyCredential(id,model),input=>{const request=++requestIndex;return requestScope.run(request,()=>runOfficialSDK({...input,onDiagnostic:event=>{const record={request,...event};diagnostics.push(record);console.log(JSON.stringify({sdk:record}));}}));}),root,proxyPort:port,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),token:'probe-admin-key',localKey:'probe-internal-key',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{qoder:join(root,'qoder/models.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async()=>[]});
 await service.app.listen({host:'127.0.0.1',port:0});await service.proxy.start();
 const deadline=Date.now()+15000;
 while(Date.now()<deadline&&!service.proxy.snapshot().models.some(m=>m.id===model))await new Promise(r=>setTimeout(r,200));
 const source=service.proxy.snapshot().accounts.find(a=>a.provider===provider);if(!source?.models?.includes(model))console.log(JSON.stringify({check:'available models',models:source?.models}));assert.ok(source?.models?.includes(model),'Requested source model was not discovered');
 const host=`127.0.0.1:${(service.app.server.address() as {port:number}).port}`;
 const keyResponse=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:{host,authorization:'Bearer probe-admin-key'},payload:{name:'isolated source probe',sourceId:source.id,models:[model],agents:['claude','codex','openai']}});
 assert.equal(keyResponse.statusCode,200);const {apiKey}=keyResponse.json();

 const results:any[]=[];
 const replay=process.env.PROBE_REPLAY_LOG?JSON.parse((await readFile(process.env.PROBE_REPLAY_LOG,'utf8')).split('=== REQUEST BODY ===\n')[1]!.split('\n===')[0]!.trim()):undefined;
 if(replay)assert.equal(replay.model,model,'Replay must use the same source model');
 const historyTurns=Number(process.env.PROBE_HISTORY_TURNS??'40');
 const rounds=replay?1:Number(process.env.PROBE_ROUNDS??'3');
 assert.ok(Number.isInteger(historyTurns)&&historyTurns>=0&&historyTurns<=200);
 assert.ok(Number.isInteger(rounds)&&rounds>=1&&rounds<=10);
 await Promise.all(Array.from({length:concurrency},async(_,worker)=>{
 const input:any[]=[];
 for(let i=0;i<historyTurns;i++)input.push({role:'user',content:`Historical step ${i}: inspect the deterministic fixture.`},{type:'function_call',call_id:`old_${worker}_${i}`,name:'read_fixture',arguments:JSON.stringify({step:i})},{type:'function_call_output',call_id:`old_${worker}_${i}`,output:('fixture line '+i+' stable test data. ').repeat(100)},{role:'assistant',content:`Verified step ${i}.`});
 for(let round=0;round<rounds;round++){
 if(quotaExhausted)break;
 input.push({role:'user',content:`Call read_fixture with step ${historyTurns+round}. Do not answer in text.`});
 const protocol=replay?.messages?'chat/completions':'responses';
 const begin=Date.now();const body=replay?{...replay,stream:true,max_output_tokens:1024}:{model,stream:true,max_output_tokens:1024,input,tools:[{type:'function',name:'read_fixture',description:'Read isolated test fixture',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step'],additionalProperties:false}}],tool_choice:{type:'function',name:'read_fixture'}};
 try{
 const response=await fetch(`http://${host}/v1/${protocol}`,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(270000)});
 const text=await response.text();const events=text.split('\n').filter(l=>l.startsWith('data:')).flatMap(l=>{try{return [JSON.parse(l.slice(5))]}catch{return []}});
 const completed=events.find(e=>e.type==='response.completed')??(protocol==='chat/completions'&&text.includes('[DONE]')&&events.some(e=>e.choices?.some((c:any)=>c.finish_reason))?{response:{output:[],usage:events.findLast(e=>e.usage)?.usage}}:undefined);const failed=events.find(e=>e.type==='error'||e.type==='response.failed');const calls=completed?.response?.output?.filter((x:any)=>x.type==='function_call')??[];
 const validCalls=calls.length>0&&calls.every((call:any)=>{try{return call.name==='read_fixture'&&JSON.parse(call.arguments).step===historyTurns+round;}catch{return false;}});
 const result={provider,model,worker,round,http:response.status,bodyBytes:Buffer.byteLength(JSON.stringify(body)),elapsedMs:Date.now()-begin,completed:!!completed,passed:response.ok&&!!completed&&!failed&&(!!replay||validCalls),toolCalls:calls.length,usage:completed?.response?.usage,errorMessage:failed?redact(failed?.message??failed?.error?.message??failed?.response?.error?.message??''):undefined,errorCode:failed?.code??failed?.error?.code??failed?.response?.error?.code,category:/upstream returned no model events/.test(text)?'no_events':/ended before completion/.test(text)?'truncated':/resource.exhausted|rate.limit|cooling down/i.test(text)?'capacity':undefined};results.push(result);console.log(JSON.stringify(result));
 if(!response.ok||!completed||!calls.length||replay)break;
 input.push(...completed.response.output);for(const call of calls)input.push({type:'function_call_output',call_id:call.call_id,output:`fixture step ${JSON.parse(call.arguments).step}: verified worker ${worker}`});
 }catch(e){const result={provider,worker,round,error:e instanceof Error?e.name:'unknown',elapsedMs:Date.now()-begin};results.push(result);console.log(JSON.stringify(result));break;}
 }
 }));
 const summary={provider,model,accountFingerprint,...(faultProxy?{faultReplay:faultProxy.summary}:{}),concurrency,historyTurns:replay?null:historyTurns,replay:!!replay,rounds,quotaStopped:quotaExhausted,requests:results.length,passed:results.filter(r=>r.passed).length,failures:results.filter(r=>!r.passed)};
 console.log(JSON.stringify({summary}));
 if(process.env.PROBE_REPORT)await writeFile(process.env.PROBE_REPORT,JSON.stringify({summary,results,diagnostics,sdkEvents},null,2));
 process.exitCode=summary.passed===concurrency*rounds?0:1;
}finally{ProcessTransport.prototype.start=originalStart;Query.prototype.createIterator=originalIterator;globalThis.fetch=nativeFetch;try{await service?.app.close();}finally{await faultProxy?.close();await rm(root,{recursive:true,force:true});}}
