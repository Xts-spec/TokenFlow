// Opt-in acceptance: real Codex executes tools in a disposable project, via the official SDK.
import assert from 'node:assert/strict';
import {spawn,type ChildProcessWithoutNullStreams} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';
import {createDesktopService} from '../packages/core/src/service.js';
import {connectedConfig} from '../packages/core/src/agent-connections.js';
import {WorkBuddySDKProvider} from '../packages/core/src/codebuddy.js';
import {runOfficialSDK} from '@token-flow/codebuddy-runtime';

if(process.argv[2]!=='--live')throw new Error('Explicit --live and user authorization required');
const region=process.argv[3]??'china';
const model=process.argv[4]??'workbuddy/deepseek-v4.1-flash';
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-codex-tools-'));
const workspace=join(root,'project'),clientHome=join(root,'codex');
await mkdir(workspace);await mkdir(clientHome);
const proof=randomBytes(12).toString('hex');await writeFile(join(workspace,'input.txt'),proof+'\n');
let service:Awaited<ReturnType<typeof createDesktopService>>|undefined;
let child:ChildProcessWithoutNullStreams|undefined;
const events:any[]=[];const requests:any[]=[];const sdkRuns:any[]=[];
const report:Record<string,unknown>={region,model,passed:false,sourcePolicyBlocked:false};
const marker=async()=>{try{return await readFile(join(workspace,'result.txt'),'utf8');}catch{return undefined;}};
const alloc=createServer();await new Promise<void>(r=>alloc.listen(0,'127.0.0.1',r));const proxyPort=(alloc.address() as {port:number}).port;await new Promise<void>(r=>alloc.close(()=>r()));
console.log(JSON.stringify({event:'start',root,region,model}));
try{
 const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
 const candidates:Record<string,any>[]=[];
 for(const file of await readdir(authDir)){if(!file.endsWith('.json'))continue;try{const v=JSON.parse(await readFile(join(authDir,file),'utf8'));if(v.type==='workbuddy'&&(v.access_token||v.jwt)&&!v.disabled&&(String(v.domain).includes('.ai')?'international':'china')===region)candidates.push(v);}catch{}}
 candidates.sort((a,b)=>Date.parse(b.expired??'')-Date.parse(a.expired??''));assert.ok(candidates[0],'No enabled saved WorkBuddy account');
 const authRoot=join(root,'gateway/cliproxy/auth');await mkdir(authRoot,{recursive:true,mode:0o700});
 await writeFile(join(authRoot,'probe.json'),JSON.stringify(candidates[0]),{mode:0o600});
 service=await createDesktopService({root:join(root,'gateway'),proxyPort,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),token:'probe-admin',localKey:'probe-internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:join(clientHome,'config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/config.yml')},agentProcesses:async()=>[],workbuddySDKFactory:proxy=>new WorkBuddySDKProvider(join(root,'gateway'),(id,m)=>proxy.workbuddyCredential(id,m),async input=>{
  const result=await runOfficialSDK(input);
  if(result.errorCode==='source_policy_blocked')report.sourcePolicyBlocked=true;
  const entry={calls:result.calls.length,failed:result.failed,error:result.errorCode,parallelToolCalls:input.parallelToolCalls,markerExistsBeforeHandoff:(await marker())!==undefined};sdkRuns.push(entry);console.log(JSON.stringify({event:'sdk-return',...entry}));
  return result;
 })});
 service.app.addHook('preHandler',async req=>{
  if(req.url!=='/v1/responses')return;
  const body=req.body as any;const input=Array.isArray(body.input)?body.input:[];
  const results=input.filter((item:any)=>['function_call_output','custom_tool_call_output'].includes(item.type));
  const entry={toolDefinitions:body.tools?.length??0,additionalTools:input.filter((item:any)=>item.type==='additional_tools').length,results:results.length,containsProof:JSON.stringify(results).includes(proof),markerExists:(await marker())!==undefined};requests.push(entry);console.log(JSON.stringify({event:'client-request',...entry}));
 });
 const address=await service.app.listen({host:'127.0.0.1',port:0});await service.proxy.start();
 for(let i=0;i<100&&!service.proxy.snapshot().models.some(m=>m.id===model);i++)await new Promise(r=>setTimeout(r,200));
 const source=service.proxy.snapshot().accounts.find(a=>a.provider==='workbuddy'&&a.models?.includes(model));assert.ok(source,'Selected model is not available');
 const headers={host:new URL(address).host,authorization:'Bearer probe-admin'};
 const key=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'Codex tool roundtrip acceptance',sourceId:source.id,models:[model],agents:['codex']}});assert.equal(key.statusCode,200);
 const config='approval_policy = "never"\nsandbox_mode = "workspace-write"\nweb_search = "disabled"\n[analytics]\nenabled = false\n';
 await writeFile(join(clientHome,'config.toml'),connectedConfig('codex',config,address,model,key.json().apiKey),{mode:0o600});
 child=spawn(process.env.CODEX_TEST_BIN??'codex',['app-server','--listen','stdio://'],{cwd:workspace,env:{PATH:process.env.PATH,LANG:process.env.LANG,TMPDIR:process.env.TMPDIR,CODEX_HOME:clientHome},stdio:['pipe','pipe','pipe']});
 let nextId=0;const pending=new Map<number,{resolve:(v:any)=>void;reject:(e:Error)=>void}>();
 child.stderr.on('data',data=>{if(/11128|unapproved channel/.test(String(data)))report.sourcePolicyBlocked=true;});
 createInterface({input:child.stdout}).on('line',line=>{
  let event:any;try{event=JSON.parse(line);}catch{return;}
  if(event.id!==undefined&&!event.method){const waiter=pending.get(event.id);if(waiter){pending.delete(event.id);event.error?waiter.reject(new Error(JSON.stringify(event.error))):waiter.resolve(event.result);}return;}
  events.push(event);if(/11128|unapproved channel/.test(line))report.sourcePolicyBlocked=true;
  if(event.method==='turn/completed'||event.method==='error')console.log(JSON.stringify({event:event.method,status:event.params?.turn?.status,sourcePolicyBlocked:report.sourcePolicyBlocked}));
  if(event.id!==undefined)child!.stdin.write(JSON.stringify({id:event.id,error:{code:-32601,message:'Unexpected approval: only the disposable project is authorized'}})+'\n');
 });
 child.once('exit',()=>{for(const waiter of pending.values())waiter.reject(new Error('Codex exited'));pending.clear();});
 const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{
  const id=++nextId;const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Codex RPC timeout: '+method));},30000);
  pending.set(id,{resolve:v=>{clearTimeout(timeout);resolve(v);},reject:e=>{clearTimeout(timeout);reject(e);}});child!.stdin.write(JSON.stringify({id,method,params})+'\n');
 });
 await rpc('initialize',{clientInfo:{name:'token_flow_tool_acceptance',version:'1'},capabilities:{experimentalApi:true}});
 const thread=await rpc('thread/start',{cwd:workspace,model,modelProvider:'token_flow',approvalPolicy:'never',sandbox:'workspace-write'});
 await rpc('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Work only in this temporary project. Use one local shell tool call to run exactly this command: "cat input.txt; cp input.txt result.txt". Do not read any other files. After the client returns the command output, reply with the exact token you read from input.txt. Never guess the token or claim the command ran before receiving its tool result.'}]});
 const deadline=Date.now()+240000;let completed:any;
 while(Date.now()<deadline){completed=events.find(e=>e.method==='turn/completed');if(completed||report.sourcePolicyBlocked)break;await new Promise(r=>setTimeout(r,250));}
 report.turnStatus=completed?.params?.turn?.status??'timeout';
 const localCommands=events.filter(e=>e.method==='item/completed'&&e.params?.item?.type==='commandExecution');
 report.localCommands=localCommands.length;
 report.clientReturnedProof=requests.some(r=>r.containsProof);
 report.gatewayDidNotWriteBeforeHandoff=sdkRuns.some(r=>r.calls>0&&!r.markerExistsBeforeHandoff);
 report.markerCorrect=(await marker())===proof+'\n';
 const finalText=events.filter(e=>e.method==='item/completed'&&e.params?.item?.type==='agentMessage').map(e=>e.params.item.text??'').join('\n');
 report.finalContainsProof=finalText.includes(proof);
 assert.equal(report.sourcePolicyBlocked,false,'Upstream returned 11128');
 assert.equal(report.turnStatus,'completed','Codex turn failed or timed out');
 assert.ok(report.localCommands,'No local Codex command execution observed');
 assert.ok(report.clientReturnedProof,'Tool result did not return through the gateway');
 assert.ok(report.gatewayDidNotWriteBeforeHandoff,'No clean pre-handoff observation');
 assert.ok(report.markerCorrect,'Client did not create expected test file');
 assert.ok(report.finalContainsProof,'Model did not use the client tool result');
 report.passed=true;
}catch(error){report.error=error instanceof Error?error.message:'Acceptance failed';process.exitCode=1;}
finally{
 if(child&&child.exitCode===null){const closed=new Promise<void>(r=>child!.once('close',()=>r()));child.kill('SIGTERM');const timer=setTimeout(()=>child!.kill('SIGKILL'),5000);await closed;clearTimeout(timer);}
 await service?.app.close();
 for(const name of ['gateway','codex','claude','qoder','workbuddy','pi','deepseek'])await rm(join(root,name),{recursive:true,force:true,maxRetries:5,retryDelay:200});
 await writeFile(join(root,'report.json'),JSON.stringify({...report,requests,sdkRuns},null,2));console.log(JSON.stringify({...report,reportPath:join(root,'report.json')}));
}
