import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,rm,writeFile,readFile,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createServer} from 'node:net';
import {CursorProvider,parseCursorInput} from '../packages/core/src/cursor.js';
import {createDesktopService} from '../packages/core/src/service.js';
it('accepts a large client catalog and preserves union schemas while retaining a bounded limit',()=>{
 const parameters={anyOf:[{type:'object',properties:{path:{type:'string'}}},{type:'object',properties:{id:{type:'number'}}}]};
 const tools=Array.from({length:301},(_,i)=>({type:'function',name:`tool_${i}`,parameters}));
 const input=parseCursorInput('responses',{model:'cursor/test',input:'hello',tools});
 expect(input.tools).toHaveLength(301);expect(input.tools[300].parameters).toEqual(parameters);
 expect(()=>parseCursorInput('responses',{model:'cursor/test',input:'hello',tools:Array.from({length:2049},(_,i)=>({...tools[0],name:`tool_${i}`}))})).toThrow();
});
const sdk=vi.hoisted(()=>({login:vi.fn(),models:vi.fn(),create:vi.fn(),cancel:vi.fn(),close:vi.fn(),quota:vi.fn(),runUsage:vi.fn(),localSession:vi.fn(),localCreate:vi.fn()}));
vi.mock('../packages/core/src/cursor-local.js',()=>({localCursorSession:sdk.localSession}));
vi.mock('../packages/core/src/cursor-usage.js',()=>({CursorUsage:class{quota=sdk.quota;runUsage=sdk.runUsage;}}));
vi.mock('@cursor/sdk',()=>({Cursor:{auth:{login:sdk.login},models:{list:sdk.models}},Agent:{create:sdk.create},JsonlLocalAgentStore:class{constructor(readonly path:string){}}}));
const cleanup:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();vi.restoreAllMocks();});
beforeEach(async()=>{
 // Resolve the mocked dynamic module before concurrent account catalog loads.
 await import('@cursor/sdk');
 sdk.localSession.mockResolvedValue({email:'native@example.test',createCredential:sdk.localCreate});sdk.localCreate.mockResolvedValue({apiKey:'native-fixture-key',email:'native@example.test',disabled:false});
 vi.clearAllMocks();sdk.quota.mockResolvedValue({plan:'Pro',windows:[]});sdk.runUsage.mockResolvedValue(undefined);sdk.login.mockImplementation(async(options)=>{options.onLoginUrl('https://cursor.com/loginDeepControl?uuid=fixture&challenge=fixture');return {apiKey:'cursor-secret-fixture',email:'cursor@example.test',apiKeyExpiresAtMs:Date.now()+86400000};});
 sdk.models.mockResolvedValue([{id:'fixture-model',displayName:'Fixture model'}]);sdk.cancel.mockResolvedValue(undefined);
 sdk.create.mockResolvedValue({close:sdk.close,send:async()=>({cancel:sdk.cancel,wait:async()=>({status:'finished',result:'Cursor fixture reply',usage:{inputTokens:7,outputTokens:3,cacheReadTokens:2,cacheWriteTokens:1,totalTokens:13}})})});
});
it('imports the native account alongside the existing account, deduplicates, persists both, and routes by account ID',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'original-fixture-key',email:'original@example.test'}));
 const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());await provider.load();const originalId=provider.id!;await provider.importLocal();await provider.importLocal();expect(sdk.localCreate).toHaveBeenCalledOnce();
 const snapshot=provider.snapshot();expect(snapshot.accounts).toHaveLength(2);expect(snapshot.accounts[0].id).toBe(originalId);expect(JSON.stringify(snapshot)).not.toContain('fixture-key');
 const nativeId=snapshot.accounts.find(a=>a.label==='native@example.test')!.id;
 for(const [id,key] of [[originalId,'original-fixture-key'],[nativeId,'native-fixture-key']]){await provider.response('messages',{model:'cursor/fixture-model',messages:[{role:'user',content:'hello'}]},new AbortController().signal,id);expect(sdk.create.mock.lastCall![0].apiKey).toBe(key);}
 const reopened=new CursorProvider(root,secrets);cleanup.push(()=>reopened.close());await reopened.load();expect(reopened.snapshot().accounts.map(a=>a.id)).toEqual(snapshot.accounts.map(a=>a.id));await reopened.setEnabled(false,nativeId);expect(reopened.snapshot().accounts.find(a=>a.id===originalId)?.disabled).toBe(false);expect(()=>reopened.assertSource(nativeId,'cursor/fixture-model')).toThrow();await reopened.remove(nativeId);expect(reopened.snapshot().accounts.map(a=>a.id)).toEqual([originalId]);
});
async function setup(){const root=await mkdtemp(join(await realpath(tmpdir()),'cursor-test-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));const values=new Map<string,string>();const secrets={get:async(name:string)=>values.get(name)??'',set:async(name:string,value:string)=>{values.set(name,value);}};return {root,values,secrets};}
it('uses official login with independent credentials, discovers real account models and keeps secrets out of snapshots',async()=>{
 const {root,values,secrets}=await setup();const opened:string[]=[];const provider=new CursorProvider(root,secrets,async url=>{opened.push(url);});await provider.load();await provider.beginLogin();await expect.poll(()=>provider.snapshot().login?.status).toBe('completed');
 expect(opened[0]).toMatch(/^https:\/\/cursor.com\/loginDeepControl/);expect(sdk.login.mock.calls[0][0]).toMatchObject({store:null,backendUrl:'https://api2.cursor.sh',apiKeyName:'token-flow'});
 expect(values.get('cursor-account')).toContain('cursor-secret-fixture');expect(JSON.stringify(provider.snapshot())).not.toContain('cursor-secret-fixture');expect(provider.snapshot().models[0].id).toBe('cursor/fixture-model');
 const reopened=new CursorProvider(root,secrets);await reopened.load();expect(reopened.snapshot().accounts[0].id).toBe(provider.id);await reopened.setEnabled(false);expect(reopened.snapshot().models).toEqual([]);expect(values.get('cursor-account')).toContain('cursor-secret-fixture');await reopened.remove();expect(values.get('cursor-account')).toBe('');
});
it('does not save credentials from a cancelled login, including late SDK completion',async()=>{
 const {root,values,secrets}=await setup();let complete!:(value:unknown)=>void;sdk.login.mockImplementation(options=>{options.onLoginUrl('https://cursor.com/loginDeepControl?uuid=test');return new Promise(r=>{complete=r;});});
 const provider=new CursorProvider(root,secrets);await provider.beginLogin();await expect.poll(()=>provider.snapshot().login?.status).toBe('waiting_for_browser');provider.cancelLogin(provider.snapshot().login!.id);complete({apiKey:'must-not-save'});await provider.close();expect(values.size).toBe(0);expect(provider.snapshot().accounts).toEqual([]);
});
it('routes Cursor through the existing scoped API, meters tokens, isolates SDK tools, and denies unsupported server tools',async()=>{
 // Synthetic credentials must not reach the real REST catalog during a fallback.
 const originalFetch=globalThis.fetch;vi.spyOn(globalThis,'fetch').mockImplementation((url,init)=>String(url)==='https://api.cursor.com/v1/models'?Promise.resolve(Response.json({items:[{id:'fixture-model',displayName:'Fixture model'}]})):originalFetch(url,init));
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({version:1,accounts:[{apiKey:'cursor-secret-fixture',disabled:false},{apiKey:'second-cursor-fixture',email:'second@example.test',disabled:false}]}));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));await mkdir(join(root,'cliproxy'));await writeFile(join(root,'cliproxy','fixture-accounts.json'),'[]');
 const service=await createDesktopService({root,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),proxyPort:port,token:'admin-token',localKey:'internal-key',secrets});cleanup.push(()=>service.app.close());await service.proxy.start();await service.proxy.cursor.refresh();expect(service.proxy.snapshot().accounts.filter(a=>a.provider==='cursor'&&a.models?.includes('cursor/fixture-model')).length,JSON.stringify(service.proxy.cursor.snapshot().accounts)).toBe(2);
 const admin={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};const account=service.proxy.snapshot().accounts[0];
 const created=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'Cursor caller',models:['cursor/fixture-model'],sourceId:account.id,tokenLimit:100}});expect(created.statusCode,created.body).toBe(200);const client={host:admin.host,authorization:`Bearer ${created.json().apiKey}`};
 expect((await service.app.inject({url:'/v1/models',headers:client})).json().data[0].id).toBe('cursor/fixture-model');
 for(const path of ['responses','chat/completions','messages']){
  const result=await service.app.inject({method:'POST',url:`/v1/${path}`,headers:client,payload:{model:'cursor/fixture-model',...(path==='responses'?{input:'Hello'}:{messages:[{role:'user',content:'Hello'}]}),stream:true}});expect(result.statusCode,result.body).toBe(200);expect(result.body).toContain('Cursor fixture reply');
 }
 const keys=(await service.app.inject({url:'/api/gateway-keys',headers:admin})).json().keys;expect(keys[0].usedTokens).toBe(39);expect(keys[0].unmeteredRequests).toBe(0);
 const options=sdk.create.mock.calls[0][0];expect(options).toMatchObject({tools:[],mcpServers:{},agents:{},local:{settingSources:[]}});expect(options.local.cwd.startsWith(join(root,'cursor-runs'))).toBe(true);expect(sdk.close).toHaveBeenCalledTimes(3);
 const denied=await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model:'cursor/fixture-model',input:'Read private files',tools:[{type:'web_search'}]}});expect(denied.statusCode).toBe(400);expect(denied.body).toContain('服务端工具');expect(sdk.create).toHaveBeenCalledTimes(3);
 const other=service.proxy.snapshot().accounts.find(a=>a.id!==account.id)!;const otherCreated=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'Second account',models:['cursor/fixture-model'],sourceId:other.id,tokenLimit:100}});expect(otherCreated.statusCode,otherCreated.body).toBe(200);const otherKey=otherCreated.json();
 const routed=await service.app.inject({method:'POST',url:'/v1/messages',headers:{...admin,authorization:`Bearer ${otherKey.apiKey}`},payload:{model:'cursor/fixture-model',messages:[{role:'user',content:'Bound account'}]}});expect(routed.statusCode).toBe(200);expect(sdk.create.mock.lastCall![0].apiKey).toBe('second-cursor-fixture');
 await service.proxy.setAccountEnabled(account.id,false);expect((await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model:'cursor/fixture-model',input:'hi'}})).statusCode).toBe(503);
 const imported=await service.app.inject({method:'POST',url:'/api/local-agent/import-local/cursor',headers:admin,payload:{}});expect(imported.statusCode,imported.body).toBe(200);expect(service.proxy.cursor.snapshot().accounts).toHaveLength(3);expect(sdk.localCreate).toHaveBeenCalledOnce();expect(imported.body).not.toContain('native-fixture-key');
});
it('exposes explicit text API limits',()=>{
 for(const body of [{input:[{role:'user',content:[{type:'input_image',image_url:'x'}]}]},{input:'hi',previous_response_id:'old'},{input:'hi',text:{format:{type:'json_schema'}}}])expect(()=>parseCursorInput('responses',{model:'cursor/x',...body})).toThrow();
});
it('accepts Claude Code adaptive thinking and context hints without claiming native Anthropic thinking support',()=>{
 const value=parseCursorInput('messages',{model:'cursor/grok-4.6',messages:[{role:'user',content:'continue'}],thinking:{type:'adaptive'},context_management:{edits:[{type:'clear_thinking_20251015',keep:'all'}]},output_config:{effort:'low'}});
 expect(value.effort).toBe('low');expect(value.prompt).toContain('continue');
 expect(()=>parseCursorInput('messages',{model:'cursor/grok-4.6',messages:[{role:'user',content:'hi'}],output_config:{format:{type:'json_schema',schema:{}}}})).toThrow();
});

