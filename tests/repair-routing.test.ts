import {fakeWorkbuddySDK} from './fixtures/fake-workbuddy-sdk.js';
import { it,expect,vi } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import { parse,stringify } from 'smol-toml';
import { createDesktopService } from '../packages/core/src/service.js';

async function fixture(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'repair-routing-'));
 const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
 await mkdir(join(root,'cliproxy'));
 const accounts=[{name:'qoder.json',provider:'qoder',status:'active',models:['kmodel_latest']},{name:'workbuddy.json',provider:'workbuddy',status:'active',models:['hy4-preview']}];
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(accounts));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude.json'),workbuddy:join(root,'workbuddy.json'),qoder:join(root,'qoder.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/settings.json')};
 const service=await createDesktopService({workbuddySDKFactory:fakeWorkbuddySDK,root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin-fixture',localKey:'internal-fixture',secrets:{get:async()=>'',set:async()=>{}},agentPaths:paths,agentProcesses:async()=>[]});await service.proxy.start();
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-fixture'};
 const post=(url:string,payload:unknown)=>service.app.inject({method:'POST',url,headers,payload:payload as object});
 const state=async(target:string)=>(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id===target);
 return {root,port,accounts,paths,service,headers,post,state,close:async()=>{await service.app.close();await rm(root,{recursive:true,force:true});}};
}

it('runs source-pinned HTTP probes across Agent protocols, cleans temporary Keys and preserves failures',async()=>{
 const f=await fixture();try{
  await f.service.app.listen({host:'127.0.0.1',port:0});const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  const input={sourceId:source.id,model:'qoder/kmodel_latest'};const keys=async()=>(await f.service.app.inject({url:'/api/gateway-keys',headers:f.headers})).json().keys;
  const before=await keys();
  expect((await f.service.app.inject({method:'POST',url:'/api/maintenance/http-probe',headers:{host:f.headers.host},payload:input})).statusCode).toBe(401);
  expect((await f.post('/api/maintenance/http-probe',{...input,url:'http://untrusted.invalid'})).statusCode).toBe(400);
  for(const protocol of ['responses','messages','chat/completions']){
   const response=await f.post('/api/maintenance/http-probe',{...input,protocol});expect(response.statusCode,response.body).toBe(200);expect(response.json()).toMatchObject({passed:true,protocol,sourceId:source.id,model:input.model,clientVerified:false});expect(response.body).not.toContain('tfl_');expect(await keys()).toEqual(before);
  }
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({mode:'claude-source-policy'})});
  const failed=await f.post('/api/maintenance/http-probe',{...input,protocol:'messages'});expect(failed.json()).toMatchObject({passed:false,httpStatus:400,category:'source_policy'});expect(await keys()).toEqual(before);
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({mode:'truncated-stream'})});
  const truncated=await f.post('/api/maintenance/http-probe',input);expect(truncated.json().passed).toBe(false);expect(await keys()).toEqual(before);
 }finally{await f.close();}
},20000);

