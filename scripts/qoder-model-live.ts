// Bounded real-account test through an exported TokenFlow key. No local tools.
import assert from 'node:assert/strict';
import {readdir,readFile,mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.js';
import {qoderQuota} from '../packages/core/src/quota/qoder.js';
assert.equal(process.argv[2],'--live','Explicit --live required');
const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');let credential:any;
for(const file of await readdir(authDir))if(file.endsWith('.json'))try{const d=JSON.parse(await readFile(join(authDir,file),'utf8'));if(d.type==='qoder'&&d.uid==='01a0ccb6-ccdc-7dca-b0d8-b011e824028e')credential=d;}catch{}
assert.ok(credential,'Specified personal account not found');
const quota=async()=>{try{return await qoderQuota.fetch(async request=>{
 const r=await fetch(request.url,{method:request.method,headers:Object.fromEntries(Object.entries(request.header).map(([k,v])=>[k,v.replace('$TOKEN$',credential.access_token)])),signal:AbortSignal.timeout(20000)});
 return {statusCode:r.status,header:{},body:await r.text()};
 },{provider:'qoder'});}catch{return {error:'quota_query_failed'};}};
const root=await mkdtemp(join(await realpath(tmpdir()),'tokenflow-qoder-model-'));let service:Awaited<ReturnType<typeof createDesktopService>>|undefined;
const report:any={at:new Date().toISOString(),account:'specified personal account',before:await quota(),rounds:[]};
try{
 await mkdir(join(root,'cliproxy/auth'),{recursive:true,mode:0o700});await writeFile(join(root,'cliproxy/auth/probe.json'),JSON.stringify(Object.fromEntries(['type','access_token','uid','email','expired','timestamp'].filter(k=>credential[k]!==undefined).map(k=>[k,credential[k]]))),{mode:0o600});
 const net=createServer();await new Promise<void>(r=>net.listen(0,'127.0.0.1',r));const port=(net.address() as {port:number}).port;await new Promise<void>(r=>net.close(()=>r()));
 service=await createDesktopService({root,proxyPort:port,binary:resolve('sidecars/darwin-arm64/cliproxyapi'),token:'isolated-admin',localKey:'isolated-internal',secrets:{get:async()=>'',set:async()=>{}},agentProcesses:async()=>[],agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json')}});
 await service.proxy.start();for(let i=0;i<100&&!service.proxy.snapshot().accounts[0]?.models?.length;i++)await new Promise(r=>setTimeout(r,200));
 const a=service.proxy.snapshot().accounts.find(a=>a.provider==='qoder');
 const model=a?.models?.find(m=>m==='qoder/kmodel_latest')??a?.models?.[0];assert.ok(model,'No discovered model');report.model=model;
 const headers={host:'127.0.0.1:9527',authorization:'Bearer isolated-admin'};
 const key=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'isolated multi-turn acceptance',sourceId:a!.id,models:[model],agents:['claude'],tokenLimit:20000}});
 assert.equal(key.statusCode,200,'Probe key rejected');
 const messages:any[]=[{role:'user',content:'Call probe_lookup exactly once with key first. Wait for the client result before doing anything else.'}];
 for(let turn=0;turn<3;turn++){
  const started=Date.now();const r=await service.app.inject({method:'POST',url:'/v1/messages',headers:{host:'127.0.0.1:9527',authorization:`Bearer ${key.json().apiKey}`},payload:{model,system:'You are the caller agent. Follow this conversation. Only the client executes tools. Include CALLER_POLICY_OK in your final answer after both tool results.',messages,max_tokens:256,thinking:{type:'disabled'},tools:[{name:'probe_lookup',description:'Look up the specified diagnostic marker; the client supplies its result.',input_schema:{type:'object',properties:{key:{type:'string'}},required:['key']}}],tool_choice:turn<2?{type:'tool',name:'probe_lookup',disable_parallel_tool_use:true}:{type:'none'}}});
  const body=r.json();const calls=body.content?.filter((b:any)=>b.type==='tool_use')??[];const answer=body.content?.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('')??'';
  report.rounds.push({turn:turn+1,httpStatus:r.statusCode,durationMs:Date.now()-started,toolCalls:calls.length,keys:calls.map((c:any)=>c.input?.key),usage:body.usage,stopReason:body.stop_reason,...(turn===2?{historyRetained:answer.includes('ALPHA_73')&&answer.includes('BETA_29'),callerPolicyRetained:answer.includes('CALLER_POLICY_OK')}:{}),...(body.error?{errorType:body.error.type}:{} )});
  if(r.statusCode!==200||turn<2&&calls.length!==1)break;
  messages.push({role:'assistant',content:body.content});if(turn<2)messages.push({role:'user',content:[...calls.map((c:any)=>({type:'tool_result',tool_use_id:c.id,content:turn===0?'ALPHA_73':'BETA_29'})),{type:'text',text:turn===0?'Now call probe_lookup exactly once with key second.':'Now report both exact returned values and the required policy marker.'}]});
 }
 report.after=await quota();
 report.accounting=service.proxy.snapshot().logs.filter(line=>line.includes("qoder upstream accounting"));
 report.billingConfirmed=report.accounting.some((line:string)=>/billable=true/.test(line)&&Number(/credits=([\d.e+-]+)/.exec(line)?.[1])>0);
 report.passed=report.billingConfirmed&&report.rounds.length===3&&report.rounds.every((r:any)=>r.httpStatus===200)&&report.rounds[2].historyRetained&&report.rounds[2].callerPolicyRetained;
 if(!report.passed)process.exitCode=1;
}finally{
 await service?.app.close();await mkdir('output/qoder-model',{recursive:true});await writeFile('output/qoder-model/model-live-result.json',JSON.stringify(report,null,2));await rm(root,{recursive:true,force:true});
 console.log(JSON.stringify(report));
}
