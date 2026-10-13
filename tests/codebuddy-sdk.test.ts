import {it,expect} from 'vitest';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {WorkBuddySDKProvider,workbuddySDKCredential,parseCodeBuddyInput} from '../packages/core/src/codebuddy.js';
import {providerUsage} from '../packages/core/src/gateway-observation.js';

it('pins the credential region and rejects unknown domains or disabled credentials',()=>{
 expect(workbuddySDKCredential({type:'workbuddy',access_token:'local',domain:'www.codebuddy.cn'})).toEqual({token:'local',region:'china'});
 expect(workbuddySDKCredential({type:'workbuddy',access_token:'overseas',domain:'https://www.workbuddy.ai'})).toEqual({token:'overseas',region:'international'});
 expect(()=>workbuddySDKCredential({type:'workbuddy',access_token:'secret',domain:'attacker.test'})).toThrow();
 expect(()=>workbuddySDKCredential({type:'workbuddy',access_token:'secret',disabled:true})).toThrow();
});
it('preserves old instructions, tool IDs/results and images without changing identity text',()=>{
 const original='You are Codex. Keep this instruction intact.';
 const parsed=parseCodeBuddyInput('responses',{model:'workbuddy/deepseek-v4.1-flash',instructions:original,input:[{role:'user',content:[{type:'input_image',image_url:'data:image/png;base64,YWJj'}]},{type:'function_call',call_id:'old',name:'read_probe',arguments:'{}'},{type:'function_call_output',call_id:'old',output:'previous result'}]});
 expect(parsed.prompt).toContain(original);expect(parsed.prompt).toContain('previous result');expect(parsed.prompt).toContain('"call_id":"old"');
 expect(parsed.images).toEqual([{type:'image',source:{type:'base64',media_type:'image/png',data:'YWJj'}}]);expect(parsed.prompt).not.toContain('YWJj');
});
it.each(['responses','chat/completions','messages'])('preserves inclusive SDK input and cache breakdown once on %s',async path=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-test-'));
 const sdk=new WorkBuddySDKProvider(root,async(id,model)=>{expect(id).toBe('chosen-account');expect(model).toBe('workbuddy/deepseek-v4.1-flash');return {type:'workbuddy',access_token:'private',domain:'www.workbuddy.ai'};},async input=>{
  expect(input.region).toBe('international');expect(input.token).toBe('private');expect(input.tools[0].name).toBe('read_probe');
  return {model:input.model,text:'',calls:[{name:'read_probe',arguments:'{"file":"probe"}'}],failed:false,usage:{input_tokens:1000,cache_read_input_tokens:600,cache_creation_input_tokens:300,output_tokens:20}};
 });
 try{
  const response=await sdk.response('chosen-account',path,{model:'workbuddy/deepseek-v4.1-flash',...(path==='responses'?{input:'Read probe'}:{messages:[{role:'user',content:'Read probe'}]}),tools:[{type:'function',name:'read_probe',parameters:{type:'object',properties:{file:{type:'string'}}}}]},new AbortController().signal);
  const value=await response.json();expect(response.status).toBe(200);expect(response.headers.get('x-token-flow-transport')).toBe('codebuddy-agent-sdk');
  expect(providerUsage(value.usage)).toMatchObject({inputTokens:1000,cachedTokens:600,cacheWriteTokens:300,outputTokens:20});
  expect(JSON.stringify(value)).toContain('read_probe');expect(JSON.stringify(value)).not.toContain('private');
  expect(await readdir(join(root,'workbuddy-sdk-runs'))).toEqual([]);
 }finally{await sdk.close();await rm(root,{recursive:true,force:true});}
});
it('does not silently use a fallback model or another account on failure',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-test-'));
 const sdk=new WorkBuddySDKProvider(root,async()=>({type:'workbuddy',access_token:'private'}),async()=>({text:'wrong model',model:'default-model',calls:[],failed:false}));
 try{expect((await sdk.response('chosen','responses',{model:'workbuddy/deepseek-v4.1-flash',input:'hello'},new AbortController().signal)).status).toBe(502);}finally{await rm(root,{recursive:true,force:true});}
});
it('keeps Codex namespace identity when flattening tools for the SDK',()=>{
 const value=parseCodeBuddyInput('responses',{model:'workbuddy/deepseek-v4.1-flash',input:'Read test',tools:[{type:'namespace',name:'functions',tools:[{type:'function',name:'read',parameters:{type:'object',properties:{}}}]}],tool_choice:{type:'function',namespace:'functions',name:'read'}});
 expect(value.tools[0].name).toBe('functions__read');expect(value.toolIdentities.get('functions__read')).toEqual({name:'read',namespace:'functions'});expect(value.required).toBe(true);
});
it('opens streaming promptly and waits for cancelled SDK cleanup before closing',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-stream-'));let started!:()=>void;
 const running=new Promise<void>(resolve=>{started=resolve;});let cleaned=false;
 const sdk=new WorkBuddySDKProvider(root,async()=>({type:'workbuddy',access_token:'private'}),async input=>{
  started();await new Promise<void>(resolve=>input.signal.addEventListener('abort',()=>setTimeout(()=>{cleaned=true;resolve();},20),{once:true}));
  return {model:input.model,text:'',calls:[],failed:true};
 });
 try{
  const response=await sdk.response('chosen','responses',{model:'workbuddy/deepseek-v4.1-flash',input:'hello',stream:true},new AbortController().signal);
  const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain(': codebuddy-sdk');
  await running;await reader.cancel();await sdk.close();expect(cleaned).toBe(true);expect(await readdir(join(root,'workbuddy-sdk-runs'))).toEqual([]);
 }finally{await sdk.close();await rm(root,{recursive:true,force:true});}
});

