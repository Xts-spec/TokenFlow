// Installed Codex + the real GatewayContext, with synthetic loopback sources.
// All retry settings and deadlines below belong only to this isolated test.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {zstdDecompressSync} from 'node:zlib';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse,stringify} from 'smol-toml';
import {GatewayContext} from '../packages/core/src/gateway-context.ts';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
import {codexContextScope,portableCodexItem} from '../packages/core/src/codex-context.ts';

const root=await mkdtemp(join(await realpath(tmpdir()),'tf-checkpoint-native-'));
const binary=process.argv[2]??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const model='qoder/checkpoint-fixture',context=await GatewayContext.open(root);
const localCompaction=process.argv.includes('--local-compaction');
let child,failSummary=false,serial=0,summaryCalls=0,normalCalls=0;
const checkpoints=[],notifications=[];
const server=createServer(async(req,res)=>{
 try{
  const chunks=[];for await(const c of req)chunks.push(c);let raw=Buffer.concat(chunks);
  if(req.headers['content-encoding']==='zstd')raw=zstdDecompressSync(raw);
  const body=JSON.parse(raw.toString());
  const response=await context.response('responses',body,'fixture-key','fixture-source',async(_path,request)=>{
   const compact=request.instructions?.startsWith('Summarize the supplied')||JSON.stringify(request.input?.at(-1)).includes('CONTEXT CHECKPOINT COMPACTION');if(compact)summaryCalls++;else normalCalls++;
   if(compact&&failSummary)return Response.json({error:{code:'rate_limit_exceeded',message:JSON.stringify({error:{code:'qoder_capacity_wait_exhausted'}})}},{status:429});
   const text=compact?'ORIGINAL_FACT: keep the API. Completed work retained; continue remaining steps.':'ORIGINAL_FACT: keep the API. '+ 'Synthetic completed step. '.repeat(600);
   const n=++serial,item={id:`msg_${n}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]};
   const terminal={id:`upstream_${n}`,object:'response',model,status:'completed',output:[item],usage:{input_tokens:1000,output_tokens:100,total_tokens:1100}};
   if(!request.stream)return Response.json(terminal);
   return new Response([{type:'response.created',response:{...terminal,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response:terminal}].map((event,sequence_number)=>`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number})}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
  },{scope:codexContextScope,threadId:req.headers.session_id??'fixture-thread',normalize:portableCodexItem,recover:async()=>{throw Error('Unexpected foreign checkpoint');}});
  const text=await response.text();
  for(const line of text.split('\n').filter(l=>l.startsWith('data: '))){const event=JSON.parse(line.slice(6));if(event.type==='response.completed')for(const item of event.response.output??[])if(item.type==='compaction'){
   const restored=context.decodeCheckpoint(item.encrypted_content,[codexContextScope]);const count=restored.filter(i=>JSON.stringify(i).includes('Historical task checkpoint (summary of earlier work):')).length;
   checkpoints.push({summaryCount:count,bytes:Buffer.byteLength(JSON.stringify(restored))});assert.equal(count,1);assert.ok(JSON.stringify(restored).includes('ORIGINAL_FACT'));
  }}
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(text);
 }catch(error){res.writeHead(error.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({error:{code:error.code??'test_error',message:error.message,type:'context_error'}}));}
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const config=join(root,'config.toml');await writeFile(config,'');
 const connections=new AgentConnections(root,{codex:config},async()=>[]);
 await connections.apply({target:'codex',revision:(await connections.status()).find(t=>t.id==='codex').revision,origin:`http://127.0.0.1:${server.address().port}`,model,sourceId:'a'.repeat(24),keyId:'fixture-key',key:'synthetic-fixture'});
 const settings=parse(await readFile(config,'utf8'));Object.assign(settings.model_providers.token_flow,{name:localCompaction?'TokenFlow':'OpenAI',request_max_retries:0,stream_max_retries:0});await writeFile(config,stringify(settings));
 child=spawn(binary,['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 let buffer='',id=0;const pending=new Map();child.stderr.on('data',()=>{});
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}const task=pending.get(message.id);if(task){pending.delete(message.id);message.error?task.reject(Error(JSON.stringify(message.error))):task.resolve(message.result);}else if(message.method)notifications.push(message);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('Test RPC timed out: '+method)),15000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v);},reject:e=>{clearTimeout(timer);reject(e);}});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 const waitFor=async(predicate)=>{const until=Date.now()+30000;while(Date.now()<until){const found=notifications.find(predicate);if(found)return found;await new Promise(r=>setTimeout(r,20));}throw Error('Test notification did not arrive');};
 await rpc('initialize',{clientInfo:{name:'checkpoint_regression',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const {thread}=await rpc('thread/start',{cwd:root,model,approvalPolicy:'never',sandbox:'read-only'});
 for(let round=0;round<3;round++){
  for(let turn=0;turn<6;turn++){
   const started=await rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:`Continue fixture round ${round} step ${turn}`}],model});
   const done=await waitFor(n=>n.method==='turn/completed'&&n.params.turn.id===started.turn.id);assert.equal(done.params.turn.status,'completed');
   if(round===0&&turn===0)assert.equal(summaryCalls,0,'New chat was compacted');
  }
  const from=notifications.length;await rpc('thread/compact/start',{threadId:thread.id});
  await waitFor((n)=>notifications.indexOf(n)>=from&&n.method==='item/completed'&&n.params.item.type==='contextCompaction');
  await waitFor(n=>notifications.indexOf(n)>=from&&n.method==='turn/completed');
 }
 assert.equal(checkpoints.length,localCompaction?0:3);assert.ok(checkpoints.every(c=>c.summaryCount===1));if(localCompaction)assert.equal(summaryCalls,3);
 // Add uncached work so the next compact reaches the failing source rather
 // than correctly reusing the checkpoint produced by the previous request.
 for(let turn=0;turn<6;turn++){
  const started=await rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:`New uncached work ${turn}`}],model});
  const done=await waitFor(n=>n.method==='turn/completed'&&n.params.turn.id===started.turn.id);assert.equal(done.params.turn.status,'completed');
 }
 failSummary=true;const from=notifications.length;await rpc('thread/compact/start',{threadId:thread.id});
 const error=await waitFor(n=>notifications.indexOf(n)>=from&&n.method==='error');
 const message=JSON.stringify(error.params);assert.ok(message.includes('Qoder 当前模型容量不足'),message);assert.ok(message.includes('选择其他模型'),message);
 console.log(JSON.stringify({passed:true,localCompaction,normalCalls,summaryCalls,checkpoints,qoderAdviceReachedCodex:true,error:JSON.parse(message).error?.message??message,scope:'installed Codex, real GatewayContext, synthetic sources, isolated HOME'}));
}finally{
 if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
}
