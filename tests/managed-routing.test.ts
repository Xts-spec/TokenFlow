import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import { parse } from 'smol-toml';
import { createDesktopService } from '../packages/core/src/service.js';
import { sourceOptions } from '../apps/console/src/source-options.js';

async function fixture(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'managed-routing-'));
 const listener=createServer();await new Promise<void>(r=>listener.listen(0,'127.0.0.1',r));const port=(listener.address() as {port:number}).port;await new Promise<void>(r=>listener.close(()=>r()));
 await mkdir(join(root,'cliproxy'));
 const accounts=[{name:'qoder.json',provider:'qoder',status:'active',models:['kmodel_latest']},{name:'workbuddy.json',provider:'workbuddy',status:'active',models:['hy4-preview']}];
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(accounts));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude.json'),workbuddy:join(root,'workbuddy.json'),qoder:join(root,'qoder.json')};
 const options={root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin-fixture',localKey:'internal-fixture',secrets:{get:async()=>'',set:async()=>{}},agentPaths:paths,agentProcesses:async()=>[]};
 const service=await createDesktopService(options);await service.proxy.start();
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-fixture'};
 return {root,port,accounts,paths,options,service,headers,close:async()=>{await service.app.close();await rm(root,{recursive:true,force:true});}};
}

it('routes a stale Codex conversation model to its newly selected managed model, including after restart',async()=>{
 const f=await fixture();let reopened:Awaited<ReturnType<typeof createDesktopService>>|undefined;
 try{
  const connect=async(provider:string,model:string)=>{
   const target=(await f.service.app.inject({url:'/api/a2a',headers:f.headers})).json().targets.find((t:{id:string})=>t.id==='codex');
   const source=f.service.proxy.snapshot().accounts.find(a=>a.provider===provider)!;
   const response=await f.service.app.inject({method:'POST',url:'/api/a2a/connect',headers:f.headers,payload:{target:'codex',sourceId:source.id,model,revision:target.revision,...(target.connection?{replaceId:target.connection.id}:{})}});
   expect(response.statusCode,response.body).toBe(200);
   const config=parse(await readFile(f.paths.codex,'utf8')) as any;
   return {source,key:config.model_providers.token_flow.experimental_bearer_token};
  };
  const old=await connect('qoder','qoder/kmodel_latest');
  const selected=await connect('workbuddy','workbuddy/hy4-preview');
  const request={method:'POST' as const,url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${selected.key}`},payload:{model:'qoder/kmodel_latest',input:'Reply OK'}};
  const response=await f.service.app.inject(request);
  expect(response.statusCode,response.body).toBe(200);
  expect(response.json()).toMatchObject({model:'workbuddy/hy4-preview',output:[{content:[{text:'workbuddy'}]}]});
  expect((await f.service.app.inject({...request,headers:{...request.headers,authorization:`Bearer ${old.key}`}})).statusCode).toBe(401);
  // Ordinary exported keys keep their model scopes, even if named like a managed connection.
  const general=(await f.service.app.inject({method:'POST',url:'/api/gateway-keys',headers:f.headers,payload:{name:'A2A · codex',sourceId:selected.source.id,models:['workbuddy/hy4-preview']}})).json();
  expect((await f.service.app.inject({...request,headers:{...request.headers,authorization:`Bearer ${general.apiKey}`}})).statusCode).toBe(403);
  await f.service.app.close();reopened=await createDesktopService(f.options);await reopened.proxy.start();
  const restored=await reopened.app.inject(request);expect(restored.statusCode,restored.body).toBe(200);expect(restored.json().model).toBe('workbuddy/hy4-preview');
 }finally{await reopened?.app.close();await f.close();}
});

it('lets the sidecar retry an enabled Qoder source after a transient unavailable flag',async()=>{
 const f=await fixture();
 try{
  const source=f.service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;
  const key=(await f.service.app.inject({method:'POST',url:'/api/gateway-keys',headers:f.headers,payload:{name:'Qoder retry',sourceId:source.id,models:['qoder/kmodel_latest']}})).json();
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({accounts:f.accounts.map(a=>a.provider==='qoder'?{...a,status:'error',unavailable:true,next_retry_after:'2020-01-01T00:00:00Z',status_message:'upstream 503'}:a)})});
  await f.service.proxy.refreshAccounts();
  expect(sourceOptions(f.service.proxy.snapshot()).some(a=>a.id===source.id)).toBe(true);
  const response=await f.service.app.inject({method:'POST',url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${key.apiKey}`},payload:{model:'qoder/kmodel_latest',input:'Reply OK'}});
  expect(response.statusCode,response.body).toBe(200);expect(response.json().model).toBe('qoder/kmodel_latest');
  await f.service.proxy.setAccountEnabled(source.id,false);
  const disabled=await f.service.app.inject({method:'POST',url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${key.apiKey}`},payload:{model:'qoder/kmodel_latest',input:'Reply OK'}});
  expect(disabled.statusCode).toBe(503);
  expect(sourceOptions(f.service.proxy.snapshot()).some(a=>a.id===source.id)).toBe(false);
 }finally{await f.close();}
});

it('authorizes multiple models, pins each source, rejects unselected models and keeps routing after restart',async()=>{
 const f=await fixture();let reopened:Awaited<ReturnType<typeof createDesktopService>>|undefined;
 try{
  const accounts=f.service.proxy.snapshot().accounts;
  const selections=accounts.map(a=>({sourceId:a.id,model:a.provider==='qoder'?'qoder/kmodel_latest':'workbuddy/hy4-preview'}));
  const target=(await f.service.app.inject({url:'/api/a2a',headers:f.headers})).json().targets.find((t:{id:string})=>t.id==='codex');
  const connect=(selected:typeof selections)=>f.service.app.inject({method:'POST',url:'/api/a2a/connect',headers:f.headers,payload:{target:'codex',...selected[0],selections:selected,revision:target.revision}});
  const duplicate=await connect([...selections,{...selections[0],sourceId:selections[1].sourceId}]);expect(duplicate.statusCode).toBe(400);
  expect((await f.service.app.inject({url:'/api/gateway-keys',headers:f.headers})).json().keys).toHaveLength(0);
  const saved=await connect(selections);expect(saved.statusCode,saved.body).toBe(200);expect(saved.json().selections).toEqual(selections);
  const config=parse(await readFile(f.paths.codex,'utf8')) as any;
  const catalog=JSON.parse(await readFile(config.model_catalog_json,'utf8'));expect(catalog.models.map((m:{slug:string})=>m.slug)).toEqual(selections.map(s=>s.model));
  const headers={host:f.headers.host,authorization:`Bearer ${config.model_providers.token_flow.experimental_bearer_token}`};
  const available=await f.service.app.inject({url:'/v1/models',headers});expect(available.json().data.map((m:{id:string})=>m.id).sort()).toEqual(selections.map(s=>s.model).sort());
  for(const selected of selections){const response=await f.service.app.inject({method:'POST',url:'/v1/responses',headers,payload:{model:selected.model,input:'Reply OK'}});expect(response.statusCode,response.body).toBe(200);expect(response.json().model).toBe(selected.model);}
  const denied=await f.service.app.inject({method:'POST',url:'/v1/responses',headers,payload:{model:'codex/not-selected',input:'Reply OK'}});expect(denied.statusCode).toBe(403);
  // A second account still serves the same model: disabling the selected one must never fall back to it.
  await fetch(`http://127.0.0.1:${f.port}/fixture`,{method:'POST',body:JSON.stringify({accounts:[...f.accounts,{name:'alternate-qoder.json',provider:'qoder',status:'active',models:['kmodel_latest']}]})});
  await f.service.proxy.refreshAccounts();
  await f.service.proxy.setAccountEnabled(selections[0].sourceId,false);
  expect((await f.service.app.inject({method:'POST',url:'/v1/responses',headers,payload:{model:selections[0].model,input:'Reply OK'}})).statusCode).toBe(503);
  expect((await f.service.app.inject({url:'/v1/models',headers})).json().data.map((m:{id:string})=>m.id)).toEqual([selections[1].model]);
  await f.service.proxy.setAccountEnabled(selections[0].sourceId,true);
  await f.service.app.close();reopened=await createDesktopService(f.options);await reopened.proxy.start();
  for(const selected of selections){const response=await reopened.app.inject({method:'POST',url:'/v1/responses',headers,payload:{model:selected.model,input:'Reply OK'}});expect(response.statusCode,response.body).toBe(200);expect(response.json().model).toBe(selected.model);}
 }finally{await reopened?.app.close();await f.close();}
});

