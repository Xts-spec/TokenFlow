import {afterEach,beforeEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayTraces,requestTrace,redactTraceText} from '../packages/core/src/gateway-traces';
import {ResponseObserver,providerUsage} from '../packages/core/src/gateway-observation';
import {gatewayResponseEvidence} from '../packages/core/src/local-usage-evidence';
let root='';beforeEach(async()=>{root=await mkdtemp(join(tmpdir(),'trace-test-'));});afterEach(async()=>{await rm(root,{recursive:true,force:true});});
it.each(['password="alpha beta gamma"',"password='alpha beta gamma'",'"api_key": "alpha beta gamma"','password="alpha beta gamma'])('hides the entire quoted credential in %s',value=>{
 const redacted=redactTraceText(value);expect(redacted).toContain('[已隐藏]');for(const part of ['alpha','beta','gamma'])expect(redacted).not.toContain(part);
});
const call=(keyId='key')=>({keyId,agent:'Pi',target:'pi',sourceId:'acct',model:'test/model',protocol:'chat/completions',startedAt:new Date().toISOString(),durationMs:100,status:200,inputTokens:30,cachedTokens:20,outputTokens:4});
it('keeps exact gateway response evidence after trace retention, clearing and restart',async()=>{
 const traces=await GatewayTraces.open(root);
 try{
  traces.record({...call(),target:'claude-desktop'},requestTrace({}),{tools:[],responseId:'desktop-response'});
  for(let i=0;i<1000;i++)traces.record(call(),requestTrace({}));
  await traces.flush();expect(traces.list({limit:1000})).toHaveLength(1000);
  expect((await gatewayResponseEvidence(root)).matches('desktop-response')).toBe(true);
  await traces.clear();expect((await gatewayResponseEvidence(root)).matches('desktop-response')).toBe(true);
  const reopened=await GatewayTraces.open(root);await reopened.close();const evidence=await gatewayResponseEvidence(root);expect(evidence.matches('desktop-response')).toBe(true);expect(evidence.matches('unrelated-response')).toBe(false);
  expect(await readFile(join(root,'gateway-response-evidence.jsonl'),'utf8')).not.toContain('desktop-response');
 }finally{await traces.close();}
});
it('migrates response hashes from old traces before pruning them on open',async()=>{
 const traces=await GatewayTraces.open(root);traces.record(call(),requestTrace({}),{tools:[],responseId:'old-response'});await traces.close();
 await rm(join(root,'gateway-response-evidence.jsonl'));const path=join(root,'gateway-traces.json'),saved=JSON.parse(await readFile(path,'utf8'));saved.records[0].startedAt=new Date(Date.now()-31*86400_000).toISOString();await writeFile(path,JSON.stringify(saved));
 const reopened=await GatewayTraces.open(root);try{expect(reopened.list()).toEqual([]);expect((await gatewayResponseEvidence(root)).matches('old-response')).toBe(true);}finally{await reopened.close();}
});
it.each([false,true])('preserves expired legacy response references before pruning, mixed hashes: %s',async(mixed)=>{
 const traces=await GatewayTraces.open(root);traces.record(call(),requestTrace({}),{tools:[],responseId:'legacy-response'});
 if(mixed)traces.record(call(),requestTrace({}),{tools:[],responseId:'new-response'});await traces.close();
 await rm(join(root,'gateway-response-evidence.jsonl'));const path=join(root,'gateway-traces.json'),saved=JSON.parse(await readFile(path,'utf8'));
 const legacy=saved.records.at(-1);delete legacy.responseHash;legacy.startedAt=new Date(Date.now()-31*86400_000).toISOString();await writeFile(path,JSON.stringify(saved));
 expect((await gatewayResponseEvidence(root)).matches('legacy-response')).toBe(true);
 const reopened=await GatewayTraces.open(root);try{
  expect(reopened.list()).toHaveLength(mixed?1:0);await reopened.clear();await rm(path);
  const restored=await gatewayResponseEvidence(root);expect(restored.matches('legacy-response')).toBe(true);expect(restored.matches('other-response')).toBe(false);await restored.flush();
  expect((await gatewayResponseEvidence(root)).matches('legacy-response')).toBe(true);
  expect(await readFile(join(root,'gateway-response-evidence.jsonl'),'utf8')).not.toContain('legacy-response');
 }finally{await reopened.close();}
});
it('links actual tool calls to results, deduplicates replayed history, persists across restarts and omits full messages',async()=>{
 const traces=await GatewayTraces.open(root);const observer=new ResponseObserver();
 observer.inspect({choices:[{index:0,delta:{content:'PRIVATE_ASSISTANT',reasoning_content:'PRIVATE_REASONING',tool_calls:[{index:0,id:'tool1',function:{name:'read'}}]}}]});
 observer.inspect({choices:[{index:0,delta:{tool_calls:[{index:0,function:{name:'_file',arguments:'PRIVATE_ARGUMENT'}}]}}]});
 const first=requestTrace({messages:[{role:'user',content:'PRIVATE_USER'}]});expect(traces.record(call(),first,observer.result())).toEqual({toolCalls:1,toolResults:0});
 const result=requestTrace({messages:[{role:'user',content:'PRIVATE_USER'},{role:'assistant',content:'PRIVATE_ASSISTANT',tool_calls:[{id:'tool1',function:{name:'read_file'}}]},{role:'tool',tool_call_id:'tool1',content:'RESULT_ONLY'}]});
 expect(traces.record(call(),result)).toEqual({toolCalls:0,toolResults:1});expect(traces.record(call(),result)).toEqual({toolCalls:0,toolResults:0});
 const rows=traces.list();expect(new Set(rows.map(r=>r.runId)).size).toBe(1);const original=traces.get(rows.at(-1)!.id)!;expect(original.tools[0]).toMatchObject({name:'read_file',status:'returned',result:'RESULT_ONLY'});
 expect(traces.record(call('another-key'),result)).toEqual({toolCalls:0,toolResults:1});expect(traces.list({keyId:'another-key'})[0].runId).not.toBe(original.runId);
 await traces.close();const raw=await readFile(join(root,'gateway-traces.json'),'utf8');expect(raw).toContain('RESULT_ONLY');for(const secret of ['PRIVATE_USER','PRIVATE_ASSISTANT','PRIVATE_REASONING','PRIVATE_ARGUMENT','tool1'])expect(raw).not.toContain(secret);
 const again=await GatewayTraces.open(root);expect(again.list()).toHaveLength(4);expect(again.record(call(),result).toolResults).toBe(0);await again.clear();expect(again.list()).toEqual([]);expect(again.record(call(),result).toolResults).toBe(0);await again.close();
});
it('records only the latest turn tool results and masks secrets and binary attachments',()=>{
 const sketch=requestTrace({messages:[{role:'user',content:'old'},{role:'tool',tool_call_id:'old-tool',content:'OLD_RESULT'},{role:'user',content:'new'},{role:'tool',tool_call_id:'new-tool',content:{password:'PRIVATE_PASS',api_key:'PRIVATE_KEY',authorization:'Bearer rawsecret',value:'PUBLIC_RESULT',image:{type:'image',data:'PRIVATE_BINARY'}}}]});
 expect(sketch.inputs).toMatchObject({user:2,tool:2});expect(sketch.results).toHaveLength(1);expect(sketch.results[0].result).toContain('PUBLIC_RESULT');for(const v of ['PRIVATE_PASS','PRIVATE_KEY','rawsecret','PRIVATE_BINARY','OLD_RESULT'])expect(JSON.stringify(sketch.results)).not.toContain(v);
 expect(requestTrace({input:[{type:'function_call_output',call_id:'a',output:'x'.repeat(20000)}]}).results[0]).toMatchObject({truncated:true});
});
it('uses disjoint cache buckets while keeping inclusive input and reasoning inside output',()=>{
 expect(providerUsage({input_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:5,output_tokens:8,output_tokens_details:{reasoning_tokens:3}})).toMatchObject({inputTokens:35,cachedTokens:20,cacheWriteTokens:5,outputTokens:8,reasoningTokens:3});
 expect(providerUsage({prompt_tokens:30,prompt_cache_hit_tokens:12,completion_tokens:9,completion_tokens_details:{reasoning_tokens:4}})).toMatchObject({inputTokens:30,cachedTokens:12,outputTokens:9,reasoningTokens:4});
 expect(providerUsage({prompt_cache_miss_tokens:18,prompt_cache_hit_tokens:12,completion_tokens:9}).inputTokens).toBe(30);
});
it('deduplicates Responses added/done/final tool items and measures the first reasoning output',()=>{
 let now=1;const o=new ResponseObserver(()=>now);o.inspect({type:'response.output_item.added',item:{type:'function_call',id:'fc1',name:'read'}});o.inspect({type:'response.output_item.done',item:{type:'function_call',id:'fc1',call_id:'call1',name:'read'}});o.inspect({type:'response.reasoning_summary_text.delta',delta:'NOT_STORED'});now=101;o.inspect({type:'response.completed',response:{id:'r1',output:[{type:'function_call',id:'fc1',call_id:'call1',name:'read'}]}});expect(o.result()).toMatchObject({tools:[{id:'call1',name:'read'}],toolsCount:1,firstOutputAt:1,generationMs:100});
});

it('persists safe failure categories so a restart does not erase the reason for a 502',async()=>{
 const traces=await GatewayTraces.open(root);
 traces.record({...call(),status:504,error:{code:'upstream_idle_timeout',message:'上游长时间未返回数据。'}},requestTrace({}));
 await traces.close();const reopened=await GatewayTraces.open(root);
 expect(reopened.list()[0]).toMatchObject({error:{code:'upstream_idle_timeout'}});await reopened.close();
});

it('retains sanitized streaming failure codes in observed responses',()=>{
 const o=new ResponseObserver();o.inspect({type:'error',error:{code:'workbuddy_output_failed',message:'secret payload'}});
 expect(o.result().error).toMatchObject({code:'workbuddy_output_failed'});expect(JSON.stringify(o.result())).not.toContain('secret');
});
