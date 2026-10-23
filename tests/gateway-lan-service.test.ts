import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,readFile,rm,writeFile,realpath} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createDesktopService} from '../packages/core/src/service.js';
import {GatewayKeys,gatewayKeyInput} from '../packages/core/src/gateway-keys.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const close of cleanup.splice(0).reverse())await close();});
async function freePort(){
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));
 const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));return port;
}
async function setup(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'gateway-lan-')));cleanup.push(()=>rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50}));
 await writeFile(join(root,'gateway-access.json'),JSON.stringify({enabled:false,port:await freePort(),allowedIPs:[]}));
 await mkdir(join(root,'cliproxy'));
 await writeFile(join(root,'cliproxy','fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['first','second']}]));
 const store=await GatewayKeys.open(root);
 const internal=await store.create(gatewayKeyInput.parse({name:'Internal Agent',sourceId:'a'.repeat(24),models:['codex/first']}));
 const legacy=await store.create(gatewayKeyInput.parse({name:'Legacy client',models:['codex/first']}));
 const options={root,proxyPort:await freePort(),binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'sidecar',secrets:{get:async()=>'',set:async()=>{}}};
 const service=await createDesktopService(options);
 cleanup.push(()=>service.app.close());await service.proxy.start();
 const admin={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const save=(payload:object)=>service.app.inject({method:'PUT',url:'/api/gateway/access',headers:admin,payload});
 const create=async(access:'local'|'lan')=>{
  const result=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:access,access,models:['codex/first']}});
  expect(result.statusCode,result.body).toBe(200);return result.json();
 };
 return {root,service,options,admin,save,create,internal,legacy};
}
it('offers an opt-in API-only LAN entrance while keeping local management and old keys local',async()=>{
 const {service,admin,save,create,internal}=await setup();
 expect((await service.app.inject({url:'/api/gateway/access',headers:admin})).json()).toMatchObject({enabled:false,running:false});
 const local=await create('local'),lan=await create('lan');const port=await freePort();
 const enabled=await save({enabled:true,port,allowedIPs:[]});expect(enabled.statusCode,enabled.body).toBe(200);expect(enabled.json().running).toBe(true);
 expect(service.access.app.server.address()).toMatchObject({address:'0.0.0.0',port});
 const origin=`http://127.0.0.1:${port}`;
 const rejectedHeaders:Record<string,string>[]=[{},{authorization:'Bearer admin'},{cookie:'agent_session=admin'},{authorization:`Bearer ${local.apiKey}`},{authorization:`Bearer ${internal.apiKey}`}];
 for(const headers of rejectedHeaders){
  expect((await fetch(`${origin}/v1/models`,{headers})).status).toBe(401);
 }
 const headers={authorization:`Bearer ${lan.apiKey}`};
 expect((await (await fetch(`${origin}/v1/models`,{headers})).json()).data.map((m:{id:string})=>m.id)).toEqual(['codex/first']);
 for(const path of ['/api/settings','/api/gateway-keys','/api/gateway/access','/v0/management/auth-files','/','/health']){
  expect((await fetch(`${origin}${path}`,{headers})).status).toBe(404);
 }
 expect((await service.app.inject({url:'/api/gateway/access',headers:{host:'192.168.1.2:9527',authorization:'Bearer admin'}})).statusCode).toBe(403);
 expect((await service.app.inject({url:'/api/gateway/access',headers:{host:admin.host,...headers}})).statusCode).toBe(401);
 const promotion=await service.app.inject({method:'PUT',url:`/api/gateway-keys/${internal.key.id}`,headers:admin,payload:{name:'Internal Agent',access:'lan',models:['codex/first']}});
 expect(promotion.statusCode).toBe(400);
 await save({enabled:false,port,allowedIPs:[]});expect(service.access.snapshot().running).toBe(false);
});
it('shares protocol scopes, streaming, usage and immediate access revocation across both entrances',async()=>{
 const {root,service,admin,save,create}=await setup();const {key,apiKey}=await create('lan');const port=await freePort();
 expect((await save({enabled:true,port,allowedIPs:[]})).statusCode).toBe(200);
 const origin=`http://127.0.0.1:${port}`,headers={authorization:`Bearer ${apiKey}`,'content-type':'application/json'};
 for(const path of ['responses','chat/completions','messages']){
  const response=await fetch(`${origin}/v1/${path}`,{method:'POST',headers,body:JSON.stringify({model:'codex/first',input:'hello',messages:[{role:'user',content:'hello'}],max_tokens:64,stream:true})});
  expect(response.status).toBe(200);expect(response.headers.get('content-type')).toContain('text/event-stream');expect(await response.text()).toContain('codex');
 }
 const denied=await fetch(`${origin}/v1/responses`,{method:'POST',headers,body:JSON.stringify({model:'codex/second',input:'hello'})});expect(denied.status).toBe(403);await denied.text();
 await expect.poll(async()=>(await GatewayKeys.open(root)).authenticate(apiKey)?.usedTokens).toBe(30);
 const renamed=await service.app.inject({method:'PUT',url:`/api/gateway-keys/${key.id}`,headers:admin,payload:{name:'Renamed',models:key.models}});expect(renamed.json().access).toBe('lan');
 const sourceId=service.proxy.snapshot().accounts[0].id;
 const changed=await service.app.inject({method:'PUT',url:`/api/gateway-keys/${key.id}/models`,headers:admin,payload:{access:'local',selections:[{sourceId,model:'codex/first'}]}});expect(changed.statusCode,changed.body).toBe(200);
 expect(service.access.snapshot()).toMatchObject({enabled:false,running:false});
 await expect(fetch(`${origin}/v1/models`,{headers})).rejects.toThrow();
 expect((await service.app.inject({url:'/v1/models',headers:{...headers,host:admin.host}})).statusCode).toBe(200);
 expect(await readFile(join(root,'gateway-keys.json'),'utf8')).not.toContain(apiKey);
});
it('lets legacy exported keys opt into LAN when their model permissions are explicitly saved',async()=>{
 const {service,admin,legacy}=await setup();
 const result=await service.app.inject({method:'PUT',url:`/api/gateway-keys/${legacy.key.id}/models`,headers:admin,payload:{access:'lan',selections:[{model:'codex/first',sourceId:service.proxy.snapshot().accounts[0].id}]}});
 expect(result.statusCode,result.body).toBe(200);expect(result.json()).toMatchObject({access:'lan',exported:true});
});
it('keeps old IP restrictions on their keys without silently restricting newly created LAN keys',async()=>{
 const {service,admin,save,create}=await setup();const existing=await create('lan');
 const port=service.access.snapshot().port;
 await save({enabled:true,port,allowedIPs:['192.0.2.10']});
 const renamed=await service.app.inject({method:'PUT',url:`/api/gateway-keys/${existing.key.id}`,headers:admin,payload:{name:'Existing device',models:['codex/first']}});
 expect(renamed.statusCode,renamed.body).toBe(200);
 const created=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'New device',access:'lan',allowedIPs:[],models:['codex/first']}});
 expect(created.statusCode,created.body).toBe(200);
 const origin=`http://127.0.0.1:${port}`;
 const fresh=await fetch(`${origin}/v1/models`,{headers:{authorization:`Bearer ${created.json().apiKey}`}});
 expect(fresh.status).toBe(200);await fresh.text();
 const restricted=await fetch(`${origin}/v1/models`,{headers:{authorization:`Bearer ${existing.apiKey}`}});
 expect(restricted.status).toBe(403);await restricted.text();
 const keys=(await service.app.inject({url:'/api/gateway-keys',headers:admin})).json().keys;
 expect(keys.find((key:{id:string})=>key.id===existing.key.id).allowedIPs).toEqual(['192.0.2.10']);
 expect(service.access.snapshot().allowedIPs).toEqual([]);
});
it('restores an enabled listener when the desktop starts and closes it with the local service',async()=>{
 const {service,options,save,create}=await setup();const port=await freePort();await create('lan');
 expect((await save({enabled:true,port,allowedIPs:[]})).statusCode).toBe(200);
 await service.app.close();expect(service.access.app.server.listening).toBe(false);
 const restarted=await createDesktopService(options);cleanup.push(()=>restarted.app.close());
 expect(restarted.access.snapshot()).toMatchObject({enabled:true,running:false,port});
 await restarted.app.listen({host:'127.0.0.1',port:0});
 expect(restarted.access.snapshot()).toMatchObject({enabled:true,running:true,port});
 expect((await fetch(`http://127.0.0.1:${port}/v1/models`)).status).toBe(401);
 await restarted.app.close();expect(restarted.access.app.server.listening).toBe(false);
});
it('keeps LAN closed on startup when old access settings remain but no enabled LAN keys exist',async()=>{
 const {service,options,save}=await setup();const port=await freePort();
 expect((await save({enabled:true,port,allowedIPs:[]})).statusCode).toBe(200);
 await service.app.close();
 const restarted=await createDesktopService(options);cleanup.push(()=>restarted.app.close());
 await restarted.app.listen({host:'127.0.0.1',port:0});
 expect(restarted.access.snapshot()).toMatchObject({enabled:false,running:false});
});
it('settles interrupted LAN generations when the entrance is disabled without blocking local calls',async()=>{
 const {root,service,save,create}=await setup();const {apiKey}=await create('lan'),port=await freePort();
 await save({enabled:true,port,allowedIPs:[]});
 const realFetch=globalThis.fetch;
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const url=new URL(String(input));
  if(url.port===String(service.proxy.port)&&url.pathname==='/v1/responses')return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('data: {"type":"response.created","response":{"id":"hanging","status":"in_progress","output":[]}}\n\n'));}}),{headers:{'content-type':'text/event-stream'}});
  return realFetch(input,init);
 });
 const response=await fetch(`http://127.0.0.1:${port}/v1/responses`,{method:'POST',headers:{authorization:`Bearer ${apiKey}`,'content-type':'application/json'},body:JSON.stringify({model:'codex/first',input:'hello',stream:true})});
 const reader=response.body!.getReader();await reader.read();
 const disabled=await save({enabled:false,port,allowedIPs:[]});expect(disabled.statusCode,disabled.body).toBe(200);
 try{while(!(await reader.read()).done){/* Drain until the entrance closes. */}}catch{/* Expected transport interruption. */}
 await expect.poll(async()=>(await GatewayKeys.open(root)).authenticate(apiKey)?.pendingRequests).toBe(0);
 expect((await GatewayKeys.open(root)).authenticate(apiKey)?.unmeteredRequests).toBe(1);
 expect((await service.app.inject({url:'/v1/models',headers:{host:'127.0.0.1:9527',authorization:`Bearer ${apiKey}`}})).statusCode).toBe(200);
});
