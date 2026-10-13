// Real installed Codex, synthetic loopback Responses service, isolated history.
// Verifies model switching and persisted thread resume without paid calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm,realpath,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
const root=await mkdtemp(join(await realpath(tmpdir()),'codex-continuation-'));
const calls=[];let child;let responseNumber=0;
const server=createServer(async(req,res)=>{
 let text='';for await(const chunk of req)text+=chunk;
 const body=JSON.parse(text||'{}');
 if(!req.url.endsWith('/responses')){res.writeHead(404);res.end('{}');return;}
 calls.push({path:req.url,body});
 const n=++responseNumber,answer=`REPLY_${n}_MARKER`;
 const item={id:`msg_${n}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:answer,annotations:[]}]};
 const response={id:`resp_${n}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:answer},{type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:answer},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''));
});
async function start(){
 child=spawn(process.argv[2]??'codex',['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 const proc=child;let buffer='',id=0,turnResolve;const pending=new Map();
 proc.stderr.resume();
 proc.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let msg;try{msg=JSON.parse(line);}catch{continue;}if(pending.has(msg.id)){const wait=pending.get(msg.id);pending.delete(msg.id);msg.error?wait.reject(Error(JSON.stringify(msg.error))):wait.resolve(msg.result);}if(msg.method==='turn/completed')turnResolve?.(msg.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('RPC timeout: '+method)),30000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});proc.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'continuation_fixture',version:'1.0'}});proc.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 return {rpc,turn:async(threadId,model,text,extra=[])=>{let timer;const done=new Promise((resolve,reject)=>{turnResolve=resolve;timer=setTimeout(()=>reject(Error('Turn timeout')),45000)});try{await rpc('turn/start',{threadId,model,input:[{type:'text',text},...extra]});assert.equal((await done).status,'completed');}finally{clearTimeout(timer);}},stop:()=>new Promise(r=>{proc.once('exit',r);proc.kill();})};
}
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const paths={codex:join(root,'config.toml'),claude:join(root,'claude.json'),qoder:join(root,'qoder.json'),workbuddy:join(root,'workbuddy.json')};
 const original=`model = "native-fixture"\nmodel_provider = "original_fixture"\n[model_providers.original_fixture]\nname = "Original fixture"\nbase_url = "${origin}/original/v1"\nwire_api = "responses"\nrequires_openai_auth = false\nexperimental_bearer_token = "original-synthetic-key"\n`;
 await writeFile(paths.codex,original);
 const connections=new AgentConnections(root,paths,async()=>[]);
 let client=await start();const first=await client.rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});const thread=first.thread.id;
 await client.turn(thread,'native-fixture','TURN_ONE_MARKER');await client.stop();
 const record=await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin,model:'qoder/kmodel_latest',sourceId:'a'.repeat(24),selections:[{model:'qoder/kmodel_latest',sourceId:'a'.repeat(24)},{model:'workbuddy/hy4-preview',sourceId:'b'.repeat(24)}],keyId:randomUUID(),key:'gateway-synthetic-key',modelImages:{'workbuddy/hy4-preview':true}});
 client=await start();
 const catalog=await client.rpc('model/list',{});
 assert.deepEqual(catalog.data.find(m=>m.id==='workbuddy/hy4-preview')?.inputModalities,['text','image']);
 await client.rpc('thread/resume',{threadId:thread,model:'qoder/kmodel_latest',...(process.argv.includes('--pinned-provider')?{modelProvider:'original_fixture'}:process.argv.includes('--implicit-provider')?{}:{modelProvider:'token_flow'})});
 await client.turn(thread,'qoder/kmodel_latest','TURN_TWO_MARKER');
 await client.turn(thread,'workbuddy/hy4-preview','TURN_THREE_MARKER',[{type:'image',url:'data:image/png;base64,'+(await readFile(new URL('../apps/console/public/app-icon.png',import.meta.url))).toString('base64')}]);await client.stop();
 await connections.restore(record.id);
 client=await start();await client.rpc('thread/resume',{threadId:thread,model:'native-fixture',...(process.argv.includes('--implicit-provider')?{}:{modelProvider:'original_fixture'})});
 await client.turn(thread,'native-fixture','TURN_FOUR_MARKER');await client.stop();
 assert.equal(calls.length,4);
 assert.ok(calls[2].body.input.some(item=>item.content?.some?.(part=>part.type==='input_image')),'image input was dropped');
 for(let i=0;i<calls.length;i++){
  const {body}=calls[i];assert.ok(!body.previous_response_id,'Client sent a provider-bound previous ID');
  for(let j=1;j<=i;j++){assert.ok(JSON.stringify(body.input).includes(`REPLY_${j}_MARKER`),`Missing assistant turn ${j}`)}
  assert.ok(JSON.stringify(body.input).includes('TURN_ONE_MARKER'));
 }
 console.log(JSON.stringify({providerOverride:!process.argv.includes('--implicit-provider'),paths:calls.map(c=>c.path)}));
 assert.deepEqual(calls.map(c=>c.path),['/original/v1/responses','/v1/responses','/v1/responses','/original/v1/responses']);
 console.log(JSON.stringify({passed:true,scope:'real Codex; synthetic providers, no live official login',threadResumed:true,steps:calls.map(c=>({path:c.path,model:c.body.model,store:c.body.store,previousResponseId:c.body.previous_response_id??null,inputItems:c.body.input?.length})),allEarlierAssistantTurnsPreserved:true}));
}finally{child?.kill();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
