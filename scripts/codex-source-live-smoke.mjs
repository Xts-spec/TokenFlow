// Explicit opt-in: real Codex app-server and Qoder, with isolated config/workspace.
// No original config writes, refresh-token rotation or provider output dumps.
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,readdir} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createDesktopService} from '../packages/core/src/service.ts';
if(process.argv[2]!=='--live')throw Error('Pass --live to use Qoder credentials and quota.');
const cli=process.argv[3]??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const model=process.argv.find(value=>value.startsWith('--model='))?.slice('--model='.length)??'qoder/kmodel_latest';
assert.match(model,/^qoder\/[a-zA-Z0-9_.-]+$/);
const taskMode=process.argv[4]==='--task';
const progress=[];
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-codex-live-'));
let service,child,timer;const pending=new Map();let sequence=0,buffer='';
try{
 const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
 let credential;
 for(const name of await readdir(authDir))if(name.endsWith('.json')){try{const value=JSON.parse(await readFile(join(authDir,name),'utf8'));if(value.type==='qoder'&&value.access_token&&!value.disabled){credential=value;break;}}catch{}}
 assert.ok(credential,'An enabled Qoder credential is required.');
 const auth=Object.fromEntries(['type','provider','access_token','uid','email','domain','proxy_url','expired','expires_in','timestamp'].filter(k=>credential[k]!==undefined).map(k=>[k,credential[k]]));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true,mode:0o700});await writeFile(join(root,'cliproxy/auth/probe.json'),JSON.stringify(auth),{mode:0o600});
 const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=allocator.address().port;await new Promise(r=>allocator.close(r));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude.json'),workbuddy:join(root,'workbuddy.json'),qoder:join(root,'qoder.json')};
 service=await createDesktopService({root,proxyPort,binary:resolve('sidecars/darwin-arm64/cliproxyapi'),token:'probe-admin',localKey:'probe-local',secrets:{get:async()=>'',set:async()=>{}},agentPaths:paths,agentProcesses:async()=>[]});
 await service.app.listen({host:'127.0.0.1',port:0});await service.proxy.start();
 const host=`127.0.0.1:${service.app.server.address().port}`,headers={host,authorization:'Bearer probe-admin'};
 const source=service.proxy.snapshot().accounts.find(a=>a.provider==='qoder');assert.ok(source?.models?.includes(model));
 const target=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find(t=>t.id==='codex');
 const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId:source.id,model,revision:target.revision}});assert.equal(connected.statusCode,200);
 await mkdir(join(root,'workspace'));const marker=`probe-${randomUUID()}`;await writeFile(join(root,'workspace/probe.txt'),marker);
 if(taskMode){await writeFile(join(root,'workspace/math.cjs'),'exports.add=(a,b)=>a-b;\n');await writeFile(join(root,'workspace/math.test.cjs'),"const assert=require('node:assert/strict');assert.equal(require('./math.cjs').add(2,3),5);console.log('PASS');\n");}
 child=spawn(cli,['app-server','--listen','stdio://'],{cwd:join(root,'workspace'),env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:join(root,'codex'),TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});
 let complete;const done=new Promise((resolve,reject)=>{complete={resolve,reject};});let reply='';let toolCalls=0;
 child.stderr.resume();child.on('error',()=>complete.reject(Error('Codex could not start')));child.on('exit',()=>complete.reject(Error('Codex exited before completion')));
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 child.stdout.on('data',chunk=>{
  buffer+=chunk;let end;
  while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}
   if(message.method==='item/started'||message.method==='item/completed')progress.push({event:message.method,type:message.params?.item?.type});
   if(message.method&&message.id!==undefined&&!pending.has(message.id))progress.push({event:'server-request',method:message.method});
   if(pending.has(message.id)){const call=pending.get(message.id);pending.delete(message.id);message.error?call.reject(Error('Codex RPC request rejected')):call.resolve(message.result);}
   if(message.method==='item/completed'){const item=message.params.item;if(item.type==='agentMessage')reply+=item.text??'';if(item.type==='commandExecution')toolCalls++;}
   if(message.method==='turn/completed')complete.resolve(message.params.turn);
  }
 });
 timer=setTimeout(()=>complete.reject(Error('Native source test timed out')),90000);
 const turn=await Promise.race([(async()=>{
  await rpc('initialize',{clientInfo:{name:'token_flow_source_test',version:'1.0'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const started=await rpc('thread/start',{cwd:join(root,'workspace'),model,approvalPolicy:'never',sandbox:taskMode?'workspace-write':'read-only',ephemeral:true});
  await rpc('turn/start',{threadId:started.thread.id,input:[{type:'text',text:taskMode?'In this temporary workspace only, read math.cjs and math.test.cjs. Fix add(a,b) to add instead of subtract, then run node math.test.cjs and ensure it passes. Finally read probe.txt and include its contents in your reply. Do not access the network or any files outside this temporary workspace.':'Read probe.txt in the current directory, then reply with exactly its contents. Do not modify files or access the network.'}]});return done;
 })(),done]);
 const activity=(await service.app.inject({url:'/api/gateway/activity',headers})).json();
 const requests=activity.recent.map(({status,model,protocol})=>({status,model,protocol}));
 let taskVerified=!taskMode;if(taskMode){await promisify(execFile)(process.execPath,['-e',"const assert=require('node:assert/strict');const {add}=require('./math.cjs');assert.equal(add(8,3),11);assert.equal(add(-3,5),2);assert.equal(add(0,0),0);"],{cwd:join(root,'workspace'),env:{PATH:process.env.PATH}});taskVerified=true;}
 const passed=taskVerified&&turn.status==='completed'&&reply.includes(marker)&&toolCalls>0&&requests.length>=2&&requests.every(r=>r.model===model&&r.status===200&&r.protocol==='responses');
 console.log(JSON.stringify({check:taskMode?'real Codex app-server + Qoder + edit and tests':'real Codex app-server + Qoder + isolated file read',taskVerified,passed,status:turn.status,toolCalls,requests}));assert.ok(passed,'Native Codex did not complete the isolated read.');
}catch(error){console.log(JSON.stringify({check:'Codex source test failure',taskMode,progress:progress.slice(-30),error:error instanceof Error?error.message:'failed'}));throw error;}finally{clearTimeout(timer);child?.kill();await service?.app.close();await rm(root,{recursive:true,force:true});}