it('lets a pinned known model recover when the public catalog hides it after an upstream failure',async()=>{
 const f=await fixture();try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  const key=(await f.post('/api/gateway-keys',{name:'Qoder recovery',sourceId:source.id,models:['qoder/kmodel_latest']})).json();
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({accounts:f.accounts.map(a=>a.provider==='qoder'?{...a,status:'error',unavailable:false,hiddenModels:['qoder/kmodel_latest']}:a)})});await f.service.proxy.refreshAccounts();
  const response=await f.service.app.inject({method:'POST',url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${key.apiKey}`},payload:{model:'qoder/kmodel_latest',input:'Reply OK'}});
  expect(response.statusCode,response.body).toBe(200);expect(response.json().model).toBe('qoder/kmodel_latest');
 }finally{await f.close();}
});

it('preserves a Claude source policy rejection and makes it available to repair diagnosis',async()=>{
 const f=await fixture();try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='workbuddy')!;
  const connected=await f.post('/api/a2a/connect',{target:'claude',sourceId:source.id,model:'workbuddy/hy4-preview',revision:(await f.state('claude')).revision});expect(connected.statusCode).toBe(200);
  const cfg=JSON.parse(await readFile(f.paths.claude,'utf8'));
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({mode:'claude-source-policy'})});
  const response=await f.service.app.inject({method:'POST',url:'/v1/messages',headers:{host:f.headers.host,'x-api-key':cfg.env.ANTHROPIC_AUTH_TOKEN},payload:{model:'workbuddy/hy4-preview',max_tokens:1024,messages:[{role:'user',content:'OK'}]}});
  expect(response.statusCode).toBe(400);expect(response.json().error.type).toBe('source_policy_blocked');expect(response.json().error.message).toContain('本次请求');expect(response.json().error.message).toContain('11128');expect(response.json().error.message).toContain('其他测试会话成功不代表当前客户端已恢复');
  const proposed=await f.post('/api/maintenance/propose',{chain:{target:'claude',sourceId:source.id,model:'workbuddy/hy4-preview',connectionId:connected.json().id}});
  expect(proposed.json()).toMatchObject({needed:false,reason:'source_policy_blocked'});expect(proposed.json().message).toContain('来源');
 }finally{await f.close();}
});

it('recognizes login accounts in network diagnostics and does not send credentials',async()=>{
 const f=await fixture();const nativeFetch=globalThis.fetch;let requests=0;
 const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(String(input)==='https://copilot.tencent.com/'){expect(init?.method).toBe('HEAD');expect(init?.headers).toBeUndefined();requests++;return new Response(null,{status:405});}
  return nativeFetch(input,init);
 });
 try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='workbuddy')!;
  const response=await f.post('/api/maintenance/local/diagnose',{target:'qoder',sourceId:source.id});expect(response.statusCode,response.body).toBe(200);
  await expect.poll(async()=>(await f.service.app.inject({url:'/api/maintenance/local',headers:f.headers})).json().active).toBeUndefined();expect(requests).toBe(1);
 }finally{spy.mockRestore();await f.close();}
});

it.each(['codex','claude','workbuddy','qoder'] as const)('previews and applies %s routing repair despite external URL/key/model edits',async target=>{
 const f=await fixture();try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  const connected=await f.post('/api/a2a/connect',{target,sourceId:source.id,model:'qoder/kmodel_latest',revision:(await f.state(target)).revision});expect(connected.statusCode,connected.body).toBe(200);
  const original=await readFile(f.paths[target],'utf8');const doc:any=target==='codex'?parse(original):JSON.parse(original);
  if(target==='codex'){doc.model='external';doc.model_providers.token_flow.base_url='http://localhost:9999/v1';doc.model_providers.token_flow.experimental_bearer_token='external-secret';doc.keep='user-setting';}
  if(target==='claude'){doc.model='external';doc.env.ANTHROPIC_BASE_URL='http://localhost:9999';doc.env.ANTHROPIC_AUTH_TOKEN='external-secret';doc.env.KEEP='user-setting';}
  if(target==='workbuddy'){doc[0].url='http://localhost:9999/v1/chat/completions';doc[0].apiKey='external-secret';doc.push({id:'user-added',apiKey:'keep-private'});}
  if(target==='qoder'){doc.providers['token-flow'].baseUrl='http://localhost:9999/v1';doc.providers['token-flow'].apiKey='external-secret';doc.keep='user-setting';}
  const changed=target==='codex'?stringify(doc):JSON.stringify(doc);await writeFile(f.paths[target],changed);
  const proposed=await f.post('/api/maintenance/propose',{rewrite:true,chain:{target,sourceId:source.id,model:'qoder/kmodel_latest',connectionId:connected.json().id}});
  expect(proposed.statusCode,proposed.body).toBe(200);expect(proposed.json().status).toBe('pending');expect(proposed.body).not.toContain('external-secret');expect(proposed.body).not.toContain('keep-private');expect(await readFile(f.paths[target],'utf8')).toBe(changed);
  const approved=await f.post('/api/maintenance/approve',{id:proposed.json().id,approve:true});expect(approved.json().proposal.status,approved.body).toBe('completed');
  const next=await readFile(f.paths[target],'utf8');expect(next).not.toContain('localhost:9999');expect(next).not.toContain('external-secret');expect(next).toContain('tfl_');expect(next).toContain(target==='workbuddy'?'user-added':'user-setting');
  const status=await f.state(target);expect(status.configurationState).toBe('configured');
  const renew=await f.post('/api/maintenance/propose',{rewrite:true,chain:{target,sourceId:source.id,model:'qoder/kmodel_latest',connectionId:status.connection.id}});expect(renew.json().status).toBe('pending');
  await writeFile(f.paths[target],next+'\n');
  const stale=await f.post('/api/maintenance/approve',{id:renew.json().id,approve:true});expect(stale.json().proposal.status).toBe('failed');expect(await readFile(f.paths[target],'utf8')).toBe(next+'\n');
 }finally{await f.close();}
});

it('uses the selected page instead of a stale Agent chain and exposes resumable local history',async()=>{
 const f=await fixture();try{
  const source=f.service.proxy.snapshot().accounts.find(account=>account.provider==='qoder')!;
  const chosen=await f.service.app.inject({method:'PUT',url:'/api/maintenance',headers:f.headers,payload:{sourceId:source.id,model:'qoder/kmodel_latest'}});expect(chosen.statusCode,chosen.body).toBe(200);
  const maintenance=async()=>(await f.service.app.inject({url:'/api/maintenance',headers:f.headers})).json();
  expect((await f.post('/api/maintenance/check',{})).statusCode).toBe(200);await expect.poll(async()=>(await maintenance()).readiness.status).toBe('ready');
  expect((await f.post('/api/maintenance/run',{prompt:'检查 Pi',chain:{target:'pi'},context:{page:'agents',target:'pi'},interfaceAgent:'pi'})).statusCode).toBe(200);
  await expect.poll(async()=>(await maintenance()).status).toBe('completed');
  const previous=(await maintenance()).conversationId;
  expect((await f.post('/api/maintenance/run',{prompt:'检查代理 Key',context:{page:'proxy'}})).statusCode).toBe(200);
  await expect.poll(async()=>(await maintenance()).status).toBe('completed');
  const current=await maintenance();expect(current.chain).toBeUndefined();expect(current.context).toEqual({page:'proxy'});
  const inspection=JSON.parse(current.messages.find((message:{text:string})=>message.text.startsWith('只读预检: ')).text.slice('只读预检: '.length));
  expect(inspection.selectedAgent).toBeNull();expect(inspection.chain).toBeNull();expect(inspection.pageContext).toEqual({page:'proxy'});expect(inspection.pageData).toHaveProperty('keys');
  const history=(await f.service.app.inject({url:'/api/maintenance/history',headers:f.headers})).json().conversations;expect(history).toHaveLength(2);
  expect((await f.service.app.inject({url:'/api/maintenance/history',headers:{host:f.headers.host}})).statusCode).toBe(401);
  const resumed=await f.post(`/api/maintenance/history/${previous}/resume`,{});expect(resumed.statusCode,resumed.body).toBe(200);expect(resumed.json().context).toEqual({page:'agents',target:'pi'});
  expect((await f.service.app.inject({url:`/api/maintenance/history/${previous}`,headers:f.headers})).json().title).toBe('检查 Pi');
 }finally{await f.close();}
},15000);

it('preflights the selected Key and date from the same usage ledger without exposing the Key or unrelated Agent state',async()=>{
 const f=await fixture();try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  const key=(await f.post('/api/gateway-keys',{name:'Selected usage',sourceId:source.id,models:['qoder/kmodel_latest']})).json();
  const response=await f.service.app.inject({method:'POST',url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${key.apiKey}`},payload:{model:'qoder/kmodel_latest',input:'OK'}});expect(response.statusCode,response.body).toBe(200);
  await f.service.app.inject({method:'PUT',url:'/api/maintenance',headers:f.headers,payload:{sourceId:source.id,model:'qoder/kmodel_latest'}});
  const snapshot=async()=>(await f.service.app.inject({url:'/api/maintenance',headers:f.headers})).json();
  expect((await f.post('/api/maintenance/check',{})).statusCode).toBe(200);await expect.poll(async()=>(await snapshot()).readiness.status).toBe('ready');
  const context={page:'proxy',range:'today',origin:'gateway',keyId:key.key.id};
  expect((await f.post('/api/maintenance/run',{prompt:'今天的模型生成速度',context})).statusCode).toBe(200);
  await expect.poll(async()=>(await snapshot()).status).toBe('completed');
  const result=await snapshot();const inspection=JSON.parse(result.messages.find((m:{text:string})=>m.text.startsWith('只读预检: ')).text.slice(6));
  expect(inspection.pageContext).toEqual(context);expect(inspection.pageData.keys.map((k:{id:string})=>k.id)).toEqual([key.key.id]);
  expect(inspection.pageData.usage).toMatchObject({requests:1,scope:{keyId:key.key.id,origin:'gateway'},modelCount:1});
  expect(inspection.pageData.usage.models[0]).toMatchObject({model:'qoder/kmodel_latest',tokensPerSecond:null});
  expect(inspection.selectedAgent).toBeNull();expect(JSON.stringify(inspection)).not.toContain(key.apiKey);
 }finally{await f.close();}
},15000);

