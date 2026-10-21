// Real installed Codex, synthetic loopback Responses service, isolated history.
// Verifies model switching and persisted thread resume without paid calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {GatewayContext} from '../packages/core/src/gateway-context.ts';
import {CodexContext,codexContextScope} from '../packages/core/src/codex-context.ts';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
const root=await mkdtemp(join(await realpath(tmpdir()),'codex-continuation-'));
const calls=[];let child;let responseNumber=0;let phase=0;let tools=0;let compactions=0;const upstream=[],compactionProgress=[];
const context=await GatewayContext.open(root);
const migration=new CodexContext(root,join(root,'config.toml'),context);
const server=createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 const body=JSON.parse(text||'{}');
 if(!req.url.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 const threadId=req.headers.session_id??req.headers['session-id'];
 calls.push({path:req.url,body,threadId});
 const previousCalls=upstream.length;
 try {
 const send=async(_path,request)=>{
 upstream.push({phase,body:request});
 const summary=request.instructions?.startsWith('Summarize the supplied');
 const trigger=request.input?.some(i=>i.type==='compaction_trigger');
 const toolLimit=phase===1&&process.argv.includes('--auto-only')?0:phase===0&&process.argv.includes('--long-recovery')?20:6;
 const tool=!summary&&!trigger&&(phase===0||phase===1)&&tools++<toolLimit;
 const n=++responseNumber,answer=summary?'CHECKPOINT: Directory checks completed; preserve TURN_ONE_MARKER. '+[...new Set(JSON.stringify(request.input).match(/GATEWAY_REPEAT_\d+_MARKER/g)??[])].join(' '):`REPLY_${phase}_MARKER`;
 const item=trigger?{type:'compaction',encrypted_content:'official-fixture-checkpoint'}:tool?{id:`fc_${n}`,type:'function_call',call_id:`call_${n}`,name:'exec_command',arguments:JSON.stringify({cmd:phase===0&&process.argv.includes('--long-recovery')?"python3 -c \"print('fixture-long-output ' * 2000)\"":'pwd',max_output_tokens:phase===0&&process.argv.includes('--long-recovery')?16000:64})}:{id:`msg_${n}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
 if(trigger)compactions++;
 const output=phase===1&&!summary&&!trigger&&!tool?[{id:`rs_chatcmpl_fixture_${n}`,type:'reasoning',encrypted_content:'',summary:[{type:'summary_text',text:'GATEWAY_REASONING_MARKER'}]},item]:[item];
 const response={id:`resp_${n}`,object:'response',created_at:Math.floor(Date.now()/1000),model:request.model,status:'completed',output,usage:{input_tokens:tool&&tools===toolLimit?(phase===1?70000:12000):100,output_tokens:1,total_tokens:tool&&tools===toolLimit?(phase===1?70001:12001):101}};
 if(!request.stream)return Response.json(response);
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},...output.flatMap((item,output_index)=>[{type:'response.output_item.added',output_index,item},{type:'response.output_item.done',output_index,item}]),{type:'response.completed',response}];
 return new Response(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
 };
 const response=req.url.startsWith('/original')?await send('responses',body):await context.response('responses',body,'fixture-key','fixture-source',send,{scope:codexContextScope,threadId,connectionId:phase>=4?'gateway-return':'gateway-first',recover:item=>migration.recover(item,[])});
 if(!req.url.startsWith('/original')&&calls.filter(call=>!call.path.startsWith('/original')&&call.threadId===threadId).length>1&&phase<4&&!body.input?.some(item=>item.type==='compaction_trigger'))assert.equal(upstream.slice(previousCalls).filter(call=>call.body.instructions?.startsWith('Summarize the supplied')).length,0,'ordinary continuation must wait for Codex to request compaction');
 res.writeHead(response.status,Object.fromEntries(response.headers));for await(const chunk of response.body)res.write(chunk);res.end();
 }catch(error){console.error(error);res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error.message}}));}

});
async function start(){
 child=spawn(process.argv[2]??'codex',['app-server','--listen','stdio://',...(process.argv.includes('--local-compaction')?[]:['-c','model_providers.token_flow.name="OpenAI"'])],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 const proc=child;let buffer='',id=0,turnResolve;const pending=new Map();
 proc.stderr.on('data',chunk=>{if(process.env.DEBUG_FIXTURE)process.stderr.write(chunk);});
 proc.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let msg;try{msg=JSON.parse(line);}catch{continue;}if(pending.has(msg.id)){const wait=pending.get(msg.id);pending.delete(msg.id);msg.error?wait.reject(Error(JSON.stringify(msg.error))):wait.resolve(msg.result);}if(msg.method&&(/compact/i.test(msg.method)||/compact/i.test(msg.params?.item?.type??'')))compactionProgress.push({phase,method:msg.method,itemType:msg.params?.item?.type});if(msg.method==='turn/completed')turnResolve?.(msg.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('RPC timeout: '+method)),30000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'continuation_fixture',version:'1.0'}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 return {rpc,turn:async(threadId,model,text)=>{let timer;const done=new Promise((resolve,reject)=>{turnResolve=resolve;timer=setTimeout(()=>reject(Error('Turn timeout')),45000)});try{await rpc('turn/start',{threadId,model,input:[{type:'text',text}]});assert.equal((await done).status,'completed');}finally{clearTimeout(timer);}},stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill();})};
}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const paths={codex:join(root,'config.toml'),claude:join(root,'claude.json'),qoder:join(root,'qoder.json'),workbuddy:join(root,'workbuddy.json')};
 const original=`model = "native-fixture"\nmodel_provider = "original_fixture"\nmodel_context_window = 32000\nmodel_auto_compact_token_limit = 10000\n[model_providers.original_fixture]\nname = "OpenAI"\nbase_url = "${origin}/original/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "original-synthetic-key"\n`;
 await writeFile(paths.codex,original);
 const connections=new AgentConnections(root,paths,async()=>[]);
 let client=await start();const first=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});const thread=first.thread.id;
 await client.turn(thread,'native-fixture','TURN_ONE_MARKER');await client.stop();
 const record=await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin,model:'qoder/kmodel_latest',sourceId:'a'.repeat(24),selections:[{model:'qoder/kmodel_latest',sourceId:'a'.repeat(24)},{model:'workbuddy/hy4-preview',sourceId:'b'.repeat(24)}],keyId:randomUUID(),key:'gateway-synthetic-key'});
 phase=1;tools=0;client=await start();await client.rpc('thread/resume',{threadId:thread,model:'qoder/kmodel_latest',...(process.argv.includes('--implicit-provider')?{}:{modelProvider:'token_flow'})});
 await client.turn(thread,'qoder/kmodel_latest','TURN_TWO_MARKER');
 if(process.argv.includes('--repeat-gateway'))for(let round=1;round<=2;round++){
  tools=0;await client.turn(thread,'qoder/kmodel_latest',`GATEWAY_REPEAT_${round}_MARKER: preserve API compatibility.`);
 }
 phase=2;await client.turn(thread,'workbuddy/hy4-preview','TURN_THREE_MARKER');await client.stop();
 const migrated=await migration.prepareOfficial([],async()=>[]);if(!process.argv.includes('--local-compaction'))assert.ok(migrated.migrated>0);assert.equal((await migration.prepareOfficial([],async()=>[])).migrated,0);await connections.restore(record.id);phase=3;
 client=await start();await client.rpc('thread/resume',{threadId:thread,model:'native-fixture',...(process.argv.includes('--implicit-provider')?{}:{modelProvider:'original_fixture'})});
 await client.turn(thread,'native-fixture','TURN_FOUR_MARKER');await client.stop();
 const target=(await connections.status())[0];
 const again=await connections.apply({target:'codex',revision:target.revision,origin,model:'qoder/kmodel_latest',sourceId:'a'.repeat(24),keyId:randomUUID(),key:'rotated-synthetic-key'});
 phase=4;client=await start();await client.rpc('thread/resume',{threadId:thread,model:'qoder/kmodel_latest',modelProvider:'token_flow'});await client.turn(thread,'qoder/kmodel_latest','TURN_FIVE_MARKER');await client.stop();
 await migration.prepareOfficial([],async()=>[]);await connections.restore(again.id);
 phase=5;client=await start();await client.rpc('thread/resume',{threadId:thread,model:'native-fixture',modelProvider:'original_fixture'});await client.turn(thread,'native-fixture','TURN_SIX_MARKER');await client.stop();
 assert.ok(compactions>0,'original fixture never compacted');
 assert.ok(calls.some(call=>!call.path.startsWith('/original')&&call.threadId===thread),'Codex must provide a stable thread session header');
 assert.ok(upstream.filter(c=>c.phase===3).every(c=>!c.body.input.some(i=>i.type==='reasoning'&&String(i.id).startsWith('rs_chatcmpl'))),'foreign reasoning leaked back to official provider');
 assert.ok(JSON.stringify(upstream.filter(c=>c.phase===3)).includes('GATEWAY_REASONING_MARKER'),'readable gateway reasoning summary was lost');
 for(const p of [1,2,3,4,5]){
 const requests=upstream.filter(c=>c.phase===p&&!c.body.instructions?.startsWith('Summarize the supplied'));
 assert.ok(requests.length);
 for(const {body} of requests){assert.ok(JSON.stringify(body.input).includes('TURN_ONE_MARKER'));assert.ok(!body.previous_response_id);assert.ok(!body.input.some(i=>i.type==='compaction'),'opaque state leaked to new upstream');}
 }
 assert.ok(upstream.some(c=>c.phase===1&&c.body.input.some(i=>i.type==='function_call_output')),'tool results lost');
 assert.ok(JSON.stringify(upstream.filter(c=>c.phase===3)).includes(process.argv.includes('--local-compaction')?'REPLY_1_MARKER':'CHECKPOINT'),'gateway summary lost on native resume');
 const migrationSummaries=upstream.filter(c=>c.phase===1&&c.body.instructions?.startsWith('Summarize the supplied'));
 if(process.argv.includes('--repeat-gateway')){
  assert.ok(migrationSummaries.length>=3,'repeated gateway turns did not compact again');
  for(const round of [1,2])assert.ok(JSON.stringify(upstream.filter(c=>c.phase===3)).includes(`GATEWAY_REPEAT_${round}_MARKER`),'repeated gateway user constraint lost on official resume');
  const progress=compactionProgress.filter(item=>item.phase===1&&item.itemType==='contextCompaction');
  const started=progress.filter(item=>item.method==='item/started').length,completed=progress.filter(item=>item.method==='item/completed').length;
  assert.ok(started>=2,'Codex did not publish repeated compaction start events');assert.equal(completed,started,'Codex did not complete every compaction lifecycle');
 }
 if(process.argv.includes('--long-recovery')){
  assert.ok(migrationSummaries.length>0,'long history was not summarized');
  for(const call of migrationSummaries)assert.ok(Buffer.byteLength(call.body.input[0].content)<50*1024,'migration summary exceeded bounded chunk size');
 }
 console.log(JSON.stringify({passed:true,scope:'real installed Codex with synthetic providers; no live official login',localCompaction:process.argv.includes('--local-compaction'),longRecovery:process.argv.includes('--long-recovery'),repeatedGateway:process.argv.includes('--repeat-gateway'),originalCompactions:compactions,migrationSummaryCalls:migrationSummaries.length,migrated:migrated.migrated,requests:calls.length,toolHistoryPreserved:true,summaryResumed:true,foreignReasoningRepaired:true,compactionProgress}));

}finally{child?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));if(process.env.KEEP_FIXTURE)console.log(root);else await rm(root,{recursive:true,force:true});}
