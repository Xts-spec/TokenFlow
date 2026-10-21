import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
import {parse} from 'smol-toml';
// Real Codex app-server, synthetic providers, isolated HOME: no paid model calls.
// Run: node --import tsx scripts/codex-model-switch-compaction-smoke.mjs /path/to/codex
// --regression-window reintroduces the bug and must fail the selected-model assertion.
const root=await mkdtemp(join(await realpath(tmpdir()),'tf-downshift-'));
const binary=process.argv[2]??'codex';
let child,phase=0,n=0;const calls=[];
const old='gpt-6-astra',selected='codex/gpt-6-luna';const progress=[];
const server=createServer(async(req,res)=>{
 let text='';for await(const c of req)text+=c;
 const body=JSON.parse(text||'{}');
 const compact=JSON.stringify(body.input?.at(-1)).includes('CONTEXT CHECKPOINT COMPACTION');
 calls.push({phase,path:req.url,model:body.model,compact,hasFirst:JSON.stringify(body.input).includes('FIRST_MARKER')});
 console.log(JSON.stringify(calls.at(-1)));
 if(phase===1&&body.model!==selected){res.writeHead(403,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:'unauthorized model '+body.model,type:'invalid_request_error',code:'model_not_allowed'}}));return;}
 const id=++n,answer=compact?'SYNTHETIC_SUMMARY preserve FIRST_MARKER':'SYNTHETIC_REPLY preserve FIRST_MARKER';
 const item={id:`msg_${id}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
 const response={id:`resp_${id}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:compact?100:150000,output_tokens:1,total_tokens:compact?101:150001}};
 if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));return;}
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
async function start(){
 const proc=child=spawn(binary,['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 let id=0,buffer='',complete;const pending=new Map();
 proc.stderr.on('data',c=>{if(process.env.DEBUG_FIXTURE)process.stderr.write(c);});
 proc.stdout.on('data',c=>{buffer+=c;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let msg;try{msg=JSON.parse(line);}catch{continue;}const p=pending.get(msg.id);if(p){pending.delete(msg.id);msg.error?p.reject(Error(JSON.stringify(msg.error))):p.resolve(msg.result);}if(msg.params?.item?.type==='contextCompaction')progress.push({phase,method:msg.method});if(msg.method==='turn/completed')complete?.(msg.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id,timer=setTimeout(()=>reject(Error('RPC timeout '+method)),15000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'model_switch_fixture',version:'1'}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 return {rpc,turn:async(threadId,model,text)=>{let timer;const done=new Promise((resolve,reject)=>{complete=resolve;timer=setTimeout(()=>reject(Error('turn timeout')),30000)});try{await rpc('turn/start',{threadId,model,input:[{type:'text',text}]});return await done;}finally{clearTimeout(timer);}},stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill();})};
}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const config=(model,provider,catalog)=>`model = "${model}"\nmodel_provider = "${provider}"\n${catalog?`model_catalog_json = "${catalog}"\n`:''}[model_providers.${provider}]\nname = "TokenFlow"\nbase_url = "${origin}/${provider}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "synthetic-key"\n`;
 await writeFile(join(root,'config.toml'),config(old,'original'));
 let client=await start();const first=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});
 assert.equal((await client.turn(first.thread.id,old,'FIRST_MARKER')).status,'completed');await client.stop();
 const connections=new AgentConnections(root,{codex:join(root,'config.toml')},async()=>[]);
 const record=await connections.apply({target:'codex',revision:(await connections.status()).find(t=>t.id==='codex').revision,origin,model:selected,sourceId:'a'.repeat(24),keyId:randomUUID(),key:'synthetic-key'});
 if(process.argv.includes('--regression-window')){
  const config=parse(await readFile(join(root,'config.toml'),'utf8')),catalog=JSON.parse(await readFile(config.model_catalog_json,'utf8'));
  for(const model of catalog.models)model.context_window=131072;
  await writeFile(config.model_catalog_json,JSON.stringify(catalog));
 }
 phase=1;client=await start();await client.rpc('thread/resume',{threadId:first.thread.id,model:selected,modelProvider:'token_flow'});
 const result=await client.turn(first.thread.id,selected,'SECOND_MARKER');
 console.log(JSON.stringify({status:result.status,error:result.error}));
 assert.ok(calls.filter(c=>c.phase===1).every(c=>c.model===selected),'selected gateway model was replaced by previous model during compaction');assert.equal(result.status,'completed');
 for(let round=1;round<=2;round++)assert.equal((await client.turn(first.thread.id,selected,`GATEWAY_ROUND_${round}`)).status,'completed');
 const oldThreadCalls=calls.filter(c=>c.phase===1);
 assert.ok(oldThreadCalls.every(c=>c.model===selected&&c.hasFirst),'model selection or checkpoint continuity lost');
 const compacted=oldThreadCalls.filter(c=>c.compact).length;
 assert.ok(compacted>=1,'model switch must compact the inherited usage when Codex requests it');
 // body_after_prefix does not require each tiny follow-up to compact again.
 // Repeated tool growth is covered by codex-context-migration-smoke instead.
 assert.equal(progress.filter(p=>p.phase===1&&p.method==='item/started').length,compacted);
 assert.equal(progress.filter(p=>p.phase===1&&p.method==='item/completed').length,compacted);
 // A new thread must use the selected model without a pre-turn compaction.
 phase=2;const fresh=await client.rpc('thread/start',{cwd:root,model:selected,approvalPolicy:'never',sandbox:'read-only'});
 assert.equal((await client.turn(fresh.thread.id,selected,'FRESH_MARKER')).status,'completed');
 assert.deepEqual(calls.filter(c=>c.phase===2).map(c=>[c.model,c.compact]),[[selected,false]]);await client.stop();
 await connections.restore(record.id);phase=3;client=await start();
 await client.rpc('thread/resume',{threadId:first.thread.id,model:old,modelProvider:'original'});
 assert.equal((await client.turn(first.thread.id,old,'RETURN_MARKER')).status,'completed');await client.stop();
 assert.ok(calls.filter(c=>c.phase===3).every(c=>c.model===old&&c.hasFirst));
 console.log(JSON.stringify({passed:true,scope:'installed Codex runtime with synthetic loopback providers',firstCompaction:true,followupTurns:2,clientCompactions:compacted,newThread:true,restoredOriginal:true,modelAuthorizationPreserved:true}));
}finally{child?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));if(process.env.KEEP_FIXTURE)console.log(root);else await rm(root,{recursive:true,force:true});}