it('limits local compressed-history recovery to the managed Codex key, including after rotation',async()=>{
 const f=await fixture();
 try{
  await mkdir(join(f.root,'codex/sessions'),{recursive:true});
  await writeFile(join(f.root,'codex/sessions/rollout-context.jsonl'),[
   {type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'local private history'}]}},
   {type:'compacted',payload:{replacement_history:[{type:'compaction',encrypted_content:'synthetic-official-state'}]}}
  ].map(v=>JSON.stringify(v)).join('\n'));
  const connect=async(provider:string,model:string)=>{
   const target=(await f.service.app.inject({url:'/api/a2a',headers:f.headers})).json().targets.find((t:any)=>t.id==='codex');
   const source=f.service.proxy.snapshot().accounts.find(a=>a.provider===provider)!;
   const r=await f.service.app.inject({method:'POST',url:'/api/a2a/connect',headers:f.headers,payload:{target:'codex',sourceId:source.id,model,revision:target.revision,...(target.connection?{replaceId:target.connection.id}:{})}});expect(r.statusCode,r.body).toBe(200);
   const config=parse(await readFile(f.paths.codex,'utf8')) as any;return {source,key:config.model_providers.token_flow.experimental_bearer_token};
  };
  const old=await connect('qoder','qoder/kmodel_latest');
  const request=(key:string,model:string)=>f.service.app.inject({method:'POST',url:'/v1/responses',headers:{host:f.headers.host,authorization:`Bearer ${key}`},payload:{model,input:[{type:'compaction',encrypted_content:'synthetic-official-state'},{role:'user',content:'Continue'}]}});
  expect((await request(old.key,'qoder/kmodel_latest')).statusCode).toBe(200);
  const ordinary=(await f.service.app.inject({method:'POST',url:'/api/gateway-keys',headers:f.headers,payload:{name:'A2A · codex',sourceId:old.source.id,models:['qoder/kmodel_latest']}})).json();
  expect((await request(ordinary.apiKey,'qoder/kmodel_latest')).statusCode).toBe(400);
  const next=await connect('workbuddy','workbuddy/hy4-preview');
  expect((await request(next.key,'workbuddy/hy4-preview')).statusCode).toBe(200);
  expect((await request(old.key,'qoder/kmodel_latest')).statusCode).toBe(401);
 }finally{await f.close();}
});
