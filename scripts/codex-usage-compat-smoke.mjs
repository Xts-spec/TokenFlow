// Installed Codex's actual integer deserializer, synthetic loopback upstream.
// No account credentials or real conversations are read; no paid calls occur.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {GatewayContext} from '../packages/core/src/gateway-context.ts';
import {providerUsage} from '../packages/core/src/gateway-observation.ts';
const binary=process.argv[2]??'codex';
const cases=[
 {name:'raw-null-cache-write',raw:true,usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0,cache_write_tokens:null},output_tokens_details:{reasoning_tokens:0}}},
 {name:'gateway-null-cache-write',usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cached_tokens:0,cache_write_tokens:null},output_tokens_details:{reasoning_tokens:0}}},
 {name:'gateway-unknown-details',usage:{input_tokens:100,output_tokens:10,total_tokens:110}},
 {name:'gateway-known-cache-write',usage:{input_tokens:100,output_tokens:10,total_tokens:110,input_tokens_details:{cache_write_tokens:5}}},
 {name:'gateway-derived-total',noCompaction:true,usage:{input_tokens:100,output_tokens:10}},
];
const results=[];
for(const fixture of cases){
 const root=await mkdtemp(join(tmpdir(),'codex-usage-compat-'));
 const context=await GatewayContext.open(root);let child,lastUsage,requests=0;
 const history=[{role:'user',content:'Preserve compatibility.'},{role:'assistant',content:'old work '.repeat(2000)},...Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'Recent '+i}))];
 const server=createServer(async(req,res)=>{
  try{
   let text='';for await(const chunk of req)text+=chunk;const body=JSON.parse(text||'{}');requests++;
   const message={id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Compatibility preserved. Continue tests.',annotations:[]}]};
   const send=async(_path,request)=>{
    const response={id:'resp_fixture',object:'response',created_at:1,model:body.model,status:'completed',output:[message],usage:fixture.usage};
    if(request.instructions?.startsWith('Summarize the supplied'))return Response.json(response);
    const events=[{type:'response.created',response:{...response,status:'in_progress',output:[],usage:null}},{type:'response.output_item.added',output_index:0,item:message},{type:'response.output_item.done',output_index:0,item:message},{type:'response.completed',response}];
    return new Response(events.map((event,sequence_number)=>'data: '+JSON.stringify({...event,sequence_number})+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
   };
   const response=fixture.raw?await send('responses',body):await context.response('responses',{...body,input:history,store:false,...(fixture.noCompaction?{}:{context_management:[{type:'compaction',compact_threshold:100}]})},'fixture','fixture',send);
   const wire=await response.text();const terminal=wire.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).find(event=>event.type==='response.completed');lastUsage=terminal?.response?.usage;
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(wire);
  }catch(error){res.writeHead(500,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error)}}));}
 });
 try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  await writeFile(join(root,'config.toml'),`model="fixture-model"\nmodel_provider="fixture"\n[model_providers.fixture]\nname="Fixture"\nbase_url="http://127.0.0.1:${server.address().port}/v1"\nwire_api="responses"\nrequires_openai_auth=false\nstream_max_retries=0\nrequest_max_retries=0\n`);
  child=spawn(binary,['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root},stdio:['pipe','pipe','pipe']});
  let buffer='',id=0,resolveTurn;const pending=new Map();const completed=new Promise(resolve=>resolveTurn=resolve);
  child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let message;try{message=JSON.parse(line);}catch{continue;}if(pending.has(message.id)){const p=pending.get(message.id);pending.delete(message.id);message.error?p.reject(Error(JSON.stringify(message.error))):p.resolve(message.result);}if(message.method==='turn/completed')resolveTurn(message.params.turn);}});
  child.stderr.on('data',()=>{});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>{pending.delete(key);reject(Error('RPC timeout: '+method));},10000);pending.set(key,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:error=>{clearTimeout(timer);reject(error);}});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
  await rpc('initialize',{clientInfo:{name:'usage_compat_fixture',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
  const thread=await rpc('thread/start',{cwd:root,approvalPolicy:'never',sandbox:'read-only'});
  await rpc('turn/start',{threadId:thread.thread.id,input:[{type:'text',text:'Say done.'}]});
  let timer;let turn;try{turn=await Promise.race([completed,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Turn timeout')),20000))]);}finally{clearTimeout(timer);}
  assert.equal(requests,1,'Client unexpectedly retried a completed response');
  if(fixture.raw){assert.equal(turn.status,'failed');assert.match(turn.error.message,/failed to parse ResponseCompleted: invalid type: null, expected i64/);}
  else {
   assert.equal(turn.status,'completed',turn.error?.message);
   const measured=providerUsage(lastUsage);
   assert.equal(measured.inputTokens,fixture.noCompaction?100:200);assert.equal(measured.outputTokens,fixture.noCompaction?10:20);
   assert.equal(measured.cacheWriteTokens,fixture.name==='gateway-known-cache-write'?10:null);
  }
  results.push({case:fixture.name,status:turn.status,...(fixture.raw?{expectedParserError:turn.error.message}:{} )});
 }finally{
  if(child&&child.exitCode===null){const exited=new Promise(resolve=>child.once('exit',resolve));child.kill();await exited;}
  server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:20});
 }
}
console.log(JSON.stringify({passed:true,scope:'installed Codex with synthetic Responses; no paid calls',results}));