const tokenUsage={inputTokens:7,outputTokens:3,cacheReadTokens:2,cacheWriteTokens:1,totalTokens:13};
function toolRun(hasUsage=true){
 sdk.create.mockImplementation(async options=>({agentId:'agent-fixture',close:sdk.close,send:async()=>{
  let finish!:(value:unknown)=>void;
  const pending=new Promise(resolve=>{finish=resolve;});
  return {agentId:'agent-fixture',usage:hasUsage?tokenUsage:undefined,cancel:async()=>{sdk.cancel();finish({status:'cancelled',usage:hasUsage?tokenUsage:undefined});},wait:()=>{
   void options.local.customTools.client_0.execute({value:'ping'},{});
   return pending;
  }};
 }}));
}
it.each(['responses','chat/completions','messages'])('hands tools to the %s client and accepts the next tool-result turn',async path=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);await provider.load();
 toolRun();const model='cursor/fixture-model';
 const fn={name:'client_echo',description:'Echo input',parameters:{type:'object',properties:{value:{type:'string'}},required:['value']}};
 const tools=path==='responses'?[{type:'function',...fn}]:path==='messages'?[{name:fn.name,description:fn.description,input_schema:fn.parameters}]:[{type:'function',function:fn}];
 const body={model,tools,...(path==='responses'?{input:'Echo ping',max_output_tokens:64}:{messages:[{role:'user',content:'Echo ping'}],max_tokens:64})};
 const response=await provider.response(path,body,new AbortController().signal);expect(response.status).toBe(200);const result=await response.json();
 const call=path==='responses'?result.output[0]:path==='messages'?result.content[0]:result.choices[0].message.tool_calls[0];
 expect(path==='chat/completions'?call.function.name:call.name).toBe('client_echo');
 expect(sdk.create.mock.calls[0][0]).toMatchObject({tools:['mcp'],mcpServers:{},agents:{},local:{settingSources:[]}});
 expect(sdk.cancel).toHaveBeenCalledOnce();expect(response.headers.get('X-Token-Flow-Output-Limit')).toContain('advisory');
 const history=path==='responses'?[{role:'user',content:'Echo ping'},...result.output,{type:'function_call_output',call_id:call.call_id,output:'pong'}]:path==='messages'?[{role:'assistant',content:result.content},{role:'user',content:[{type:'tool_result',tool_use_id:call.id,content:'pong'}]}]:[result.choices[0].message,{role:'tool',tool_call_id:call.id,content:'pong'}];
 let prompt='';sdk.create.mockResolvedValue({close:sdk.close,send:async(value:string)=>{prompt=value;return {wait:async()=>({status:'finished',result:'pong',usage:tokenUsage}),cancel:sdk.cancel};}});
 const next=await provider.response(path,{...body,...(path==='responses'?{input:history}:{messages:history}),stream:true},new AbortController().signal);
 expect(next.status).toBe(200);expect(await next.text()).toContain('pong');expect(prompt).toContain('pong');expect(prompt).toContain(call.call_id??call.id);
 await provider.close();
});
it('recovers model discovery using the official catalog without guessed models, and preserves last-known models on transient failure',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'private-fixture'}));sdk.models.mockRejectedValue(new TypeError('secret upstream details'));
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({items:[{id:'returned-model',displayName:'Returned model'}]}));
 const provider=new CursorProvider(root,secrets);await provider.load();expect(provider.snapshot().models[0].id).toBe('cursor/returned-model');expect(fetcher.mock.calls[0][0]).toBe('https://api.cursor.com/v1/models');expect(fetcher.mock.calls[0][1]?.redirect).toBe('error');
 fetcher.mockRejectedValue(new TypeError('private-fixture'));await provider.refresh();expect(provider.snapshot().models).toHaveLength(1);expect(provider.snapshot().accounts[0].modelError).toContain('网络');expect(JSON.stringify(provider.snapshot())).not.toContain('private-fixture');
 sdk.models.mockRejectedValue(Object.assign(new Error('private-fixture'),{status:401}));await provider.refresh();expect(provider.snapshot().models).toEqual([]);expect(provider.snapshot().accounts[0].modelError).toContain('重新连接');
});
it('connects Cursor to all local Agent targets and routes maintenance through the SDK instead of the sidecar',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'));await writeFile(join(root,'cliproxy','fixture-accounts.json'),'[]');
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')};
 const service=await createDesktopService({root,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),proxyPort:port,token:'admin-token',localKey:'internal',secrets,agentPaths:paths,agentProcesses:async()=>[]});cleanup.push(()=>service.app.close());await service.proxy.start();await expect.poll(()=>service.proxy.snapshot().models.length).toBe(1);
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};const sourceId=service.proxy.cursor.id!;const model='cursor/fixture-model';
 for(const target of ['codex','claude','qoder','workbuddy']){
  const state=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id===target);
  const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target,sourceId,model,revision:state.revision}});
  expect(connected.statusCode,connected.body).toBe(200);expect(connected.json().verification.checks.every((c:{ok:boolean})=>c.ok)).toBe(true);
  expect(await readFile(paths[target as keyof typeof paths],'utf8')).toContain(model);
 }
 const selected=await service.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId,model}});expect(selected.statusCode,selected.body).toBe(200);
 await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.status).toBe('ready');
 expect(sdk.create).toHaveBeenCalled();
});
it('reports plan_required without retrying a denied catalog or presenting endless sync',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));
 sdk.models.mockRejectedValue(Object.assign(new Error('private upstream'),{status:403,code:'plan_required'}));
 const fetcher=vi.spyOn(globalThis,'fetch');const provider=new CursorProvider(root,secrets);await provider.load();
 expect(fetcher).not.toHaveBeenCalled();expect(provider.snapshot().accounts[0]).toMatchObject({status:'模型同步失败',modelError:expect.stringContaining('plan_required')});expect(provider.snapshot().models).toEqual([]);
});
it('supports Responses custom text tools and keeps their text results in the next turn',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);await provider.load();
 sdk.create.mockImplementation(async options=>({agentId:'agent-fixture',close:sdk.close,send:async()=>{
  let finish!:(value:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
  return {cancel:async()=>finish({status:'cancelled',usage:tokenUsage}),wait:()=>{void options.local.customTools.client_0.execute({input:'*** Begin Patch\n*** End Patch'},{});return pending;}};
 }}));
 const body={model:'cursor/fixture-model',input:'Prepare a patch',tools:[{type:'custom',name:'apply_patch',description:'Apply a patch',format:{type:'text'}}],tool_choice:{type:'custom',name:'apply_patch'}};
 const response=await provider.response('responses',body,new AbortController().signal);const result=await response.json();expect(response.status).toBe(200);expect(result.output[0].id).toMatch(/^ctc_/);expect(result.output[0]).toMatchObject({type:'custom_tool_call',name:'apply_patch',input:'*** Begin Patch\n*** End Patch'});
 const next=parseCursorInput('responses',{...body,input:[...result.output,{type:'custom_tool_call_output',call_id:result.output[0].call_id,output:'Applied'}]});expect(next.prompt).toContain('Applied');
});
it('lets the real Pi Responses client consume the streamed tool call',async()=>{
 const {streamSimple}=await import('@earendil-works/pi-ai/api/openai-responses');const {normalizeContext}=await import('@earendil-works/pi-ai/utils/transcript');const {Type}=await import('typebox');
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);await provider.load();toolRun();
 const model={id:'cursor/fixture-model',name:'Fixture',api:'openai-responses' as const,provider:'token-flow',baseUrl:'http://127.0.0.1:8317/v1',reasoning:false,input:['text' as const],contextWindow:32768,maxTokens:2048,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}};
 const transport:typeof fetch=async(input,init)=>{const request=new Request(input,init);return provider.response('responses',await request.json(),request.signal);};
 const events=streamSimple(model,normalizeContext({messages:[{role:'user',content:'Echo ping',timestamp:Date.now()}],tools:[{name:'client_echo',description:'Echo input',parameters:Type.Object({value:Type.String()})}]}),{apiKey:'local-fixture',fetch:transport,maxRetries:0});
 const result=await events.result();expect(result.stopReason,result.errorMessage).toBe('toolUse');expect(result.content).toContainEqual(expect.objectContaining({type:'toolCall',name:'client_echo',arguments:{value:'ping'}}));
 await provider.close();
});
it('cancels the SDK request when the client disconnects and releases the single-request slot',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);await provider.load();
 let finish!:(result:unknown)=>void;const pending=new Promise(resolve=>{finish=resolve;});
 sdk.cancel.mockImplementation(async()=>finish({status:'cancelled'}));sdk.create.mockResolvedValue({close:sdk.close,send:async()=>({wait:()=>pending,cancel:sdk.cancel})});
 const controller=new AbortController();const response=provider.response('responses',{model:'cursor/fixture-model',input:'hi'},controller.signal);
 await expect.poll(()=>sdk.create.mock.calls.length).toBe(1);controller.abort();expect((await response).status).toBe(499);
 sdk.create.mockResolvedValue({close:sdk.close,send:async()=>({wait:async()=>({status:'finished',result:'OK',usage:tokenUsage}),cancel:sdk.cancel})});
 expect((await provider.response('responses',{model:'cursor/fixture-model',input:'hi'},new AbortController().signal)).status).toBe(200);
});

