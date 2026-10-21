import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext,type CompactionReport} from '../packages/core/src/gateway-context.js';
import {providerUsage} from '../packages/core/src/gateway-observation.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const history=[{role:'user',content:'Preserve compatibility.'},{role:'assistant',content:'old work '.repeat(2000)},...Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',content:'Recent '+i}))];
const message={type:'message',role:'assistant',content:[{type:'output_text',text:'Compatibility preserved. Continue tests.'}]};
const base={input_tokens:100,output_tokens:10,total_tokens:110};
const counters=(usage:Record<string,any>)=>{
 for(const field of ['input_tokens','output_tokens','total_tokens'])expect(Number.isSafeInteger(usage[field]),field).toBe(true);
 // Codex requires cached_tokens whenever this optional details object exists.
 if(usage.input_tokens_details){expect(Number.isSafeInteger(usage.input_tokens_details.cached_tokens)).toBe(true);for(const value of Object.values(usage.input_tokens_details))expect(Number.isSafeInteger(value)).toBe(true);}
 if(usage.output_tokens_details)expect(Number.isSafeInteger(usage.output_tokens_details.reasoning_tokens)).toBe(true);
};
it.each([
 {label:'known cache read, unknown cache write',usage:{...base,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:4}},expected:{cachedTokens:0,cacheWriteTokens:null,reasoningTokens:8}},
 {label:'unknown optional details',usage:base,expected:{cachedTokens:null,cacheWriteTokens:null,reasoningTokens:null}},
 {label:'known write with unknown cache read',usage:{...base,input_tokens_details:{cache_write_tokens:5}},expected:{cachedTokens:null,cacheWriteTokens:10,reasoningTokens:null}},
])('emits Codex-compatible completed usage after compaction with $label',async({usage,expected})=>{
 const root=await mkdtemp(join(tmpdir(),'context-usage-'));roots.push(root);const context=await GatewayContext.open(root);let report:CompactionReport|undefined;
 const response=await context.response('responses',{model:'qoder/gfmodel',input:history,stream:true,store:false,context_management:[{type:'compaction',compact_threshold:100}]},'a','s',async(_p,b)=>{
  const result={id:'resp_fixture',object:'response',created_at:1,status:'completed',output:[message],usage};
  if(b.instructions)return Response.json(result);
  return new Response('data: '+JSON.stringify({type:'response.completed',response:result})+'\n\n',{headers:{'content-type':'text/event-stream'}});
 },undefined,{onCompaction:value=>report=value});
 const event=(await response.text()).split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).at(-1);
 expect(event.type).toBe('response.completed');counters(event.response.usage);
 expect(event.response.usage).toMatchObject({input_tokens:200,output_tokens:20,total_tokens:220});
 expect(providerUsage(event.response.usage)).toMatchObject(expected);
 expect(report?.cacheWriteTokens).toBe(expected.cacheWriteTokens===null?null:5);
});

it('emits compatible usage for an explicit compaction trigger with nullable provider details',async()=>{
 const root=await mkdtemp(join(tmpdir(),'context-usage-'));roots.push(root);const context=await GatewayContext.open(root);
 const response=await context.response('responses',{model:'qoder/gfmodel',input:[...history,{type:'compaction_trigger'}],stream:true,store:false},'a','s',async()=>Response.json({status:'completed',output:[message],usage:{...base,input_tokens_details:{cached_tokens:0,cache_write_tokens:null},output_tokens_details:{reasoning_tokens:null}}}));
 const event=(await response.text()).split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5))).at(-1);
 expect(event.type).toBe('response.completed');counters(event.response.usage);
 expect(providerUsage(event.response.usage)).toMatchObject({inputTokens:100,outputTokens:10,cachedTokens:0,cacheWriteTokens:null,reasoningTokens:null});
});
