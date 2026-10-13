// Real installed Codex, synthetic loopback Responses service, isolated history.
// Verifies model switching and persisted thread resume without paid calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,realpath,readFile,mkdir,readdir} from 'node:fs/promises';
import {createServer as netServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.ts';
import {join,resolve} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {parse} from 'smol-toml';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {CodexThreadMigration,codexMigrationClient} from '../packages/core/src/codex-thread-migration.ts';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
const root=await mkdtemp(join(await realpath(tmpdir()),'codex-continuation-'));
const live=process.argv.includes('--live');
const textOnly=process.argv.includes('--text-only');
let liveProvider,liveService;
const liveModel=process.argv.find(v=>v.startsWith('--model='))?.slice(8);
if(live&&!liveModel)throw Error('Live probe requires --model.');
const gatewayModel=liveModel??'workbuddy/hy4-preview';
const calls=[];let child;let originalBase;let responseNumber=0;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'){res.writeHead(405);res.end();return;}
 let text='';for await(const chunk of req)text+=chunk;
 const body=JSON.parse(text||'{}');
 if(!req.url.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 calls.push({path:req.url,body});
 if(live&&!req.url.startsWith('/original/')){const upstream=await fetch(liveProvider.base_url.replace(/\/$/,'')+'/responses',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+liveProvider.experimental_bearer_token},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});res.writeHead(upstream.status,{'content-type':upstream.headers.get('content-type')??'text/event-stream'});for await(const chunk of upstream.body)res.write(chunk);res.end();return;}
 const n=++responseNumber,answer=`REPLY_${n}_MARKER`;
 const item=n===3?{id:`fc_${n}`,type:'function_call',call_id:'read_probe',name:'exec_command',arguments:JSON.stringify({cmd:'cat probe.txt',max_output_tokens:128})}:{id:`msg_${n}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
 const response={id:`resp_${n}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 const events=n===3?[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]:[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:answer},{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:answer},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''));
});
async function start(){
 child=spawn(process.argv[2]??'codex',['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root,OPENAI_BASE_URL:originalBase,OPENAI_API_KEY:'synthetic-openai-key'},stdio:['pipe','pipe','pipe']});
 const proc=child;let buffer='',id=0,turnResolve;const pending=new Map();
 proc.stderr.resume();
 proc.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let msg;try{msg=JSON.parse(line);}catch{continue;}if(pending.has(msg.id)){const wait=pending.get(msg.id);pending.delete(msg.id);msg.error?wait.reject(Error(JSON.stringify(msg.error))):wait.resolve(msg.result);}if(msg.method==='turn/completed')turnResolve?.(msg.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('RPC timeout: '+method)),30000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'continuation_fixture',version:'1.0'}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 return {rpc,turn:async(threadId,model,text,extra=[])=>{let timer;const done=new Promise((resolve,reject)=>{turnResolve=resolve;timer=setTimeout(()=>reject(Error('Turn timeout')),45000)});try{await rpc('turn/start',{threadId,model,input:[{type:'text',text},...extra]});const completed=await done;assert.equal(completed.status,'completed',JSON.stringify(completed.error));}finally{clearTimeout(timer);}},stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill();})};
}
try{
 if(live){
  const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');let credential;
  for(const name of await readdir(authDir)){if(!name.endsWith('.json'))continue;try{const value=JSON.parse(await readFile(join(authDir,name),'utf8'));if(value.type===liveModel.split('/')[0]&&value.access_token&&!value.disabled){credential=value;break;}}catch{}}
  assert.ok(credential,'No active saved credential for live source');const liveRoot=join(root,'live-gateway');await mkdir(join(liveRoot,'cliproxy/auth'),{recursive:true,mode:0o700});
  const isolated=Object.fromEntries(['type','provider','jwt','access_token','uid','email','domain','proxy_url','project_id','expired','expires_in','timestamp'].filter(k=>credential[k]!==undefined).map(k=>[k,credential[k]]));
  await writeFile(join(liveRoot,'cliproxy/auth/probe.json'),JSON.stringify(isolated),{mode:0o600});
  const allocator=netServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=allocator.address().port;await new Promise(r=>allocator.close(r));
  liveService=await createDesktopService({root:liveRoot,proxyPort,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),token:'probe-admin',localKey:'probe-internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:Object.fromEntries(['codex','claude','workbuddy','qoder','deepseek','pi'].map(id=>[id,join(liveRoot,id,'config')])),agentProcesses:async()=>[]});
  await liveService.app.listen({host:'127.0.0.1',port:0});await liveService.proxy.start();const host=`127.0.0.1:${liveService.app.server.address().port}`;
  let source;for(let attempt=0;attempt<15;attempt++){await liveService.proxy.refreshAccounts();source=liveService.proxy.snapshot().accounts.find(a=>a.provider===liveModel.split('/')[0]);if(source?.models?.includes(liveModel))break;await new Promise(r=>setTimeout(r,1000));}
  source=liveService.proxy.snapshot().accounts.find(a=>a.provider===liveModel.split('/')[0]);assert.ok(source?.models?.includes(liveModel),'Live model was not discovered: '+JSON.stringify(source?.models));
  const key=await liveService.app.inject({method:'POST',url:'/api/gateway-keys',headers:{host,authorization:'Bearer probe-admin'},payload:{name:'isolated migration probe',sourceId:source.id,models:[liveModel],agents:['codex']}});assert.equal(key.statusCode,200);
  liveProvider={base_url:`http://${host}/v1`,experimental_bearer_token:key.json().apiKey};
 }
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const paths={codex:join(root,'config.toml'),claude:join(root,'claude.json'),qoder:join(root,'qoder.json'),workbuddy:join(root,'workbuddy.json')};
 const original=`model = "native-fixture"\nmodel_provider = "openai"\nopenai_base_url = "${origin}/original/v1"\n`;originalBase=`${origin}/original/v1`;
 await writeFile(join(root,'auth.json'),JSON.stringify({OPENAI_API_KEY:'synthetic-openai-key'}));await writeFile(paths.codex,original);await writeFile(join(root,'probe.txt'),'MIGRATED_TOOL_READ_OK');
 const connections=new AgentConnections(root,paths,async()=>[]);
 let client=await start();const first=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});const thread=first.thread.id;
 await client.turn(thread,'native-fixture','TURN_ONE_MARKER');await client.stop();
 const fixtureDb=new DatabaseSync(join(root,'state_5.sqlite'));fixtureDb.prepare("update threads set source='vscode' where id=?").run(thread);fixtureDb.close();
 const migration=new CodexThreadMigration(root,paths.codex,async()=>[],home=>codexMigrationClient(home,process.argv[2]));
 await migration.prepare(gatewayModel);assert.equal((await migration.status()).remaining,1);
 const record=await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin,model:gatewayModel,sourceId:'a'.repeat(24),selections:[{model:gatewayModel,sourceId:'a'.repeat(24)}],keyId:randomUUID(),key:'gateway-synthetic-key',modelImages:{[gatewayModel]:true}});
 const callsBeforeResume=calls.length;assert.equal((await migration.migrate(gatewayModel)).migrated,1);
 const resumeDb=new DatabaseSync(join(root,'state_5.sqlite'),{readOnly:true});
 const providerOnly=resumeDb.prepare('select model_provider from threads where id=?').get(thread);resumeDb.close();
 assert.equal(providerOnly.model_provider,'token_flow');assert.equal(calls.length,callsBeforeResume);
 client=await start();const resumedRead=await client.rpc('thread/read',{threadId:thread,includeTurns:false});
 assert.equal(resumedRead.thread.modelProvider,'token_flow');
 await client.rpc('thread/resume',{threadId:thread,model:gatewayModel,modelProvider:resumedRead.thread.modelProvider});
 console.log(JSON.stringify({providerOnlyMigrationPersisted:true,inferenceRequestsDuringMigration:calls.length-callsBeforeResume}));
 await client.turn(thread,gatewayModel,live?'只回复上一轮助手回答中的 REPLY 标记，不调用工具。':'TURN_TWO_MARKER');
 await client.turn(thread,gatewayModel,live?'继续旧对话验收。请调用文件读取工具或 exec_command 只读取当前目录 probe.txt，原样回复内容，'+(textOnly?'':'并说明附图图标的主体颜色。')+'不要访问其他文件，不要修改文件。':'TURN_THREE_MARKER',textOnly?[]:[{type:'image',url:'data:image/png;base64,'+(await readFile(new URL('../apps/console/public/app-icon.png',import.meta.url))).toString('base64')}]);await client.stop();
 const db=new DatabaseSync(join(root,'state_5.sqlite'),{readOnly:true});
 const persisted=db.prepare('select model_provider,model,rollout_path,history_mode from threads where id=?').get(thread);db.close();
 const head=JSON.parse((await readFile(persisted.rollout_path,'utf8')).split('\n')[0]);
 console.log(JSON.stringify({persistedAfterProviderSwitch:{databaseProvider:persisted.model_provider,databaseModel:persisted.model,historyMode:persisted.history_mode,rolloutProvider:head.payload.model_provider}}));
 client=await start();const reread=await client.rpc('thread/read',{threadId:thread,includeTurns:false});
 console.log(JSON.stringify({readAfterRestart:{provider:reread.thread.modelProvider}}));await client.stop();
 if(!live){client=await start();await client.rpc('thread/archive',{threadId:thread});await client.stop();}
 await migration.restore();assert.equal((await migration.status()).restorable,0);await connections.restore(record.id);
 if(!live){
  const restoredDb=new DatabaseSync(join(root,'state_5.sqlite'),{readOnly:true});
  assert.equal(restoredDb.prepare('select archived from threads where id=?').get(thread).archived,1);restoredDb.close();
  client=await start();await client.rpc('thread/unarchive',{threadId:thread});await client.stop();
  console.log(JSON.stringify({archivedThreadRestored:true,archiveStatePreserved:true}));
 }
 client=await start();await client.rpc('thread/resume',{threadId:thread,model:'native-fixture',...(process.argv.includes('--implicit-provider')?{}:{modelProvider:'openai'})});
 await client.turn(thread,'native-fixture','TURN_FOUR_MARKER');await client.stop();
 if(live){const gatewayCalls=calls.filter(c=>!c.path.startsWith('/original/'));assert.ok(gatewayCalls.some(c=>JSON.stringify(c.body.input).includes('MIGRATED_TOOL_READ_OK')),'live tool output missing');if(!textOnly)assert.ok(gatewayCalls.some(c=>c.body.input?.some(i=>i.content?.some?.(p=>p.type==='input_image'))),'live image missing');console.log(JSON.stringify({passed:true,liveUpstream:true,model:gatewayModel,requests:gatewayCalls.length,oldThreadResumed:true,actualFileRead:true,imageSent:!textOnly,restored:true}));}else{
 assert.equal(calls.length,5);assert.ok(calls[3].body.input.some(item=>item.type==='function_call_output'&&JSON.stringify(item).includes('MIGRATED_TOOL_READ_OK')),'file tool output missing');
 assert.ok(calls[2].body.input.some(item=>item.content?.some?.(part=>part.type==='input_image')),'image input was dropped');
 for(let i=0;i<calls.length;i++){
  const {body}=calls[i];assert.ok(!body.previous_response_id,'Client sent a provider-bound previous ID');
  for(let j=1;j<=i;j++){if(j===3)continue;assert.ok(JSON.stringify(body.input).includes(`REPLY_${j}_MARKER`),`Missing assistant turn ${j}`)}
  assert.ok(JSON.stringify(body.input).includes('TURN_ONE_MARKER'));
 }
 console.log(JSON.stringify({providerOverride:!process.argv.includes('--implicit-provider'),paths:calls.map(c=>c.path)}));
 assert.deepEqual(calls.map(c=>c.path),['/original/v1/responses','/v1/responses','/v1/responses','/v1/responses','/original/v1/responses']);
 console.log(JSON.stringify({passed:true,scope:'real Codex; synthetic providers, no live official login',threadResumed:true,steps:calls.map(c=>({path:c.path,model:c.body.model,store:c.body.store,previousResponseId:c.body.previous_response_id??null,inputItems:c.body.input?.length})),allEarlierAssistantTurnsPreserved:true,actualFileToolRead:true,imagePayloadPreserved:true,migrationManagerVerified:true}));
 }
 if(!live){
  await writeFile(paths.codex,original.replace('model = "native-fixture"\n',''));
  const next=await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin,model:gatewayModel,sourceId:'a'.repeat(24),keyId:randomUUID(),key:'gateway-synthetic-key'});
  client=await start();const fresh=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});
  await client.turn(fresh.thread.id,gatewayModel,'GATEWAY_BORN_MARKER');await client.stop();
  const officialDefault=await connections.officialModel(next.id);assert.ok(officialDefault&&!officialDefault.includes('/'));
  await migration.restore(officialDefault);await connections.restore(next.id);
  client=await start();const restored=await client.rpc('thread/resume',{threadId:fresh.thread.id});
  assert.equal(restored.thread.modelProvider,'openai');assert.equal(restored.model,officialDefault);
  await client.turn(fresh.thread.id,'native-fixture','CONTINUE_GATEWAY_BORN_MARKER');await client.stop();
  assert.ok(JSON.stringify(calls.at(-1).body.input).includes('GATEWAY_BORN_MARKER'));
  assert.ok(JSON.stringify(calls.at(-1).body.input).includes('REPLY_6_MARKER'));
  console.log(JSON.stringify({gatewayBornThreadRestored:true,historyPreserved:true,implicitOfficialResume:true}));
 }
}finally{child?.kill();await liveService?.app.close();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
