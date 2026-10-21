// Installed Codex runtime with an isolated, genuinely large uncompacted history.
// --client-only disables only gateway takeover in this test, not client compaction.
// --live sends synthetic history to the existing local source using codex/gpt-6-luna.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm,realpath,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import YAML from 'yaml';
import {GatewayContext} from '../packages/core/src/gateway-context.ts';
import {CodexContext,codexContextScope,portableCodexItem} from '../packages/core/src/codex-context.ts';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
const root=await mkdtemp(join(await realpath(tmpdir()),'tf-first-long-history-'));
const binary=process.argv[2]??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const clientOnly=process.argv.includes('--client-only'),live=process.argv.includes('--live');
const abort=new AbortController();
const model='codex/gpt-6-luna';const marker='LONG_HISTORY_ANCHOR_'+randomUUID().replaceAll('-','');
const calls=[],upstream=[],progress=[],reports=[];let phase=0,child,responseID=0,turnResult,reply='',seedTools=0;
const context=await GatewayContext.open(root),migration=new CodexContext(root,join(root,'config.toml'),context);
let endpoint,key;
if(live){const config=YAML.parse(await readFile(join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/config.yaml'),'utf8'));endpoint=`http://127.0.0.1:${config.port}/v1/responses`;key=config['api-keys'][0];}
function synthetic(body,answer,tool=false){
 const id=++responseID,item=tool?{id:`fc_${id}`,type:'function_call',call_id:`seed_${id}`,name:'exec_command',arguments:JSON.stringify({cmd:"python3 -c \"print('archive/component.ts: export const value = 42;\\n' * 800)\"",max_output_tokens:16000})}:{id:`msg_${id}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
 const inputTokens=phase===0&&!tool&&process.argv.includes('--known-usage')?150000:100;
 const usage={input_tokens:inputTokens,output_tokens:20,total_tokens:inputTokens+20};
 const response={id:`resp_${id}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage};
 if(!body.stream)return Response.json(response);
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 return new Response(events.map((event,sequence_number)=>`event: ${event.type}\ndata: ${JSON.stringify({...event,sequence_number})}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
}
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw||'{}'),trigger=body.input?.some(item=>item.type==='compaction_trigger'),localCompact=JSON.stringify(body.input?.at(-1)).includes('CONTEXT CHECKPOINT COMPACTION');
 const request={phase,path:req.url,bytes:Buffer.byteLength(raw),items:body.input?.length,trigger:!!trigger,localCompact,model:body.model};calls.push(request);
 if(phase>0||calls.length===1)console.log(JSON.stringify({clientRequest:request}));
 const send=async(_path,forward)=>{
  const summary=forward.instructions?.startsWith('Summarize the supplied'),bytes=Buffer.byteLength(JSON.stringify(forward)),hasAnchor=JSON.stringify(forward.input).includes(marker);
  const entry={phase,summary:!!summary,bytes,hasAnchor,model:forward.model};upstream.push(entry);
  if(phase===0)return synthetic(forward,'Archived directory checks completed.',seedTools++<48);
  if(live){
   const result=await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(forward),signal:abort.signal});
   entry.status=result.status;console.log(JSON.stringify({upstream:entry}));return result;
  }
  // Fixture capacity models a source smaller than the inherited raw history.
  // This is test data, not a production gateway request limit.
  if(bytes>256*1024){entry.status=400;return Response.json({error:{message:'Your input exceeds the context window of this model. Please adjust your input and try again.',type:'invalid_request_error',code:'context_length_exceeded',param:'input'}},{status:400});}
  entry.status=200;return synthetic(forward,summary||localCompact?`Goal: preserve ${hasAnchor?marker:'ANCHOR_MISSING'}. Archived directory checks are complete. Continue with the latest user instruction.`:hasAnchor?marker:'ANCHOR_MISSING');
 };
 try{
  const response=phase===0?await send('responses',body):await context.response(req.url.endsWith('/compact')?'responses/compact':'responses',body,'fixture-key','fixture-source',send,{scope:codexContextScope,connectionId:'test-gateway',...(clientOnly?{}:{threadId:req.headers.session_id??req.headers['session-id']}),recover:item=>migration.recover(item,[]),normalize:portableCodexItem},{onCompaction:report=>reports.push(report)});
  res.writeHead(response.status,Object.fromEntries(response.headers));if(response.body)for await(const chunk of response.body)res.write(chunk);res.end();
 }catch(error){console.log(JSON.stringify({gatewayError:{code:error.code,status:error.statusCode}}));res.writeHead(error.statusCode??500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:error.message,code:error.code}}));}
});
async function start(){
 const proc=child=spawn(binary,['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 let buffer='',sequence=0,complete;const pending=new Map();
 proc.stderr.on('data',()=>{});
 proc.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}const waiting=pending.get(message.id);if(waiting){pending.delete(message.id);message.error?waiting.reject(Error(JSON.stringify(message.error))):waiting.resolve(message.result);}if(message.params?.item?.type==='contextCompaction')progress.push({phase,method:message.method});if(message.method==='item/completed'&&message.params.item.type==='agentMessage')reply+=message.params.item.text??'';if(message.method==='turn/completed')complete?.(message.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('RPC timeout '+method)),30000);pending.set(id,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});proc.stdin.write(JSON.stringify({id,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'first_long_history_fixture',version:'1.0'},capabilities:{experimentalApi:true}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 return {rpc,turn:async(threadId,text)=>{reply='';let timer;const done=new Promise((resolve,reject)=>{complete=resolve;timer=setTimeout(()=>reject(Error('Turn timed out')),live?300000:60000);});try{await rpc('turn/start',{threadId,input:[{type:'text',text}]});return await done;}finally{clearTimeout(timer);}},stop:()=>new Promise(resolve=>{proc.once('exit',resolve);proc.kill();})};
}
try{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
 await writeFile(join(root,'config.toml'),`model = "native-fixture"\nmodel_provider = "original"\nmodel_context_window = 2000000\nmodel_auto_compact_token_limit = 1000000\n[model_providers.original]\nname = "Original fixture"\nbase_url = "${origin}/original/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "fixture-key"\n`);
 let client=await start();const first=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'}),threadId=first.thread.id;
 assert.equal((await client.turn(threadId,`Remember the exact audit marker ${marker} for the final answer. Run the synthetic archived directory checks.`)).status,'completed');await client.stop();
 const rollouts=[];async function find(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const path=join(dir,entry.name);if(entry.isDirectory())await find(path);else if(entry.name.endsWith('.jsonl'))rollouts.push(path);}}await find(join(root,'sessions'));
 const saved=await readFile(rollouts[0],'utf8');assert.ok(!saved.includes('"type":"compacted"')&&!saved.includes('"type":"compaction"'),'fixture must have no summary');assert.ok(saved.includes('archive/component.ts'));
 const history=saved.split('\n').filter(Boolean).map(line=>JSON.parse(line)).filter(event=>event.type==='response_item').map(event=>event.payload);
 console.log(JSON.stringify({history:{items:history.length,bytes:Buffer.byteLength(JSON.stringify(history)),rolloutBytes:Buffer.byteLength(saved),hasSummary:false}}));
 const connections=new AgentConnections(root,{codex:join(root,'config.toml')},async()=>[]);
 await connections.apply({target:'codex',revision:(await connections.status()).find(item=>item.id==='codex').revision,origin,model,sourceId:'a'.repeat(24),keyId:randomUUID(),key:'fixture-key'});
 phase=1;client=await start();await client.rpc('thread/resume',{threadId,model,modelProvider:'token_flow',approvalPolicy:'never',sandbox:'read-only'});
 turnResult=await client.turn(threadId,'Continue the archived task. Reply only with the exact audit marker from the earliest task requirement. Do not call tools or read files.');
 const preserved=reply.includes(marker),clientCompactions=progress.filter(item=>item.phase===1&&item.method==='item/started').length;
 const result={passed:turnResult.status==='completed'&&preserved,clientOnly,live,knownUsage:process.argv.includes('--known-usage'),model,turnStatus:turnResult.status,errorCode:turnResult.error?.codexErrorInfo??null,historyBytes:Buffer.byteLength(JSON.stringify(history)),clientCompactions,gatewayCompactions:reports.length,summaryCalls:upstream.filter(item=>item.summary).length,sourceContextErrors:upstream.filter(item=>item.status===400).length,earliestRequirementPreserved:preserved,requests:calls.filter(item=>item.phase===1),upstream:upstream.filter(item=>item.phase===1)};
 console.log(JSON.stringify(result));await client.stop();
 assert.ok(result.passed,'long uncompacted history did not continue with the earliest requirement');
}finally{abort.abort();child?.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));if(process.env.KEEP_FIXTURE)console.log(JSON.stringify({fixture:root}));else await rm(root,{recursive:true,force:true});}
