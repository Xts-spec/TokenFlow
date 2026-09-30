import { afterEach, expect, it } from 'vitest';
import { createServer } from 'node:http';
import { mkdtemp, rm, readFile, writeFile, mkdir, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { ApiSources, apiModelID } from '../packages/core/src/api-sources.js';
import { createDesktopService } from '../packages/core/src/service.js';
import { defaultProvider } from '../packages/core/src/providers.js';
import { createSecrets } from '../apps/desktop/src/secrets.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(real=false){
 const root=await realpath(await mkdtemp(join(tmpdir(),'api-sources-')));cleanup.push(()=>rm(root,{recursive:true,force:true}));await mkdir(join(root,'secrets'));
 const storage={isEncryptionAvailable:()=>true,encryptString:(v:string)=>Buffer.from(Buffer.from(v).map(b=>b^0x73)),decryptString:(v:Buffer)=>Buffer.from(Buffer.from(v).map(b=>b^0x73)).toString()};
 const secrets=createSecrets(root,storage);const calls:Array<{path:string;key:string;body:Record<string,unknown>}>=[];
 const upstream=createServer(async(req,res)=>{
  res.setHeader('content-type','application/json');const pathname=new URL(req.url!,'http://127.0.0.1').pathname;let raw='';for await(const c of req)raw+=c;const body=raw?JSON.parse(raw):{};
  const key=String(req.headers.authorization??req.headers['x-api-key']??'');calls.push({path:req.url!,key,body});
  if((JSON.stringify(body.input)??'').includes('secret-error')){res.setHeader('content-type','text/event-stream');res.end(`event: error\ndata: ${JSON.stringify({type:'error',message:key,error:{message:'secret-private-upstream-detail'}})}\n\n`);return;}
  if(pathname==='/v1/models'){res.end(JSON.stringify({data:[{id:'shared'},{id:'forbidden'}]}));return;}
  if(body.model==='forbidden'){res.writeHead(403);res.end(JSON.stringify({error:{message:'secret-key-DO-NOT-RETURN'}}));return;}
  const usage={input_tokens:7,output_tokens:3};
  const response={id:'resp_fixture',object:'response',status:'completed',model:body.model,output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:key,annotations:[]}]}],usage};
  if(pathname==='/v1/chat/completions'){
   const chat={id:'chat-fixture',object:'chat.completion',model:body.model,choices:[{index:0,message:{role:'assistant',content:key},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:3,total_tokens:10}};
   if(body.stream){res.setHeader('content-type','text/event-stream');res.end(`data: ${JSON.stringify({...chat,object:'chat.completion.chunk',choices:[{index:0,delta:{role:'assistant',content:key},finish_reason:null}]})}\n\ndata: ${JSON.stringify({...chat,object:'chat.completion.chunk',choices:[{index:0,delta:{},finish_reason:'stop'}]})}\n\ndata: [DONE]\n\n`);}else res.end(JSON.stringify(chat));return;
  }
  if(pathname==='/v1/messages'){
   const message={id:'msg-fixture',type:'message',role:'assistant',model:body.model,content:[{type:'text',text:key}],stop_reason:'end_turn',usage};
   if(body.stream){res.setHeader('content-type','text/event-stream');res.end([{type:'message_start',message:{...message,content:[],usage:{input_tokens:7,output_tokens:0}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:key}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}},{type:'message_stop'}].map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));}else res.end(JSON.stringify(message));return;
  }
  if(body.stream){res.setHeader('content-type','text/event-stream');const events=[{type:'response.created',response:{...response,status:'in_progress',output:[],usage:null}},{type:'response.output_item.added',output_index:0,item:{...response.output[0],status:'in_progress',content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:''}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:key},{type:'response.output_item.done',output_index:0,item:response.output[0]},{type:'response.completed',response}];res.end(((JSON.stringify(body.input)??'').includes('truncate')?events.slice(0,2):events).map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));}else res.end(JSON.stringify(response));
 });
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>upstream.close(()=>r())));
 const baseURL=`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`;
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const options={root,secrets,binary:resolve(real?`sidecars/${process.platform}-${process.arch}/cliproxyapi`:'tests/fixtures/fake-cliproxy.mjs'),proxyPort:port,token:'admin',localKey:'internal-key',agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json'),qoder:join(root,'qoder/settings.json')},agentProcesses:async()=>[]};
 const service=await createDesktopService(options);
 cleanup.push(()=>service.app.close());await service.proxy.start();
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const add=async(name:string,apiKey:string,protocol='responses')=>{const r=await service.app.inject({method:'POST',url:'/api/sources',headers,payload:{name,apiKey,baseURL,protocol,models:['shared','forbidden']}});expect(r.statusCode,r.body).toBe(200);return r.json();};
 return {root,baseURL,secrets,calls,service,headers,add,options};
}
it('persists independent encrypted credentials and duplicate model names, and refuses corrupt registries',async()=>{
 const {root,secrets,baseURL,add,service}=await fixture();const a=await add('One','secret-A');const b=await add('Two','secret-B');
 expect(a.id).not.toBe(b.id);expect(a.credentialRef).toBeUndefined();expect(a.apiKey).toBeUndefined();
 const saved=await readFile(join(root,'api-sources.json'),'utf8');expect(saved).not.toContain('secret-A');expect(saved).not.toContain('secret-B');
 expect(await readFile(join(root,'cliproxy/config.yaml'),'utf8')).not.toContain('secret-A');
 const reopened=await ApiSources.open(root,secrets,defaultProvider);cleanup.push(()=>reopened.close());expect((await reopened.list()).map(s=>s.name)).toEqual(['One','Two']);
 expect(reopened.sourceFor(apiModelID(a.id,'shared'))?.id).toBe(a.id);
 const models=await service.app.inject({method:'POST',url:`/api/sources/${a.id}/models`,headers:{host:'127.0.0.1',authorization:'Bearer admin'},payload:{}});expect(models.json().models).toEqual(['shared','forbidden']);
 await expect(reopened.save({name:'bad',baseURL:'https://example.com/v1?key=secret',protocol:'responses',apiKey:'x',models:[]})).rejects.toThrow();
 await writeFile(join(root,'api-sources.json'),'broken');await expect(ApiSources.open(root,secrets,defaultProvider)).rejects.toThrow('已保留');expect(baseURL).toContain('127.0.0.1');
});
it('migrates legacy settings once, copies only ciphertext, and keeps legacy credentials/settings for rollback',async()=>{
 const {root,secrets,baseURL}=await fixture();const legacy={...defaultProvider,kind:'custom' as const,baseURL,model:'shared'};await writeFile(join(root,'settings.json'),JSON.stringify(legacy));await secrets.set('custom','legacy-secret');
 const store=await ApiSources.open(root,secrets,legacy);cleanup.push(()=>store.close());const sources=await store.list();expect(sources).toHaveLength(1);expect(sources[0].name).toBe('迁移的 API 来源');
 expect(await secrets.get('custom')).toBe('legacy-secret');expect(await readFile(join(root,'settings.json'),'utf8')).toBe(JSON.stringify(legacy));
 const backup=await readFile(join(root,'backups/api-sources-migration/custom.bin'));expect(backup).toEqual(await readFile(join(root,'secrets/custom.bin')));expect(backup.toString()).not.toContain('legacy-secret');
 const again=await ApiSources.open(root,secrets,legacy);cleanup.push(()=>again.close());expect(await again.list()).toHaveLength(1);
});
it('keeps the workspace available and legacy credentials intact if migration cannot encrypt the new slot',async()=>{
 const {root,secrets,baseURL}=await fixture();const legacy={...defaultProvider,kind:'custom' as const,baseURL,model:'shared'};
 await writeFile(join(root,'settings.json'),JSON.stringify(legacy));await secrets.set('custom','legacy-private-key');
 const store=await ApiSources.open(root,{get:secrets.get,set:async()=>{throw new Error('locked');}},legacy);cleanup.push(()=>store.close());
 expect(await store.list()).toEqual([]);expect(store.warnings()[0]).toContain('原配置和密钥已保留');expect(await secrets.get('custom')).toBe('legacy-private-key');
});
it('routes all three declared upstream protocols through the real sidecar, source scopes, budgets and activity',async()=>{
 const {service,headers,add,calls}=await fixture(true);
 for(const protocol of ['responses','chat','messages']){
  const source=await add(protocol,`secret-${protocol}`,protocol);const model=apiModelID(source.id,'shared');
  const key=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:protocol,sourceId:source.id,models:[model],tokenLimit:30}});expect(key.statusCode,key.body).toBe(200);
  const client={...headers,authorization:`Bearer ${key.json().apiKey}`};
  const request=()=>service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model,input:'Hi',stream:false}});
  let response=await request();if(response.statusCode===404){await new Promise(r=>setTimeout(r,1200));response=await request();}
    expect(response.statusCode,response.body).toBe(200);expect(response.json().output[0].content[0].text).toContain(`secret-${protocol}`);
  expect(calls.some(c=>c.body.model==='shared'&&c.key.includes(`secret-${protocol}`))).toBe(true);
  for(const route of ['chat/completions','messages']){
   const r=await service.app.inject({method:'POST',url:`/v1/${route}`,headers:client,payload:{model,messages:[{role:'user',content:'Hi'}],max_tokens:32}});
   expect(r.statusCode,r.body).toBe(200);expect(r.body).toContain(`secret-${protocol}`);
  }
  const measured=(await service.app.inject({url:'/api/gateway-keys',headers})).json().keys.find((k:{id:string})=>k.id===key.json().key.id);expect(measured.usedTokens).toBe(30);
  expect((await request()).statusCode).toBe(429);

  const check=await service.app.inject({method:'POST',url:`/api/sources/${source.id}/check`,headers,payload:{model}});expect(check.json().passed,check.body).toBe(true);if(protocol==='responses')expect(calls.at(-1)?.body.max_output_tokens).toBe(128);
  const deny=await service.app.inject({method:'POST',url:`/api/sources/${source.id}/check`,headers,payload:{model:apiModelID(source.id,'forbidden')}});expect(deny.json().passed).toBe(false);expect(deny.body).not.toContain('DO-NOT-RETURN');
  const activity=await service.app.inject({url:'/api/gateway/activity',headers});expect(activity.json().recent.some((r:{keyId:string})=>r.keyId===key.json().key.id)).toBe(true);
  const update=await service.app.inject({method:'PUT',url:`/api/sources/${source.id}`,headers,payload:{...source,credentialRef:undefined,checks:undefined,hasKey:undefined,id:undefined,createdAt:undefined,enabled:false}});expect(update.statusCode).toBe(409);
  const disabled=await service.app.inject({method:'PUT',url:`/api/sources/${source.id}`,headers,payload:{name:source.name,baseURL:source.baseURL,protocol,models:source.models,enabled:false,acknowledge:true}});expect(disabled.statusCode,disabled.body).toBe(200);
  expect((await request()).statusCode).toBe(503);expect((await service.app.inject({method:'DELETE',url:`/api/sources/${source.id}`,headers})).statusCode).toBe(409);
 }
},60000);
it('keeps two identical API types separate across a service restart, A2A configuration and repair calls',async()=>{
 const {root,service,headers,add,options,calls}=await fixture(true);
 const a=await add('Project A','project-A');const b=await add('Project B','project-B');
 const ma=apiModelID(a.id,'shared'),mb=apiModelID(b.id,'shared');
 const keys=[];
 for(const [source,model] of [[a,ma],[b,mb]] as const){const r=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:source.name,models:[model],sourceId:source.id,tokenLimit:40}});expect(r.statusCode,r.body).toBe(200);keys.push(r.json());}
 const wrong=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'wrong source',models:[mb],sourceId:a.id}});expect(wrong.statusCode).toBe(409);
 const target=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
 const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId:a.id,model:ma,revision:target.revision}});expect(connected.statusCode,connected.body).toBe(200);expect(await readFile(join(root,'codex/config.toml'),'utf8')).toContain(ma);
 await service.app.close();const restarted=await createDesktopService(options);cleanup.push(()=>restarted.app.close());await restarted.proxy.start();
 const snapshot=(await restarted.app.inject({url:'/api/local-agent',headers})).json();expect(snapshot.apiSources.map((s:{name:string})=>s.name)).toEqual(['Project A','Project B']);expect(snapshot.models.map((m:{id:string})=>m.id)).toEqual(expect.arrayContaining([ma,mb]));expect(snapshot.accounts).toEqual([]);
 let previous='';
 for(const [index,model] of [ma,mb].entries()){
  const response=await restarted.app.inject({method:'POST',url:'/v1/responses',headers:{...headers,authorization:`Bearer ${keys[index].apiKey}`},payload:{model,input:'Hi',store:true}});expect(response.statusCode,response.body).toBe(200);expect(response.json().output[0].content[0].text).toContain(index?'project-B':'project-A');if(!index)previous=response.json().id;
  for(const route of ['chat/completions','messages']){
   const converted=await restarted.app.inject({method:'POST',url:`/v1/${route}`,headers:{...headers,authorization:`Bearer ${keys[index].apiKey}`},payload:{model,messages:[{role:'user',content:'Hi'}],max_tokens:32}});
   expect(converted.statusCode,converted.body).toBe(200);expect(converted.body).toContain(index?'project-B':'project-A');
  }

 }
 const crossed=await restarted.app.inject({method:'POST',url:'/v1/responses',headers:{...headers,authorization:`Bearer ${keys[1].apiKey}`},payload:{model:mb,input:'continue',previous_response_id:previous}});expect(crossed.statusCode,crossed.body).toBe(400);
 const selected=await restarted.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId:b.id,model:mb}});expect(selected.statusCode,selected.body).toBe(200);
 await expect.poll(async()=>(await restarted.app.inject({url:'/api/maintenance',headers})).json().readiness.status).toBe('ready');
 const repair=await restarted.app.inject({method:'POST',url:'/api/maintenance/run',headers,payload:{prompt:'检查网关'}});expect(repair.statusCode,repair.body).toBe(200);await expect.poll(async()=>(await restarted.app.inject({url:'/api/maintenance',headers})).json().status).toBe('completed');
 const activity=(await restarted.app.inject({url:'/api/gateway/activity',headers})).json();expect(activity.recent.some((r:{agent:string;model:string})=>r.agent==='内部 · 维修模型'&&r.model===mb)).toBe(true);
 expect(calls.filter(c=>c.key.includes('project-B')).length).toBeGreaterThan(1);
},60000);
it('marks interrupted API streams as failed, prevents budget replay, and does not fall back after source removal',async()=>{
 const {service,headers,add}=await fixture(true);const s=await add('Stream','stream-key');const model=apiModelID(s.id,'shared');
 const created=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'bounded',sourceId:s.id,models:[model],tokenLimit:20}})).json();const client={...headers,authorization:`Bearer ${created.apiKey}`};
 const response=await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model,input:'truncate',stream:true}});expect(response.body).toContain('event: error');expect(response.body).toContain('before completion');
 const key=(await service.app.inject({url:'/api/gateway-keys',headers})).json().keys.find((k:{id:string})=>k.id===created.key.id);expect(key.unmeteredRequests).toBe(1);
 expect((await service.app.inject({method:'POST',url:'/v1/responses',headers:client,payload:{model,input:'retry'}})).statusCode).toBe(429);
 const activity=(await service.app.inject({url:'/api/gateway/activity',headers})).json();expect(activity.recent.some((r:{status:number})=>r.status===502)).toBe(true);
 await service.app.inject({method:'DELETE',url:`/api/gateway-keys/${created.key.id}`,headers});expect((await service.app.inject({method:'DELETE',url:`/api/sources/${s.id}`,headers})).statusCode).toBe(200);
 expect((await service.app.inject({method:'POST',url:'/v1/responses',headers,payload:{model,input:'Hi'}})).statusCode).toBe(503);
},60000);
it('restricts the private relay to its own source/model/protocol and refuses redirects with credentials',async()=>{
 const {root,service,headers,add,calls}=await fixture();const source=await add('Private','private-source-key');
 const yaml=await readFile(join(root,'cliproxy/config.yaml'),'utf8');const entry=JSON.parse(yaml.match(/^codex-api-key: (.+)/m)![1])[0];
 const scoped=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'client',sourceId:source.id,models:[apiModelID(source.id,'shared')]}})).json();
 const client={...headers,authorization:`Bearer ${scoped.apiKey}`};
 expect((await service.app.inject({url:'/api/sources',headers:client})).statusCode).toBe(401);
 expect((await service.app.inject({method:'DELETE',url:`/api/sources/${source.id}`,headers:client})).statusCode).toBe(401);
 expect((await service.app.inject({url:'/api/sources',headers:{...headers,origin:'https://evil.test'}})).statusCode).toBe(403);
 await service.app.inject({method:'DELETE',url:`/api/gateway-keys/${scoped.key.id}`,headers});
 const url=entry['base-url']+'/responses';const payload=JSON.stringify({model:'shared',input:'Hi'});
 expect((await fetch(url,{method:'POST',body:payload})).status).toBe(401);
 const relayHeaders={authorization:`Bearer ${entry['api-key']}`,'content-type':'application/json'};
 expect((await fetch(url,{method:'POST',headers:relayHeaders,body:JSON.stringify({model:'different'})})).status).toBe(403);
 expect((await fetch(entry['base-url']+'/chat/completions',{method:'POST',headers:relayHeaders,body:payload})).status).toBe(400);
 expect(calls).toHaveLength(0);
 const streamError=await fetch(url,{method:'POST',headers:relayHeaders,body:JSON.stringify({model:'shared',input:'secret-error',stream:true})});const text=await streamError.text();expect(text).toContain('API source stream failed');expect(text).not.toContain('private-source-key');expect(text).not.toContain('secret-private-upstream-detail');
 const redir=createServer((_req,res)=>{res.writeHead(302,{location:'http://127.0.0.1:1/stolen'});res.end();});await new Promise<void>(r=>redir.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>redir.close(()=>r())));
 const baseURL=`http://127.0.0.1:${(redir.address() as {port:number}).port}/v1`;
 expect((await service.app.inject({method:'PUT',url:`/api/sources/${source.id}`,headers,payload:{name:source.name,protocol:'responses',models:source.models,baseURL}})).statusCode).toBe(200);
 const blocked=await fetch(url,{method:'POST',headers:relayHeaders,body:payload});expect(blocked.status).toBe(502);expect(await blocked.text()).not.toContain('private-source-key');
});
it('keeps the previous credential on a failed edit and refuses durable API setup without a persistent vault',async()=>{
 const {root,secrets,baseURL,add}=await fixture();const source=await add('Original','original-private-key');
 const store=await ApiSources.open(root,secrets,defaultProvider);cleanup.push(()=>store.close());const original=await readFile(join(root,'api-sources.json'),'utf8');
 const ref=JSON.parse(original).sources[0].credentialRef;
 await mkdir(join(root,'api-sources.json.tmp'));
 await expect(store.save({name:'Changed',baseURL,protocol:'responses',models:['shared'],apiKey:'replacement-private-key'},source.id)).rejects.toThrow();
 expect(await secrets.get(ref)).toBe('original-private-key');expect((await store.list())[0].name).toBe('Original');expect(await readFile(join(root,'api-sources.json'),'utf8')).toBe(original);
 const memory=await ApiSources.open(root,{...secrets,persistent:false},defaultProvider);cleanup.push(()=>memory.close());
 await expect(memory.save({name:'Memory',baseURL,protocol:'responses',models:['shared'],apiKey:'new-private-key'})).rejects.toThrow('桌面版');
});
it('uses an explicitly selected bounded repair source while sidecar is offline, without granting other keys a bypass',async()=>{
 const {service,headers,add,root,calls}=await fixture();const source=await add('Offline repair','offline-repair-key');const model=apiModelID(source.id,'shared');
 const normal=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'normal',models:[model],sourceId:source.id}})).json();
 await service.proxy.stop();
 const direct=await service.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId:source.id,model,channel:'direct'}});expect(direct.statusCode,direct.body).toBe(200);
 await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.status).toBe('ready');
 expect((await service.app.inject({method:'POST',url:'/v1/responses',headers:{...headers,authorization:`Bearer ${normal.apiKey}`},payload:{model,input:'Hi'}})).statusCode).toBe(503);
 const repair=await service.app.inject({method:'POST',url:'/api/maintenance/run',headers,payload:{prompt:'只读检查'}});expect(repair.statusCode,repair.body).toBe(200);await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().status).toBe('completed');
 const key=(await service.app.inject({url:'/api/gateway-keys',headers})).json().keys.find((k:{name:string})=>k.name==='内部 · 维修模型');expect(key.tokenLimit).toBe(32000);expect(key.usedTokens).toBeGreaterThan(0);expect(calls.at(-1)?.key).toContain('offline-repair-key');
 expect((await service.app.inject({method:'POST',url:'/api/maintenance/local/diagnose',headers,payload:{target:'codex'}})).statusCode).toBe(200);await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance/local',headers})).json().active).toBeUndefined();
 expect(await readFile(join(root,'local-maintenance.json'),'utf8')).not.toContain('offline-repair-key');
 expect((await service.app.inject({url:'/api/maintenance/local',headers:{...headers,authorization:`Bearer ${normal.apiKey}`}})).statusCode).toBe(401);
 expect((await service.app.inject({method:'POST',url:'/api/maintenance/local/upgrade',headers,payload:{id:crypto.randomUUID()}})).statusCode).toBe(400);
 await service.proxy.start();
 const target=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
 const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId:source.id,model,revision:target.revision}});expect(connected.statusCode,connected.body).toBe(200);
 // Stop any automatic read-only review before exercising the independent repair loop.
 await service.app.inject({method:'POST',url:'/api/maintenance/stop',headers,payload:{}});
 await writeFile(join(root,'codex/config.toml'),'');
 const chain={target:'codex',sourceId:source.id,model,connectionId:connected.json().id};
 const plan=(await service.app.inject({method:'POST',url:'/api/maintenance/propose',headers,payload:{chain}})).json();expect(plan.status).toBe('pending');
 const approved=await service.app.inject({method:'POST',url:'/api/maintenance/approve',headers,payload:{id:plan.id,approve:true}});expect(approved.json().proposal.status,approved.body).toBe('completed');await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().status).toBe('completed');
 expect(await readFile(join(root,'codex/config.toml'),'utf8')).toContain(model);
 const current=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
 const repaired=await readFile(join(root,'codex/config.toml'),'utf8');const configuredKey=repaired.match(/experimental_bearer_token = "([^"]+)"/)![1];
 const probe=await service.app.inject({method:'POST',url:'/v1/responses',headers:{...headers,authorization:`Bearer ${configuredKey}`},payload:{model:current.connection.model,input:'minimal gateway test',max_output_tokens:32}});expect(probe.statusCode,probe.body).toBe(200);
 const other=await add('Not native','other','chat');expect((await service.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId:other.id,model:apiModelID(other.id,'shared'),channel:'direct'}})).statusCode).toBe(409);
},30000);
