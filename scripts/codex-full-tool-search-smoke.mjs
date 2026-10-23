// Installed Codex, isolated HOME, synthetic loopback provider. No paid calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
import {codexWebSearch} from '../packages/core/src/codex-web-search.ts';
const root=await mkdtemp(join(await realpath(tmpdir()),'tf-full-tools-'));
const models=['codex/gpt-6-luna','qoder/model'];let child,n=0,toolSent=false,toolBytes=0;const calls=[];
const expected='BEGIN'+'x'.repeat(20000)+'MIDDLE'+'y'.repeat(20000)+'END';
const server=createServer(async(req,res)=>{
 let raw='';for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw),forward=codexWebSearch(body);
 calls.push({model:body.model,clientSearch:body.tools.some(t=>t.type==='web_search'),forwardedSearch:forward.tools.some(t=>t.type==='web_search')});
 let item;const id=++n;
 if(!toolSent){
  const tool=body.tools.find(t=>['exec_command','shell_command','shell'].includes(t.name));assert.ok(tool,'Codex must advertise a shell tool');
  const command=`python3 -c 'print("BEGIN"+"x"*20000+"MIDDLE"+"y"*20000+"END")'`;
  const args=tool.name==='exec_command'?{cmd:command,max_output_tokens:20000}:tool.name==='shell_command'?{command}:{command:['/bin/sh','-c',command]};
  item={id:`fc_${id}`,type:'function_call',call_id:'large_output',name:tool.name,arguments:JSON.stringify(args)};toolSent=true;
 }else{
  const output=body.input.find(i=>i.type==='function_call_output'&&i.call_id==='large_output');
  if(output){const text=typeof output.output==='string'?output.output:JSON.stringify(output.output);toolBytes=Buffer.byteLength(text);assert.ok(text.includes(expected),'tool output was truncated before reaching model');}
  item={id:`msg_${id}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Verified.',annotations:[]}]};
 }
 const response={id:`resp_${id}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:100,output_tokens:20,total_tokens:120}};
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 await writeFile(join(root,'config.toml'),'web_search="live"\n');
 const connections=new AgentConnections(root,{codex:join(root,'config.toml')},async()=>[]);
 await connections.apply({target:'codex',revision:(await connections.status()).find(t=>t.id==='codex').revision,origin,model:models[0],sourceId:'a'.repeat(24),keyId:randomUUID(),key:'fixture',selections:models.map(model=>({model,sourceId:'a'.repeat(24)}))});
 child=spawn(process.argv[2]??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
 let sequence=0,buffer='',complete;const pending=new Map();child.stderr.on('data',()=>{});
 child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}const waiter=pending.get(message.id);if(waiter){pending.delete(message.id);message.error?waiter.reject(Error(JSON.stringify(message.error))):waiter.resolve(message.result);}if(message.method==='turn/completed')complete?.(message.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence,timer=setTimeout(()=>reject(Error('RPC timeout '+method)),15000);pending.set(id,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'full_tool_search_fixture',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const {thread}=await rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});
 for(const model of [models[0],models[1],models[0]]){
  let timer;const done=new Promise((resolve,reject)=>{complete=resolve;timer=setTimeout(()=>reject(Error('Turn timeout')),60000);});
  try{await rpc('turn/start',{threadId:thread.id,model,input:[{type:'text',text:'Run the synthetic read-only output fixture and verify it.'}]});assert.equal((await done).status,'completed');}finally{clearTimeout(timer);}
 }
 assert.ok(toolBytes>40000);assert.ok(calls.every(c=>c.clientSearch));assert.ok(calls.every(c=>c.forwardedSearch===c.model.startsWith('codex/')));
 console.log(JSON.stringify({passed:true,toolBytes,calls,scope:'installed Codex with synthetic loopback upstream'}));
}finally{if(child&&child.exitCode===null){await new Promise(resolve=>{child.once('exit',resolve);child.kill();});}server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
