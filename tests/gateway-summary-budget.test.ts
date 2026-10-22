import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext,type CompactionReport} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const history=[{role:'user',content:'Preserve API compatibility.'},...Array.from({length:20},()=>({role:'assistant',content:'Completed verified work. '.repeat(40)})),{role:'user',content:'Continue read-only.'}];
async function setup(){const root=await mkdtemp(join(tmpdir(),'summary-budget-'));roots.push(root);return GatewayContext.open(root);}
const complete={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'API compatibility preserved. Continue read-only verification.'}]}],usage:{input_tokens:100,output_tokens:9000,total_tokens:9100}};
it('lets the upstream choose the summary output budget and accepts output usage above 8192',async()=>{
 const context=await setup();const sent:Record<string,any>[]=[];let report:CompactionReport|undefined;
 const result=await context.response('responses/compact',{model:'codex/model',input:history,store:false},'a','s',async(_path,body)=>{sent.push(body);return Response.json(complete);},undefined,{onCompaction:value=>{report=value;}});
 expect(sent).toHaveLength(1);expect(sent[0]).not.toHaveProperty('max_output_tokens');expect(sent[0]).not.toHaveProperty('reasoning');
 expect((await result.json()).usage).toMatchObject({input_tokens:100,output_tokens:9000});
 expect(report).toMatchObject({calls:1,failed:false,inputTokens:100,outputTokens:9000});
});
it.each(['max_output_tokens','unknown','content_filter'])('preserves history on an upstream incomplete %s result and permits the next request',async reason=>{
 const context=await setup();let calls=0;const before=JSON.stringify(history);let report:CompactionReport|undefined;
 await expect(context.response('responses/compact',{model:'codex/model',input:history,store:false},'a','s',async(_path,body)=>{
  expect(body).not.toHaveProperty('max_output_tokens');calls++;return Response.json({status:'incomplete',incomplete_details:{reason},output:[],usage:{input_tokens:100,output_tokens:12000}});
 },undefined,{onCompaction:value=>{report=value;}})).rejects.toMatchObject({code:'compaction_incomplete',usage:{input_tokens:100,output_tokens:12000}});
 expect(calls).toBe(1);expect(JSON.stringify(history)).toBe(before);expect(report).toMatchObject({calls:1,failed:true,inputTokens:100,outputTokens:12000});
 await context.response('responses/compact',{model:'codex/model',input:history,store:false},'a','s',async()=>{calls++;return Response.json(complete);});expect(calls).toBe(2);
});