it('opens old-conversation repair as read-only diagnosis with current routing evidence, without migrating or restoring',async()=>{
 const f=await fixture();try{
  const {DatabaseSync}=await import('node:sqlite');await mkdir(join(f.root,'codex'),{recursive:true});await writeFile(f.paths.codex,'model = "official-test"\n');
  const db=new DatabaseSync(join(f.root,'codex/state_5.sqlite'));db.exec('CREATE TABLE threads (id TEXT, model_provider TEXT, model TEXT, rollout_path TEXT, archived INTEGER, source TEXT)');db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?, ?, ?)').run('stale-thread','token_flow','qoder/old','/private/must-not-be-sent.jsonl',0,'cli');db.close();
  const before=await readFile(f.paths.codex,'utf8');
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  await f.service.app.inject({method:'PUT',url:'/api/maintenance',headers:f.headers,payload:{sourceId:source.id,model:'qoder/kmodel_latest'}});
  const snapshot=async()=>(await f.service.app.inject({url:'/api/maintenance',headers:f.headers})).json();expect((await f.post('/api/maintenance/check',{})).statusCode).toBe(200);await expect.poll(async()=>(await snapshot()).readiness.status).toBe('ready');
  expect((await f.post('/api/maintenance/run',{prompt:'检查切换后旧对话',context:{page:'agents',target:'codex',intent:'codex-history'},chain:{target:'codex'}})).statusCode).toBe(200);
  await expect.poll(async()=>(await snapshot()).status).toBe('completed');
  const result=await snapshot(),text=result.messages.find((m:{text:string})=>m.text.startsWith('只读预检: ')).text;const evidence=JSON.parse(text.slice(6)).pageData;
  expect(evidence.current).toMatchObject({provider:'openai',model:'official-test'});expect(evidence.threads).toMatchObject({available:true,mismatched:1});expect(evidence.threads.samples[0].id).toBe('stale-thread');expect(evidence.switchHistory).toEqual([]);
  expect(text).not.toContain('/private/must-not-be-sent');expect(await readFile(f.paths.codex,'utf8')).toBe(before);expect(result.proposal).toBeUndefined();
  const after=new DatabaseSync(join(f.root,'codex/state_5.sqlite'),{readOnly:true});expect(after.prepare('SELECT model_provider FROM threads').get()?.model_provider).toBe('token_flow');after.close();
 }finally{await f.close();}
},15000);