it('refreshes an expired Cursor catalog and does not retain an old list indefinitely',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture-key'}));const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);await provider.load();
 sdk.models.mockResolvedValue([{id:'new-model',displayName:'New'}]);vi.mocked(Date.now).mockReturnValue(now+31000);
 await provider.refreshIfStale();expect(provider.snapshot().models.map(m=>m.id)).toEqual(['cursor/new-model']);
 sdk.models.mockRejectedValue(new Error('offline'));vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('offline'));
 vi.mocked(Date.now).mockReturnValue(now+40000);await provider.refresh();expect(provider.snapshot().models).toHaveLength(1);
 vi.mocked(Date.now).mockReturnValue(now+16*60000);await provider.refreshIfStale();expect(provider.snapshot().models).toEqual([]);
});

it('settles cancelled tool handoffs from the matching official bill so capped keys can continue and still stop at the cap',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'));await writeFile(join(root,'cliproxy','fixture-accounts.json'),'[]');
 const service=await createDesktopService({root,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),proxyPort:port,token:'admin-token',localKey:'internal',secrets});cleanup.push(()=>service.app.close());await service.proxy.start();await service.proxy.cursor.load();await service.proxy.cursor.refresh();
 const admin={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};
 const key=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'Metered tools',models:['cursor/fixture-model'],sourceId:service.proxy.cursor.id,tokenLimit:26}})).json();
 toolRun(false);sdk.runUsage.mockResolvedValue(tokenUsage);
 const client={host:admin.host,authorization:`Bearer ${key.apiKey}`};
 for(let i=0;i<2;i++){
  const result=await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model:'cursor/fixture-model',input:'Echo ping',stream:i===1,tools:[{type:'function',name:'client_echo',parameters:{type:'object'}}],tool_choice:'required'}});
  expect(result.statusCode,result.body).toBe(200);
 }
 const state=(await service.app.inject({url:'/api/gateway-keys',headers:admin})).json().keys[0];expect(state.usedTokens).toBe(26);expect(state.unmeteredRequests).toBe(0);
 expect(sdk.runUsage).toHaveBeenCalledWith('agent-fixture',expect.any(Number),expect.any(AbortSignal));
 expect((await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model:'cursor/fixture-model',input:'hi'}})).statusCode).toBe(429);
 const unknown=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'Unknown bill',models:['cursor/fixture-model'],sourceId:service.proxy.cursor.id,tokenLimit:100}})).json();
 sdk.runUsage.mockRejectedValue(new Error('Billing unavailable'));
 const unknownClient={host:admin.host,authorization:`Bearer ${unknown.apiKey}`};
 const request={method:'POST' as const,url:'/v1/responses',headers:unknownClient,payload:{model:'cursor/fixture-model',input:'Echo ping',tools:[{type:'function',name:'client_echo',parameters:{type:'object'}}]}};
 expect((await service.app.inject(request)).statusCode).toBe(200);
 const blocked=await service.app.inject(request);expect(blocked.statusCode).toBe(429);expect(blocked.body).toContain('未结算');
});

