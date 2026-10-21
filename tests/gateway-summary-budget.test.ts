import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext,type CompactionReport} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const history=[{role:'user',content:'Preserve API compatibility.'},...Array.from({length:20},()=>({role:'assistant',content:'Completed verified work. '.repeat(400)})),{role:'user',content:'Continue read-only.'}];
async function setup(){const root=await mkdtemp(join(tmpdir(),'summary-budget-'));roots.push(root);return GatewayContext.open(root);}
const complete={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'API compatibility preserved. Continue read-only verification.'}]}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}};
it.each(['explicit','reasoning'])('retries a proven %s output exhaustion once and counts both attempts',async kind=>{
 const context=await setup();const sent:Record<string,any>[]=[];let report:CompactionReport|undefined;
 const result=await context.response('responses/compact',{model:'qoder/model',input:history,store:false},'a','s',async(_path,body)=>{
  sent.push(body);
  if(sent.length===1)return Response.json({status:'incomplete',...(kind==='explicit'?{incomplete_details:{reason:'max_output_tokens'}}:{}),output:[],usage:{input_tokens:100,output_tokens:4099,output_tokens_details:{reasoning_tokens:4096},total_tokens:4199}});
  return Response.json(complete);
 },undefined,{onCompaction:value=>{report=value;}});
 expect(sent.map(body=>body.max_output_tokens)).toEqual([4096,8192]);
 expect(sent[1]!.model).toBe(sent[0]!.model);expect(sent[1]!.input).toEqual(sent[0]!.input);expect(sent[1]).not.toHaveProperty('reasoning');
 expect((await result.json()).usage).toMatchObject({input_tokens:200,output_tokens:4109});
 expect(report).toMatchObject({calls:2,failed:false,inputTokens:200,outputTokens:4109});
});
it('stops after the enlarged summary budget is exhausted without replacing history',async()=>{
 const context=await setup();let calls=0;const before=JSON.stringify(history);
 await expect(context.response('responses/compact',{model:'qoder/model',input:history,store:false},'a','s',async()=>{calls++;return Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage:{input_tokens:100,output_tokens:4096}});})).rejects.toMatchObject({code:'compaction_output_limit'});
 expect(calls).toBe(2);expect(JSON.stringify(history)).toBe(before);
});
it.each(['unknown','content_filter'])('does not retry an incomplete summary with %s cause',async reason=>{
 const context=await setup();let calls=0;
 await expect(context.response('responses/compact',{model:'qoder/model',input:history,store:false},'a','s',async()=>{calls++;return Response.json({status:'incomplete',incomplete_details:{reason},output:[],usage:{input_tokens:100,output_tokens:10}});})).rejects.toMatchObject({code:'compaction_incomplete'});
 expect(calls).toBe(1);
});
it('keeps the first attempt usage when the single retry is rate limited',async()=>{
 const context=await setup();let calls=0;let report:CompactionReport|undefined;
 await expect(context.response('responses/compact',{model:'qoder/model',input:history,store:false},'a','s',async()=>{
  calls++;
  return calls===1?Response.json({status:'incomplete',incomplete_details:{reason:'max_output_tokens'},output:[],usage:{input_tokens:100,output_tokens:4096}}):Response.json({error:{message:'rate limited'}},{status:429});
 },undefined,{onCompaction:value=>{report=value;}})).rejects.toMatchObject({code:'compaction_upstream_failed',usage:{input_tokens:100,output_tokens:4096}});
 expect(calls).toBe(2);expect(report).toMatchObject({calls:2,failed:true,inputTokens:100,outputTokens:4096});
});
