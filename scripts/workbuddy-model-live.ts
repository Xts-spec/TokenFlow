// Explicit live acceptance; credentials remain in memory, report has no messages or secrets.
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,mkdir,writeFile,rm} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {WorkBuddySDKProvider,workbuddySDKCredential} from '../packages/core/src/codebuddy.js';
import {runOfficialSDK} from '../packages/codebuddy-runtime/index.js';
import {workbuddyQuota} from '../packages/core/src/quota/workbuddy.js';
assert.equal(process.argv[2],'--live','Explicit --live required');
const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
const records:Array<{id:string;raw:any}>=[];
for(const file of await readdir(authDir))if(file.endsWith('.json'))try{
 const raw=JSON.parse(await readFile(join(authDir,file),'utf8'));
 if(raw.type==='workbuddy'&&!raw.disabled&&(raw.access_token||raw.jwt))records.push({id:createHash('sha256').update(file).digest('hex').slice(0,12),raw});
}catch{}
const report:any={at:new Date().toISOString(),checks:[]};
for(const region of (process.argv[3]?[process.argv[3]]:['china','international'])){
 const account=records.find(a=>workbuddySDKCredential(a.raw).region===region);
 if(!account){report.checks.push({region,status:'no_saved_account'});continue;}
 const credential=workbuddySDKCredential(account.raw);
 const quota=async()=>{try{return await workbuddyQuota.fetch(async request=>{
  const response=await fetch(request.url,{method:request.method,headers:Object.fromEntries(Object.entries(request.header).map(([k,v])=>[k,v.replace('$TOKEN$',credential.token)])),body:request.data,signal:AbortSignal.timeout(20000)});
  return {statusCode:response.status,header:{},body:await response.text()};
 },{provider:'workbuddy',domain:account.raw.domain});}catch{return {error:'quota_query_failed'};}};
 const root=await mkdtemp(join(tmpdir(),'workbuddy-model-live-'));
 const provider=new WorkBuddySDKProvider(root,async()=>account.raw,async input=>{try{const result=await runOfficialSDK(input);console.log(JSON.stringify({region,runtime:{failed:result.failed,errorCode:result.errorCode,model:result.model,calls:result.calls.length,textLength:result.text.length}}));return result;}catch(error){console.log(JSON.stringify({region,runtimeError:error instanceof Error&&/^SDK (streaming model mismatch|text stream mismatch: partial=\d+, complete=\d+, blocks=[a-z_,]+|model mismatch|request cancelled)$/.test(error.message)?error.message:'sdk_exception'}));throw error;}});
 const evidence:any={region,account:account.id,before:await quota(),rounds:[]};
 const model='workbuddy/deepseek-v4.1-flash';
 const tools=[{name:'probe_lookup',description:'Return the requested diagnostic value. No filesystem or network access.',input_schema:{type:'object',properties:{key:{type:'string'}},required:['key'],additionalProperties:false}}];
 const messages:any[]=[{role:'user',content:'Call probe_lookup with key first. After receiving its result, call it again with key second. Then report both exact returned values. Do not invent results.'}];
 try{
  for(let turn=0;turn<3;turn++){
   const started=Date.now();const response=await provider.response(account.id,'messages',{model,system:'You are a diagnostic model. Follow the supplied conversation. Only the client executes tools.',stream:true,messages,tools,parallel_tool_calls:false,tool_choice:turn<2?{type:'tool',name:'probe_lookup'}:{type:'none'},max_tokens:256},AbortSignal.timeout(70000));
   const reader=response.body!.getReader();const decoder=new TextDecoder();let wire='',firstDeltaMs:number|undefined;
   for(;;){const chunk=await reader.read();if(chunk.done)break;wire+=decoder.decode(chunk.value,{stream:true});if(firstDeltaMs===undefined&&wire.includes('"type":"text_delta"'))firstDeltaMs=Date.now()-started;}
   const events=wire.split('\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));
   const failure=events.find(e=>e.type==='error'||e.type==='response.failed');
   const blocks=new Map<number,any>();
   for(const event of events){
    if(event.type==='content_block_start')blocks.set(event.index,{...event.content_block,partial:''});
    if(event.type==='content_block_delta'){
     const block=blocks.get(event.index);if(!block)continue;
     if(event.delta.type==='text_delta')block.text+=event.delta.text;
     if(event.delta.type==='input_json_delta')block.partial+=event.delta.partial_json;
    }
   }
   const content=[...blocks.values()].map(({partial,...b})=>b.type==='tool_use'?{...b,input:JSON.parse(partial||'{}')}:b);
   const calls=content.filter(b=>b.type==='tool_use');const answer=content.filter(b=>b.type==='text').map(b=>b.text).join('');
   const error=failure?.error;
   evidence.rounds.push({turn:turn+1,httpStatus:response.status,durationMs:Date.now()-started,firstDeltaMs,toolCalls:calls.length,usage:events.find(e=>e.type==='message_delta')?.usage,completed:events.some(e=>e.type==='message_stop'),...(error?{errorCode:error.code??error.type}:{}),...(turn===2?{historyRetained:answer.includes('ALPHA_73')&&answer.includes('BETA_29')}:{} )});
   if(failure||response.status!==200||turn<2&&calls.length!==1)break;
   messages.push({role:'assistant',content});
   if(turn<2)messages.push({role:'user',content:calls.map(call=>({type:'tool_result',tool_use_id:call.id,content:turn===0?'ALPHA_73':'BETA_29'}))});
  }
  evidence.after=await quota();
 }catch(error){evidence.error=error instanceof Error?error.name:'unknown';}
 finally{await provider.close();await rm(root,{recursive:true,force:true});}
 evidence.passed=evidence.rounds.length===3&&evidence.rounds.every((r:any)=>r.completed&&r.httpStatus===200)&&evidence.rounds[2].historyRetained===true;
 if(!evidence.passed)process.exitCode=1;
 report.checks.push(evidence);console.log(JSON.stringify(evidence));
}
await mkdir('output/workbuddy-sdk',{recursive:true});
if(process.argv[3]){try{const old=JSON.parse(await readFile('output/workbuddy-sdk/model-live-result.json','utf8'));report.checks=[...old.checks.filter((c:any)=>c.region!==process.argv[3]),...report.checks];}catch{}}
await writeFile('output/workbuddy-sdk/model-live-result.json',JSON.stringify(report,null,2));