it('keeps quota failures separate from model availability and never attributes old quota to a new login',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'first',email:'first@example.test'}));
 sdk.quota.mockResolvedValue({plan:'Pro',windows:[{id:'included',label:'Plan',used:1,limit:20,usedPercent:5}]});
 const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());await provider.load();const id=provider.id!;
 sdk.quota.mockRejectedValue(new Error('private upstream'));await provider.refresh();expect(provider.snapshot().models).toHaveLength(1);expect(provider.snapshot().quotas[id]).toMatchObject({status:'error',plan:'Pro',windows:[{used:1}],lastSuccessfulAt:expect.any(String)});
 await provider.beginLogin();await expect.poll(()=>provider.snapshot().login?.status).toBe('completed');expect(provider.snapshot().accounts).toHaveLength(2);const newId=provider.snapshot().accounts.find(a=>a.id!==id)!.id;expect(provider.snapshot().quotas[newId].windows).toEqual([]);expect(provider.snapshot().quotas[id].windows).toHaveLength(1);expect(JSON.stringify(provider.snapshot())).not.toContain('private upstream');
});

it('accepts actual Codex metadata and grouped tool catalogs without losing namespace identity',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());await provider.load();
 const body={model:'cursor/fixture-model',input:'Read',client_metadata:{'x-codex-turn-id':'fixture-turn'},tools:[{type:'function',name:'read',parameters:{type:'object'}},{type:'namespace',name:'fs',tools:[{type:'function',name:'read',parameters:{type:'object'}}]}],tool_choice:{type:'function',namespace:'fs',name:'read'}};
 const before=JSON.stringify(body);const parsed=parseCursorInput('responses',body);expect(parsed.tools).toHaveLength(1);expect(parsed.tools[0]).toMatchObject({name:'read',namespace:'fs'});expect(JSON.stringify(body)).toBe(before);
 toolRun();const response=await provider.response('responses',body,new AbortController().signal);expect(response.status).toBe(200);expect((await response.json()).output[0]).toMatchObject({name:'read',namespace:'fs',type:'function_call'});
});
it('bounds flattened Cursor tools and rejects duplicate names within the same namespace',()=>{
 const ns={type:'namespace',name:'fs',tools:[{type:'function',name:'read'}]};
 expect(()=>parseCursorInput('responses',{model:'cursor/test',input:'hello',tools:[ns,ns]})).toThrow();
 expect(()=>parseCursorInput('responses',{model:'cursor/test',input:'hello',tools:[{...ns,tools:Array.from({length:2049},(_,i)=>({type:'function',name:`read${i}`}))}]})).toThrow();
});