it('merges Responses Lite tools with top-level precedence and preserves the original history',()=>{
 const primary={type:'function',name:'read',description:'primary',parameters:{type:'object',properties:{}}};
 const history={type:'function_call_output',call_id:'previous-call',output:'client executed this'};
 const body={model:'workbuddy/test',input:[{role:'user',content:'continue'},{type:'additional_tools',tools:[{...primary,description:'duplicate'},{type:'namespace',name:'functions',tools:[{type:'custom',name:'patch',format:{type:'text'}}]}]},history],tools:[primary],parallel_tool_calls:false};
 const original=JSON.stringify(body);const parsed=parseCodeBuddyInput('responses',body);
 expect(parsed.tools).toHaveLength(2);expect(parsed.tools[0].description).toBe('primary');
 expect(parsed.toolIdentities.get('functions__patch')).toEqual({name:'patch',namespace:'functions'});
 expect(parsed.tools[1].custom).toBe(true);expect(parsed.parallel_tool_calls).toBe(false);
 expect(parsed.prompt).toContain('previous-call');expect(parsed.prompt).toContain('client executed this');expect(parsed.prompt).not.toContain('additional_tools');
 expect(JSON.stringify(body)).toBe(original);
});

it('round-trips colliding tool identities and custom results over the SDK boundary',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sdk-collisions-'));let turn=0;
 const tools=[{type:'function',name:'fs__read',parameters:{type:'object'}},{type:'namespace',name:'fs',tools:[{type:'custom',name:'read',format:{type:'text'}}]}];
 const original={model:'workbuddy/test',input:[{role:'user',content:'Read'}],tools,parallel_tool_calls:false,tool_choice:{type:'custom',namespace:'fs',name:'read'}};
 const both=parseCodeBuddyInput('responses',{...original,tool_choice:'auto'});
 expect(new Set(both.tools.map(t=>t.name)).size).toBe(2);
 const reversed=parseCodeBuddyInput('responses',{...original,tools:[...tools].reverse(),tool_choice:'auto'});
 expect([...both.toolIdentities].sort()).toEqual([...reversed.toolIdentities].sort());
 const sdk=new WorkBuddySDKProvider(root,async()=>({type:'workbuddy',access_token:'fixture'}),async input=>{
  expect(input.parallelToolCalls).toBe(false);expect(input.tools).toHaveLength(1);
  if(turn++===0)return {model:input.model,text:'',calls:[{name:input.tools[0].name,arguments:JSON.stringify({input:'client-file.txt'}),custom:true}],failed:false};
  expect(input.prompt).toContain('CLIENT_RESULT');expect(input.prompt).toContain('"namespace":"fs"');
  return {model:input.model,text:'Received CLIENT_RESULT',calls:[],failed:false};
 });
 try{
  const response=await sdk.response('source','responses',original,new AbortController().signal);expect(response.status).toBe(200);
  const first=await response.json();const call=first.output[0];
  expect(call).toMatchObject({type:'custom_tool_call',name:'read',namespace:'fs',input:'client-file.txt'});
  const second=await sdk.response('source','responses',{...original,tool_choice:'auto',tools:[tools[1]],input:[...original.input,...first.output,{type:'custom_tool_call_output',call_id:call.call_id,output:'CLIENT_RESULT'}]},new AbortController().signal);
  expect(second.status).toBe(200);expect(JSON.stringify(await second.json())).toContain('Received CLIENT_RESULT');
 }finally{await sdk.close();await rm(root,{recursive:true,force:true});}
});
