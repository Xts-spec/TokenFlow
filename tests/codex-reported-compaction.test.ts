import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
import {upstreamError} from '../packages/core/src/upstream-errors.js';
import {WorkBuddySDKProvider} from '../packages/core/src/codebuddy.js';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const scope={owner:'test',model:'qoder/model',source:'source'};
const summary=(text:string)=>({type:'message',role:'assistant',content:[{type:'output_text',text:'Historical task checkpoint (summary of earlier work):\n'+text}]});
const completed=(text:string)=>Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:50,output_tokens:10}});
async function setup(){const root=await mkdtemp(join(tmpdir(),'codex-reported-'));roots.push(root);return GatewayContext.open(root);}

it('merges previous checkpoints into the next summary instead of accumulating them verbatim',async()=>{
 const context=await setup();let input:Record<string,unknown>[]=[summary('ORIGINAL_DECISION: preserve billing. '+ 'Completed earlier work. '.repeat(1800))];
 for(let round=0;round<4;round++){
  input.push({role:'user',content:'Continue round '+round},...Array.from({length:12},(_,i)=>({role:'assistant',content:'Finished step '+i})));
  const sent:string[]=[];
  const response=await context.response('responses/compact',{model:scope.model,input},scope.owner,scope.source,async(_route,body)=>{sent.push(JSON.stringify(body.input));return completed('ORIGINAL_DECISION: preserve billing. Round '+round+' completed.');});
  const checkpoint=(await response.json()).output.at(-1);
  input=context.decodeCheckpoint(checkpoint.encrypted_content,[scope]);
  expect(sent.join('\n')).toContain('ORIGINAL_DECISION');
  expect(input.filter(item=>JSON.stringify(item).includes('Historical task checkpoint (summary of earlier work):'))).toHaveLength(1);
  expect(JSON.stringify(input).length).toBeLessThan(4000);
 }
});

it('does not emit a bootstrap checkpoint for a new chat containing only fixed instructions and its first user request',async()=>{
 const context=await setup();const input=[{role:'developer',content:'Static instructions. '.repeat(16000)},{role:'user',content:'Hello'}];let calls=0,compactions=0;
 const response=await context.response('responses',{model:scope.model,input,store:false},scope.owner,scope.source,async(_route,body)=>{calls++;expect(body.input).toEqual(input);return completed('Hello');},{scope,threadId:'fresh',recover:async()=>[]},{onCompaction:()=>compactions++});
 const result=await response.json();expect(calls).toBe(1);expect(compactions).toBe(0);expect(result.output.some((item:any)=>item.type==='compaction')).toBe(false);
});

it('retains Qoder capacity advice when a Responses error wraps the provider envelope in its message',async()=>{
 const context=await setup();const provider={error:{code:'qoder_capacity_wait_exhausted',type:'rate_limit_error',message:'The source is temporarily resource limited.'}};
 await expect(context.response('responses/compact',{model:scope.model,input:[{role:'assistant',content:'Old work '.repeat(2000)},...Array.from({length:8},()=>({role:'assistant',content:'Recent'}))]},scope.owner,scope.source,async()=>Response.json({error:{code:'rate_limit_exceeded',message:JSON.stringify(provider)}},{status:429}))).rejects.toMatchObject({message:expect.stringContaining('请稍后重试或选择其他模型')});
});

it('preserves normalized context and parameter diagnostics through repeated relay classification',()=>{
 for(const raw of [{error:{code:'context_length_exceeded',message:'PRIVATE'}},{error:{type:'invalid_request_error',param:'messages[2].content',message:'PRIVATE'}}]){
  const first=upstreamError(400,JSON.stringify(raw));expect(upstreamError(400,JSON.stringify({error:first}))).toEqual(first);
 }
});

it.each(['rate_limit_error','authentication_error'] as const)('shows the WorkBuddy %s cause through remote summary streaming',async errorCode=>{
 const root=await mkdtemp(join(tmpdir(),'codex-summary-sdk-'));roots.push(root);const context=await GatewayContext.open(root);
 const sdk=new WorkBuddySDKProvider(root,async()=>({type:'workbuddy',access_token:'fixture'}),async input=>({model:input.model,text:'',calls:[],failed:true,errorCode}));
 try{
  await expect(context.response('responses',{model:'workbuddy/test',input:[{role:'assistant',content:'Old work '.repeat(2000)},...Array.from({length:8},()=>({role:'assistant',content:'Recent'})),{type:'compaction_trigger'}]},'test','source',(route,body)=>sdk.response('source',route,body,new AbortController().signal))).rejects.toMatchObject({statusCode:errorCode==='rate_limit_error'?429:401,message:expect.stringContaining(errorCode==='rate_limit_error'?'WorkBuddy 来源限流':'WorkBuddy 登录已失效')});
 }finally{await sdk.close();}
});

it('returns only a checkpoint during remote compaction and resumes the ordinary answer separately',async()=>{
 const context=await setup();const history=[{role:'assistant',content:'Old work '.repeat(2000)},...Array.from({length:8},()=>({role:'assistant',content:'Recent'}))];
 const compact=await context.response('responses',{model:scope.model,input:[...history,{type:'compaction_trigger'}],stream:true},scope.owner,scope.source,async(_route,body)=>{expect(body.tools).toBeUndefined();return completed('CHECKPOINT_TEXT_FOR_HISTORY');});
 const text=await compact.text();expect(text).not.toContain('CHECKPOINT_TEXT_FOR_HISTORY');expect(text).not.toContain('response.output_text.delta');
 const events=text.split('\n').filter(line=>line.startsWith('data: ')).map(line=>JSON.parse(line.slice(6)));
 const output=events.find(e=>e.type==='response.completed').response.output;expect(output).toHaveLength(1);expect(output[0].type).toBe('compaction');
 const next=await context.response('responses',{model:scope.model,input:[...output,{role:'user',content:'Continue'}]},scope.owner,scope.source,async(_route,body)=>{expect(JSON.stringify(body.input)).toContain('CHECKPOINT_TEXT_FOR_HISTORY');return completed('NORMAL_CONTINUATION');});
 expect(await next.text()).toContain('NORMAL_CONTINUATION');
});