it('skips repeatedly unavailable SDK billing per account, expires the hint, and keeps official settlement',async()=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({version:1,accounts:[{apiKey:'first',email:'first@test'},{apiKey:'second',email:'second@test'}]}));
 const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());await provider.load();
 const getUsage=vi.fn().mockRejectedValue(Object.assign(new Error('Unsupported'),{status:403,code:'feature_unavailable'}));
 sdk.create.mockResolvedValue({agentId:'billing-fixture',close:sdk.close,getUsage,send:async()=>({wait:async()=>({status:'finished',result:'ok'}),cancel:sdk.cancel})});sdk.runUsage.mockResolvedValue(tokenUsage);
 const accounts=provider.snapshot().accounts;const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now);
 const send=(id:string)=>provider.response('responses',{model:'cursor/fixture-model',input:'hi'},new AbortController().signal,id);
 for(let i=0;i<3;i++){const r=await send(accounts[0].id);expect(r.status).toBe(200);expect((await r.json()).usage.total_tokens).toBe(13);}
 expect(getUsage).toHaveBeenCalledTimes(1);expect(sdk.runUsage).toHaveBeenCalledTimes(3);
 await send(accounts[1].id);expect(getUsage).toHaveBeenCalledTimes(2);
 vi.mocked(Date.now).mockReturnValue(now+300001);await send(accounts[0].id);expect(getUsage).toHaveBeenCalledTimes(3);
});
it.each([{status:403,code:'plan_required'},{status:500,code:'feature_unavailable'},{status:503,code:'unavailable'}])('retries SDK billing after transient or unrelated errors %j',async error=>{
 const {root,secrets}=await setup();await secrets.set('cursor-account',JSON.stringify({apiKey:'fixture'}));const provider=new CursorProvider(root,secrets);cleanup.push(()=>provider.close());await provider.load();
 const getUsage=vi.fn().mockRejectedValueOnce(Object.assign(new Error('Failure'),error)).mockResolvedValue({runs:[{}],usage:tokenUsage});
 sdk.create.mockResolvedValue({agentId:'agent-fixture',getUsage,close:sdk.close,send:async()=>({wait:async()=>({status:'finished',result:'ok'}),cancel:sdk.cancel})});sdk.runUsage.mockResolvedValue(tokenUsage);
 for(let i=0;i<2;i++)expect((await provider.response('responses',{model:'cursor/fixture-model',input:'hi'},new AbortController().signal)).status).toBe(200);
 expect(getUsage).toHaveBeenCalledTimes(2);expect(sdk.runUsage).toHaveBeenCalledTimes(1);
});
