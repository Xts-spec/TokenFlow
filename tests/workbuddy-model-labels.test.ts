import {expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {AgentConnections,connectedConfig} from '../packages/core/src/agent-connections.js';
import {createDesktopService} from '../packages/core/src/service.js';

// Installed WorkBuddy's custom-model formatter compares name with the unprefixed ID.
// If they differ, the native picker renders name:ID. Assert the result, not only JSON.name.
const pickerLabel=(model:{id:string;name:string})=>{const id=model.id.replace(/^custom-local:/,'');return !model.name||model.name===id?id:`${model.name}:${id}`;};

it('exports a WorkBuddy picker label without the internal route suffix',()=>{
 const id='qoder/gfmodel',label='qoder/GLM-5.3-Flash';
 const [model]=JSON.parse(connectedConfig('workbuddy',null,'http://127.0.0.1:9527',id,'fixture-key',undefined,[id],{[id]:label}));
 expect(pickerLabel({...model,id:`custom-local:${model.id}`})).toBe(label);
 expect(model.id).not.toContain('gfmodel');
});

it('keeps readable IDs unique alongside unrelated native custom models',()=>{
 const ids=['qoder/route-a','qoder/route-b'],label='qoder/GLM-5.3-Flash';
 const original=JSON.stringify([{id:label,name:label,url:'https://fixture.invalid',apiKey:'original'}]);
 const models=JSON.parse(connectedConfig('workbuddy',original,'http://127.0.0.1:9527',ids[0],'fixture-key',undefined,ids,Object.fromEntries(ids.map(id=>[id,label]))));
 expect(new Set(models.map((m:{id:string})=>m.id)).size).toBe(3);
 expect(models.slice(1).map(pickerLabel)).toEqual([`${label} (2)`,`${label} (3)`]);
 expect(models[0]).toEqual(JSON.parse(original)[0]);
});

it('upgrades an old raw-ID WorkBuddy journal without duplicate entries and preserves rollback',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-workbuddy-upgrade-')),path=join(root,'workbuddy/models.json');
 const connections=new AgentConnections(root,{workbuddy:path},async()=>[]),model='qoder/gfmodel',label='qoder/GLM-5.3-Flash';
 try{
  await mkdir(join(root,'workbuddy'));await writeFile(path,'[]');
  const old=await connections.apply({target:'workbuddy',revision:(await connections.status()).find(t=>t.id==='workbuddy')!.revision,origin:'http://127.0.0.1:9527',model,sourceId:'source',keyId:randomUUID(),key:'old-fixture'});
  const file=join(root,'agent-backups',`${old.id}.json`),legacy=JSON.parse(await readFile(file,'utf8'));
  const entries=JSON.parse(legacy.after);entries[0].name=label;legacy.after=JSON.stringify(entries);legacy.afterHash=createHash('sha256').update(`file:${legacy.after}`).digest('hex');delete legacy.modelAliases;
  await writeFile(file,JSON.stringify(legacy));await writeFile(path,legacy.after);
  const reopened=new AgentConnections(root,{workbuddy:path},async()=>[]),state=(await reopened.status()).find(t=>t.id==='workbuddy')!;expect(state.configurationState).toBe('configured');
  const next=await reopened.apply({target:'workbuddy',revision:state.revision,replaceId:old.id,origin:'http://127.0.0.1:9527',model,sourceId:'source',keyId:randomUUID(),key:'new-fixture',modelLabels:{[model]:label}});
  expect(JSON.parse(await readFile(path,'utf8'))).toHaveLength(1);expect(JSON.parse(await readFile(path,'utf8'))[0].id).toBe(label);expect((await reopened.review(next.id)).checks.every(c=>c.ok)).toBe(true);
  await reopened.restore(next.id);expect(await readFile(path,'utf8')).toBe('[]');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('routes readable WorkBuddy IDs to authorized models and accounts across rename, restart and restore',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-workbuddy-labels-')),allocator=createServer();
 await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const paths=Object.fromEntries(['codex','claude','qoder','workbuddy','pi','deepseek'].map(target=>[target,join(root,target,target==='codex'?'config.toml':'settings.json')]));
 await mkdir(join(root,'cliproxy'));await mkdir(join(root,'workbuddy'));await writeFile(paths.workbuddy,'[]');
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',models:[{id:'gfmodel',display_name:'GLM-5.3-Flash'}]},{name:'codex.json',provider:'codex',status:'active',models:[{id:'gpt-5.6-luna',display_name:'GPT-5.6-Luna'}]}]));
 const options={root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'ag.db'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}}};
 let service=await createDesktopService(options);const admin={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const status=async()=>(await service.app.inject({url:'/api/a2a',headers:admin})).json().targets.find((t:any)=>t.id==='workbuddy');
 const invoke=(key:string,model:string,stream=false)=>service.app.inject({method:'POST',url:'/v1/chat/completions',headers:{host:admin.host,authorization:`Bearer ${key}`},payload:{model,stream,messages:[{role:'user',content:'Fixture'}]}});
 try{
  await service.proxy.start();const accounts=service.proxy.snapshot().accounts;
  const selections=accounts.map(a=>({sourceId:a.id,model:a.models![0]}));
  const apply=async(rewrite=false)=>{const current=await status();const r=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers:admin,payload:{target:'workbuddy',...selections[0],selections,revision:current.revision,rewrite,...(current.connection?{replaceId:current.connection.id}:{})}});expect(r.statusCode,r.body).toBe(200);return r.json();};
  const record=await apply();let models=JSON.parse(await readFile(paths.workbuddy,'utf8'));
  expect(models.map(pickerLabel)).toEqual(['qoder/GLM-5.3-Flash','codex/GPT-5.6-Luna']);
  expect(record.modelAliases).toEqual(Object.fromEntries(models.map((m:any,i:number)=>[m.id,selections[i].model])));
  const menu=(await service.app.inject({url:'/v1/models',headers:{host:admin.host,authorization:`Bearer ${models[0].apiKey}`}})).json().data;
  expect(menu.map((m:any)=>m.id)).toEqual(expect.arrayContaining(models.map((m:any)=>m.id)));expect(menu.every((m:any)=>m.id===m.display_name)).toBe(true);
  for(const [i,m] of models.entries()){
   const reply=await invoke(m.apiKey,m.id,i===1);expect(reply.statusCode,reply.body).toBe(200);
   const prefixed=await invoke(m.apiKey,`custom-local:${m.id}`);expect(prefixed.statusCode,prefixed.body).toBe(200);
  }
  const general=(await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'General key',sourceId:selections[0].sourceId,models:[selections[0].model],agents:['openai']}})).json();
  expect((await invoke(general.apiKey,models[0].id)).statusCode).toBe(403);
  expect((await service.app.inject({url:'/v1/models',headers:{host:admin.host,authorization:`Bearer ${general.apiKey}`}})).json().data.map((m:any)=>m.id)).toEqual([selections[0].model]);
  const usage=(await service.app.inject({url:'/api/usage/overview?days=0',headers:admin})).json();
  for(const selection of selections)expect(usage.rows.find((r:any)=>r.sourceId===selection.sourceId&&r.model===selection.model)).toMatchObject({target:'workbuddy',requests:2,inputTokens:14,outputTokens:6});
  await service.app.close();service=await createDesktopService(options);await service.proxy.start();
  expect((await invoke(models[0].apiKey,models[0].id)).statusCode).toBe(200);
  expect((await status()).configurationState).toBe('configured');
  // A label change regenerates the readable alias and revokes the old connection Key.
  await fetch(`http://127.0.0.1:${proxyPort}/fixture`,{method:'POST',body:JSON.stringify({modelSets:{qoder:[{id:'gfmodel',display_name:'GLM Renamed'}]}})});
  await service.proxy.refreshAccounts();
  await apply();const old=models;models=JSON.parse(await readFile(paths.workbuddy,'utf8'));
  expect(pickerLabel(models[0])).toBe('qoder/GLM-Renamed');expect(models).toHaveLength(2);
  expect((await invoke(old[0].apiKey,old[0].id)).statusCode).toBe(401);
  expect((await invoke(models[0].apiKey,models[0].id)).statusCode).toBe(200);
  models[0].url='https://fixture.invalid/changed';await writeFile(paths.workbuddy,JSON.stringify(models));expect((await status()).configurationState).toBe('changed');
  await apply(true);expect(JSON.parse(await readFile(paths.workbuddy,'utf8'))).toHaveLength(2);
  const current=await status();const restored=await service.app.inject({method:'POST',url:'/api/a2a/restore',headers:admin,payload:{id:current.connection.id,revision:current.revision,allowRunning:true}});
  expect(restored.statusCode,restored.body).toBe(200);expect(JSON.parse(await readFile(paths.workbuddy,'utf8'))).toEqual([]);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
