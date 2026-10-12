// Subagent inheritance integration check. Run with: node --import tsx scripts/codex-routing-smoke.mjs [path-to-desktop-codex]
// Real Codex app-server, isolated config and a loopback fixture; no account or paid model calls.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AgentConnections } from '../packages/core/src/agent-connections.ts';

const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-codex-routing-'));
const model='qoder/kmodel_latest',alternate='workbuddy/hy4-preview',calls=[],progress=[];
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=raw?JSON.parse(raw):{};for(const item of body.input??[])if(item.type==='function_call_output')progress.push({toolResult:item.output});calls.push({path:req.url,model:body.model,key:req.headers.authorization});
 if(req.url!=='/v1/responses'){res.writeHead(404);res.end('{}');return;}
 let item={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]};
 if(calls.length===1){
  const namespace=body.tools?.find(t=>t.type==='namespace'&&t.tools?.some(f=>f.name==='spawn_agent'));
  const tool=namespace?.tools.find(t=>t.name==='spawn_agent')??body.tools?.find(t=>t.name==='spawn_agent');
  assert.ok(tool,'Codex did not expose the spawn tool');
  item={id:'fc_spawn',type:'function_call',call_id:'call_spawn',name:'spawn_agent',...(namespace?{namespace:namespace.name}:{}),arguments:JSON.stringify({message:'Reply CHILD_ROUTING_PROBE only.'}),status:'completed'};
 }
 const response={id:'resp_fixture',object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 const events=item.type==='function_call'?[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,arguments:'',status:'in_progress'}},{type:'response.function_call_arguments.delta',item_id:item.id,output_index:0,delta:item.arguments},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}]:[{type:'response.created',response:{...response,status:'in_progress',output:[]}},
  {type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},
  {type:'response.content_part.added',item_id:item.id,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}},
  {type:'response.output_text.delta',item_id:item.id,output_index:0,content_index:0,delta:'OK'},
  {type:'response.output_text.done',item_id:item.id,output_index:0,content_index:0,text:'OK'},
  {type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''));
});
let child;
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const paths={codex:join(root,'config.toml'),claude:join(root,'claude.json'),qoder:join(root,'qoder.json'),workbuddy:join(root,'workbuddy.json')};
 const connections=new AgentConnections(root,paths,async()=>[]);
 await writeFile(paths.codex,'model = "native"\n[agents]\ndefault_subagent_model = "native-small"\ndefault_subagent_reasoning_effort = "high"\n');
 await writeFile(join(root,'auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:'native-fixture',access_token:'native-fixture-access',refresh_token:'native-fixture-refresh',id_token:'x.e30.x'}}));
 await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin:`http://127.0.0.1:${server.address().port}`,model,sourceId:'a'.repeat(24),selections:[{model,sourceId:'a'.repeat(24)},{model:alternate,sourceId:'b'.repeat(24)}],keyId:randomUUID(),key:'gateway-fixture-key'});
 child=spawn(process.argv[2]??'codex',['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 let buffer='',stderr='';let sequence=0;const waiting=new Map();let completed;let parentId;
 const finished=new Promise((resolve,reject)=>{completed={resolve,reject};});
 child.stderr.on('data',chunk=>stderr+=chunk);
 child.on('error',error=>completed.reject(error));
 child.on('exit',()=>completed.reject(new Error(`Codex exited: ${stderr.slice(-1500)}`)));
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;waiting.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 child.stdout.on('data',chunk=>{
  buffer+=chunk;let end;
  while((end=buffer.indexOf('\n'))!==-1){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}
   if(waiting.has(message.id)){const pending=waiting.get(message.id);waiting.delete(message.id);message.error?pending.reject(new Error(JSON.stringify(message.error))):pending.resolve(message.result);}
   if(message.method==='turn/completed'||message.method==='thread/started'||message.method==='item/completed')progress.push({method:message.method,keys:Object.keys(message.params??{}),thread:message.params?.threadId,type:message.params?.item?.type});
   if(message.method==='turn/completed'&&message.params.threadId===parentId)completed.resolve(message.params.turn);
  }
 });
 const timeout=setTimeout(()=>completed.reject(new Error(`Codex timed out: ${JSON.stringify({calls,progress})}`)),60000);
 try{
  await Promise.race([(async()=>{
   await rpc('initialize',{clientInfo:{name:'token_flow_test',version:'1.0'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
   const catalog=await rpc('model/list',{});assert.deepEqual(catalog.data.map(m=>m.model),[model,alternate]);
   const started=await rpc('thread/start',{cwd:root,model:alternate,approvalPolicy:'never',sandbox:'read-only',ephemeral:true});
   parentId=started.thread.id;
   await rpc('turn/start',{threadId:started.thread.id,input:[{type:'text',text:'Spawn one subagent to reply CHILD_ROUTING_PROBE. Then reply OK.'}]});
   const turn=await finished;assert.equal(turn.status,'completed',JSON.stringify(turn.error));
   for(let i=0;i<100&&calls.length<3;i++)await new Promise(r=>setTimeout(r,100));
   assert.ok(calls.length>=3,JSON.stringify({calls,progress}));
   assert.ok(calls.every(c=>c.model===alternate&&c.key==='Bearer gateway-fixture-key'));
   assert.equal(stderr.includes('Invalid configuration'),false,stderr.slice(-1500));
   console.log(JSON.stringify({codexSubagentRouting:'passed',requestCount:calls.length,model:alternate,picker:'both models visible; alternate selected at thread start',transport:'local Responses',authentication:'gateway key; saved native login not used'}));
  })(),finished.then(()=>new Promise(()=>{}))]);
 }finally{clearTimeout(timeout);}
}finally{child?.kill();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
