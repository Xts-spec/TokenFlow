import {CodexSwitchLifecycle} from '../packages/core/src/codex-switch-lifecycle.js';
import {CodexContext} from '../packages/core/src/codex-context.js';
import {parse} from 'smol-toml';
import {CodexThreadMigration} from '../packages/core/src/codex-thread-migration.js';
import {DatabaseSync} from 'node:sqlite';
import { it,expect,vi,type MockInstance } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import {PiTerminalLifecycle} from '../packages/core/src/pi-terminal-lifecycle.js';
import { QoderLifecycle } from '../packages/core/src/agent-lifecycle.js';
import { createDesktopService } from '../packages/core/src/service.js';
it('connects and restores a local Agent through admin APIs without exposing keys or original config',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'a2a-service-'));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'));await mkdir(join(root,'claude'));
 await writeFile(join(root,'cliproxy','fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['shared-model']}]));
 const path=join(root,'claude','settings.json');const original='{"env":{"KEEP":"private-original","ANTHROPIC_SMALL_FAST_MODEL":"volcengine_kimi-k3"}}';await writeFile(path,original);
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin-token',localKey:'internal-key',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{qoder:join(root,'qoder/settings.json'),codex:join(root,'codex','config.toml'),claude:path,workbuddy:join(root,'workbuddy','models.json')},agentProcesses:async()=>[]});
 try{
  await service.proxy.start();const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};
  expect((await service.app.inject({url:'/api/a2a',headers:{host:headers.host}})).statusCode).toBe(401);
  expect((await service.app.inject({method:'POST',url:'/api/a2a/program',headers:{host:headers.host},payload:{target:'pi',action:'install'}})).statusCode).toBe(401);
  expect((await service.app.inject({method:'POST',url:'/api/a2a/program',headers:{...headers,origin:'https://untrusted.test'},payload:{target:'pi',action:'install'}})).statusCode).toBe(403);
  expect((await service.app.inject({method:'POST',url:'/api/a2a/program',headers,payload:{target:'invalid',action:'install'}})).statusCode).toBe(400);
  const restart=vi.spyOn(QoderLifecycle.prototype,'restart').mockResolvedValue({message:'Qoder 已重新打开'});
  try{
   expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers:{host:headers.host},payload:{target:'qoder'}})).statusCode).toBe(401);
   expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers:{...headers,origin:'https://untrusted.test'},payload:{target:'qoder'}})).statusCode).toBe(403);
   expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload:{target:'invalid'}})).statusCode).toBe(400);
   expect(restart).not.toHaveBeenCalled();
   expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload:{target:'qoder'}})).statusCode).toBe(200);
   expect(restart).toHaveBeenCalledTimes(1);
   for(const target of ['codex','workbuddy','claude','deepseek']){
    const payload={target,...(target==='claude'?{client:'vscode'}:{})};
    expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload})).statusCode).toBe(200);
    expect(restart).toHaveBeenLastCalledWith(target);
   }
   expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload:{target:'claude',client:'terminal'}})).statusCode).toBe(400);
   const piRestart=vi.spyOn(PiTerminalLifecycle.prototype,'restart').mockResolvedValue({message:'Pi 已重新打开'});try{expect((await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload:{target:'pi'}})).statusCode).toBe(200);}finally{piRestart.mockRestore();}
   expect((await service.app.inject({url:'/api/a2a/program-updates',headers:{host:headers.host}})).statusCode).toBe(401);
   expect((await service.app.inject({url:'/api/a2a/terminal-sessions',headers:{host:headers.host}})).statusCode).toBe(401);
  }finally{restart.mockRestore();}
  await mkdir(join(root,'codex'));const credentials=JSON.stringify({tokens:{access_token:'fixture-access',refresh_token:'fixture-refresh',id_token:'x.e30.x',account_id:'fixture-account'}});await writeFile(join(root,'codex','auth.json'),credentials);
  await service.discoverLocal();expect(service.proxy.snapshot().accounts).toHaveLength(2);
  await service.proxy.importCredential('codex',{account_id:'fixture-account',access_token:'stale-copy'},true);expect(await readFile(join(root,'cliproxy','fixture-accounts.json'),'utf8')).not.toContain('stale-copy');
  const imported=await service.app.inject({method:'POST',url:'/api/a2a/import',headers,payload:{target:'codex'}});expect(imported.statusCode).toBe(200);expect(imported.body).not.toContain('fixture-access');expect(await readFile(join(root,'codex','auth.json'),'utf8')).toBe(credentials);
  const state=(await service.app.inject({url:'/api/a2a',headers})).json();const sourceId=service.proxy.snapshot().accounts[0].id;
  expect((await service.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId,model:'codex/shared-model'}})).statusCode).toBe(200);
  await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.status).toBe('ready');
  const failed=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'claude',sourceId,model:'codex/shared-model',revision:'0'.repeat(64)}});expect(failed.statusCode).toBe(409);
  const journalled=(await service.app.inject({url:'/api/a2a',headers})).json();
  expect(journalled.switchFailures[0]).toMatchObject({action:'connect',target:'claude',model:'codex/shared-model',sourceId,message:'配置已变更，请刷新接入预览。'});
  expect(JSON.stringify(journalled.switchFailures)).not.toContain('tfl_');
  const response=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'claude',sourceId,model:'codex/shared-model',revision:state.targets[1].revision}});expect(response.statusCode).toBe(200);expect(response.body).not.toContain('tfl_');expect(response.body).not.toContain('private-original');
  const record=response.json();
  expect((await service.app.inject({method:'POST',url:'/api/maintenance/run',headers,payload:{prompt:`请 review 刚完成的 ${record.target} 接入（记录 ${record.id}），仅做只读检查。`,interfaceAgent:'workbuddy',chain:{target:'claude',sourceId,model:'codex/shared-model',connectionId:record.id}}})).statusCode).toBe(200);
  await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().status).toBe('completed');
  const care=(await service.app.inject({url:'/api/maintenance',headers})).json();expect(care.engine).toBe('pi');expect(care.messages.some((m:{role:string;text:string})=>m.role==='tool'&&m.text.includes('主模型与辅助模型一致'))).toBe(true);expect(JSON.stringify(care)).not.toContain('tfl_');
  expect(care.chain).toMatchObject({target:'claude',sourceId,model:'codex/shared-model'});
  const inspection=JSON.parse(care.messages.find((m:{text:string})=>m.text.startsWith('只读预检: ')).text.slice('只读预检: '.length));
  expect(inspection.targets.map((t:{id:string})=>t.id)).toEqual(['claude']);expect(inspection.chain.sourceAvailable).toBe(true);expect(inspection.chain.matchesInstalled).toBe(true);expect(inspection.chain.source.id).toBe(sourceId);
  expect(inspection.selectedAgent).toBe('workbuddy');expect(inspection.latestSwitchFailure).toMatchObject({action:'connect',target:'claude',message:'配置已变更，请刷新接入预览。'});expect(inspection.selectedAgentSwitchFailure).toBeNull();expect(inspection.switchFailures[0].message).toContain('配置已变更');expect(JSON.stringify(inspection)).not.toContain('tfl_');
  const invalid=await service.app.inject({method:'POST',url:'/api/maintenance/run',headers,payload:{chain:{target:'workbuddy',connectionId:response.json().id}}});expect(invalid.statusCode).toBe(400);
  const automatic=await service.app.inject({method:'POST',url:'/api/maintenance/run',headers,payload:{chain:{target:'workbuddy',sourceId,model:'codex/shared-model'}}});expect(automatic.statusCode).toBe(200);
  await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().status).toBe('completed');
  const switched=(await service.app.inject({url:'/api/maintenance',headers})).json();expect(switched.messages.filter((m:{role:string})=>m.role==='user')).toHaveLength(1);expect(switched.chain.target).toBe('workbuddy');
  const config=JSON.parse(await readFile(path,'utf8'));expect(config.env.KEEP).toBe('private-original');expect(config.env.ANTHROPIC_AUTH_TOKEN).toMatch(/^tfl_/);
  const clientHeaders={host:headers.host,authorization:`Bearer ${config.env.ANTHROPIC_AUTH_TOKEN}`};expect((await service.app.inject({url:'/v1/models',headers:clientHeaders})).statusCode).toBe(200);
  const fast=await service.app.inject({method:'POST',url:'/v1/messages',headers:clientHeaders,payload:{model:config.env.ANTHROPIC_SMALL_FAST_MODEL,messages:[{role:'user',content:'OK'}],max_tokens:16}});expect(fast.statusCode,fast.body).toBe(200);
  const restored=await service.app.inject({method:'POST',url:'/api/a2a/restore',headers,payload:{id:response.json().id}});expect(restored.statusCode).toBe(200);expect(await readFile(path,'utf8')).toBe(original);expect((await service.app.inject({url:'/v1/models',headers:clientHeaders})).statusCode).toBe(401);
  const history=(await service.app.inject({url:'/api/a2a',headers})).json().targets[1];expect(history.connection).toBeNull();expect(history.backups[0]).toMatchObject({sourceId,model:'codex/shared-model',state:'restored'});
  const again=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'claude',sourceId:history.backups[0].sourceId,model:history.backups[0].model,revision:history.revision}});expect(again.statusCode,again.body).toBe(200);
  const nextConfig=JSON.parse(await readFile(path,'utf8'));await writeFile(path,'{"model":"reinstalled","userSetting":true}');
  const changed=(await service.app.inject({url:'/api/a2a',headers})).json().targets[1];const deletion={id:again.json().id,revision:changed.revision};
  expect((await service.app.inject({method:'POST',url:'/api/a2a/delete',headers:{host:headers.host},payload:deletion})).statusCode).toBe(401);
  expect((await service.app.inject({method:'POST',url:'/api/a2a/delete',headers,payload:{...deletion,revision:'0'.repeat(64)}})).statusCode).toBe(409);
  const deleted=await service.app.inject({method:'POST',url:'/api/a2a/delete',headers,payload:deletion});expect(deleted.statusCode,deleted.body).toBe(200);expect(deleted.body).not.toContain('tfl_');
  expect(await readFile(path,'utf8')).toBe('{"model":"reinstalled","userSetting":true}');expect((await service.app.inject({url:'/api/a2a',headers})).json().targets[1].connection).toBeNull();
  expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${nextConfig.env.ANTHROPIC_AUTH_TOKEN}`}})).statusCode).toBe(401);

 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('rechecks a saved maintenance model once after delayed catalog discovery, not on status polling',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'care-startup-'));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'));await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',models:['shared-model']}]));
 const options={root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin-token',localKey:'internal-key',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{qoder:join(root,'qoder/settings.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async()=>[]};
 let service=await createDesktopService(options);const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};
 try{
  await service.proxy.start();const sourceId=service.proxy.snapshot().accounts[0].id;
  await service.app.inject({method:'PUT',url:'/api/maintenance',headers,payload:{sourceId,model:'qoder/shared-model'}});
  await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.status).toBe('ready');
  await service.app.close();service=await createDesktopService(options);
  const sourceAuth=service.proxy.sourceAuth.bind(service.proxy);let attempts=0;
  vi.spyOn(service.proxy,'sourceAuth').mockImplementation((id,model)=>{if(++attempts<3)throw new Error('Catalog still loading');return sourceAuth(id,model);});
  await service.discoverLocal();
  await expect.poll(async()=>(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.status,{timeout:5000}).toBe('ready');
  const first=(await service.app.inject({url:'/api/maintenance',headers})).json().readiness.checkedAt;
  for(let i=0;i<5;i++)expect((await service.app.inject({url:'/api/maintenance',headers})).json().readiness.checkedAt).toBe(first);
  expect(attempts).toBe(3);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('queues the selected replacement model for approval, preserves stale edits and revokes the superseded key',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'repair-service-'));const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'));await mkdir(join(root,'workbuddy'));await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',models:['old','new']}]));const path=join(root,'workbuddy/models.json');await writeFile(path,'[]');
 let running=false;
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin-token',localKey:'internal-key',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{qoder:join(root,'qoder/settings.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:path},agentProcesses:async()=>running?[123]:[]});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin-token'};const post=(url:string,payload:Record<string,unknown>)=>service.app.inject({method:'POST',url,headers,payload});
 try{
  await service.proxy.start();const sourceId=service.proxy.snapshot().accounts[0].id;const state=(await service.app.inject({url:'/api/a2a',headers})).json();
  const connected=await post('/api/a2a/connect',{target:'workbuddy',sourceId,model:'qoder/old',revision:state.targets[2].revision});expect(connected.statusCode,connected.body).toBe(200);const oldKey=JSON.parse(await readFile(path,'utf8'))[0].apiKey;
  await fetch(`http://127.0.0.1:${port}/fixture`,{method:'POST',body:JSON.stringify({mode:'truncated-stream'})});
  await service.app.inject({method:'POST',url:'/v1/responses',headers:{host:headers.host,authorization:`Bearer ${oldKey}`},payload:{model:'qoder/old',input:'fixture',stream:true}});
  const uncertain=(await service.app.inject({url:'/api/gateway-keys',headers})).json().keys.find((k:{id:string})=>k.id===connected.json().keyId);expect(uncertain.tokenLimit).toBe(null);expect(uncertain.unmeteredRequests).toBeGreaterThan(0);
  await fetch(`http://127.0.0.1:${port}/fixture`,{method:'POST',body:JSON.stringify({mode:'wait'})});
  await writeFile(path,'[]');const chain={target:'workbuddy',sourceId,model:'qoder/new',connectionId:connected.json().id};
  const proposed=await post('/api/maintenance/propose',{chain});expect(proposed.statusCode,proposed.body).toBe(200);expect(proposed.json().status).toBe('pending');expect(proposed.json().code).toContain('qoder/new');expect(JSON.parse(proposed.json().code).tokenLimit).toBe(null);expect(proposed.body).not.toContain('tfl_');expect(await readFile(path,'utf8')).toBe('[]');
  await writeFile(path,'[{"id":"user-edit"}]');const stale=await post('/api/maintenance/approve',{id:proposed.json().id,approve:true});expect(stale.json().proposal.status).toBe('failed');expect(await readFile(path,'utf8')).toContain('user-edit');
  await writeFile(path,'[]');const fresh=await post('/api/maintenance/propose',{chain});const approved=await post('/api/maintenance/approve',{id:fresh.json().id,approve:true});expect(approved.json().proposal.status).toBe('completed');expect(JSON.parse(await readFile(path,'utf8'))[0].id).toBe('qoder/new');
  expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${oldKey}`}})).statusCode).toBe(401);
  expect((await post('/api/maintenance/approve',{id:fresh.json().id,approve:true})).statusCode).toBe(409);
  running=true;const current=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='workbuddy');
  expect((await post('/api/a2a/restore',{id:current.connection.id,allowRunning:true})).statusCode).toBe(400);
  expect((await post('/api/a2a/restore',{id:current.connection.id,allowRunning:true,revision:'0'.repeat(64)})).statusCode).toBe(409);
  const restore=await post('/api/a2a/restore',{id:current.connection.id,revision:current.revision,allowRunning:true});expect(restore.statusCode,restore.body).toBe(200);expect(await readFile(path,'utf8')).toBe('[]');
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('blocks Codex migration while desktop runs, before creating a gateway key or modifying configuration',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-migration-api-'));
 await mkdir(join(root,'codex'));await mkdir(join(root,'cliproxy'));await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['shared-model']} ]));
 const path=join(root,'codex/config.toml');await writeFile(path,'model="native-model"');
 const db=new DatabaseSync(join(root,'codex/state_5.sqlite'));db.exec("CREATE TABLE threads(id TEXT,model_provider TEXT,model TEXT,rollout_path TEXT,source TEXT,archived INTEGER);INSERT INTO threads VALUES ('old','openai','native-model','/unused','vscode',0)");db.close();
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:path,claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async target=>target==='codex'?[123]:[]});
 try{await service.proxy.start();const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
  const state=(await service.app.inject({url:'/api/a2a',headers})).json();const target=state.targets.find((t:{id:string})=>t.id==='codex');const sourceId=service.proxy.snapshot().accounts[0].id;
  const response=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId,model:'codex/shared-model',revision:target.revision,allowRunning:true}});
  expect(response.statusCode).toBe(409);expect(response.json().code).toBe('codex_exit_required');expect(await readFile(path,'utf8')).toBe('model="native-model"');
  expect((await service.app.inject({url:'/api/a2a/codex-migration',headers})).json()).toMatchObject({backups:0,remaining:0});
  expect((await service.app.inject({method:'POST',url:'/api/a2a/codex-migration/restore',headers:{host:headers.host}})).statusCode).toBe(401);
  expect((await service.app.inject({method:'POST',url:'/api/a2a/codex-migration/restore',headers:{...headers,origin:'https://untrusted.test'}})).statusCode).toBe(403);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('passes the new key authorization set to Codex migration when replacing gateway selections',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-model-replace-api-'));
 await mkdir(join(root,'codex'));await mkdir(join(root,'cliproxy'));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['old','retained','replacement']}]));
 const path=join(root,'codex/config.toml');await writeFile(path,'model="native-model"');
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:path,claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async()=>[]});
 const migrate=vi.spyOn(CodexThreadMigration.prototype,'migrate');
 try{await service.proxy.start();const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};const sourceId=service.proxy.snapshot().accounts[0].id;
  const state=async()=>(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
  const connect=async(model:string,models:string[])=>{const target=await state();return service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId,model,revision:target.revision,replaceId:target.connection?.id,selections:models.map(model=>({sourceId,model}))}});};
  const first=await connect('codex/old',['codex/old','codex/retained']);expect(first.statusCode,first.body).toBe(200);
  const clientKey=async()=>((parse(await readFile(path,'utf8')).model_providers as any).token_flow.experimental_bearer_token as string);
  const oldKey=await clientKey();
  const second=await connect('codex/replacement',['codex/replacement','codex/retained']);expect(second.statusCode,second.body).toBe(200);
  expect(migrate).toHaveBeenLastCalledWith('codex/replacement',['codex/replacement','codex/retained']);
  const models=await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${await clientKey()}`}});
  expect(models.statusCode).toBe(200);expect(models.json().data.map((m:{id:string})=>m.id).sort()).toEqual(['codex/replacement','codex/retained'].sort());
  expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${oldKey}`}})).statusCode).toBe(401);
 }finally{migrate.mockRestore();await service.app.close();await rm(root,{recursive:true,force:true});}
});


it('performs the confirmed Codex stop, backup, change and relaunch in a single admin request',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-auto-switch-api-'));
 await mkdir(join(root,'codex'));await mkdir(join(root,'cliproxy'));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['shared-model']}]));
 const path=join(root,'codex/config.toml');await writeFile(path,'model="native-model"');
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 let pids=[123];const events:string[]=[];
 const lifecycle=new CodexSwitchLifecycle(async()=>pids,async()=>{events.push('stop');pids=[];},async()=>{events.push('open');return {message:'opened'};},'darwin',async()=>{});
 const change=CodexSwitchLifecycle.prototype.change;
 const restart=vi.spyOn(CodexSwitchLifecycle.prototype,'change').mockImplementation(work=>change.call(lifecycle,work));
 const prepare=CodexThreadMigration.prototype.prepare;
 const backup=vi.spyOn(CodexThreadMigration.prototype,'prepare').mockImplementation(async function(this:CodexThreadMigration,...args){expect(pids).toEqual([]);events.push('backup');return prepare.apply(this,args);});
 const migrate=CodexThreadMigration.prototype.migrate;
 const migration=vi.spyOn(CodexThreadMigration.prototype,'migrate').mockImplementation(async function(this:CodexThreadMigration,...args){expect(pids).toEqual([]);events.push('migrate');return migrate.apply(this,args);});
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:path,claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async target=>target==='codex'?pids:[]});
 try{
  await service.proxy.start();const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};const sourceId=service.proxy.snapshot().accounts[0].id;
  const state=async()=>(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
  const target=await state();const payload={target:'codex',sourceId,model:'codex/shared-model',revision:target.revision,allowRunning:true,restartCodex:true};
  const stale=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{...payload,revision:'0'.repeat(64)}});expect(stale.statusCode).toBe(409);expect(events).toEqual([]);
  const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload});expect(connected.statusCode,connected.body).toBe(200);
  expect(events).toEqual(['stop','backup','migrate','open']);expect(await readFile(path,'utf8')).toContain('codex/shared-model');
  pids=[123];events.length=0;const current=await state();
  const restored=await service.app.inject({method:'POST',url:'/api/a2a/restore',headers,payload:{id:current.connection.id,revision:current.revision,allowRunning:true,restartCodex:true}});
  expect(restored.statusCode,restored.body).toBe(200);expect(events).toEqual(['stop','open']);expect(await readFile(path,'utf8')).toBe('model="native-model"');
  // Restarting alone must not trigger history conversion or another backup.
  const session=join(root,'codex/sessions/rollout-legacy.jsonl');await mkdir(join(root,'codex/sessions'));
  await writeFile(session,JSON.stringify({type:'response_item',payload:{type:'reasoning',id:'rs_chatcmpl_legacy',encrypted_content:'',summary:[{type:'summary_text',text:'retained summary'}]}})+'\n');
  pids=[123];events.length=0;
  const reopened=await service.app.inject({method:'POST',url:'/api/a2a/restart',headers,payload:{target:'codex'}});
  expect(reopened.statusCode,reopened.body).toBe(200);expect(events).toEqual(['stop','open']);expect(await readFile(session,'utf8')).toContain('encrypted_content');expect(await readFile(session,'utf8')).toContain('retained summary');
 }finally{restart.mockRestore();backup.mockRestore();migration.mockRestore();await service.app.close();await rm(root,{recursive:true,force:true});}
});

it.each(['/api/a2a/restore','/api/a2a/codex-migration/restore'])('restores configuration through %s without reading or backing up conversations',async route=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'config-only-restore-'));
 await mkdir(join(root,'codex'));await mkdir(join(root,'cliproxy'));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',status:'active',models:['shared-model']}]));
 const path=join(root,'codex/config.toml'),original='model="native-model"';await writeFile(path,original);
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:path,claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async()=>[]});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 let history:MockInstance<CodexThreadMigration['restore']>|undefined,context:MockInstance<CodexContext['prepareOfficial']>|undefined;
 try{
  await service.proxy.start();
  const state=async()=>(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
  const target=await state();
  const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId:service.proxy.snapshot().accounts[0].id,model:'codex/shared-model',revision:target.revision}});
  expect(connected.statusCode,connected.body).toBe(200);
  history=vi.spyOn(CodexThreadMigration.prototype,'restore').mockRejectedValue(new Error('history unavailable'));
  context=vi.spyOn(CodexContext.prototype,'prepareOfficial').mockRejectedValue(new Error('cannot back up history'));
  const current=await state();
  // History work still requires explicit opt-in; a failed attempt retains the
  // gateway configuration so the user can retry with configuration only.
  const optional=await service.app.inject({method:'POST',url:route,headers,payload:{...(route==='/api/a2a/restore'?{id:current.connection.id,revision:current.revision}:{}),restoreHistory:true}});
  expect(optional.statusCode).toBe(500);expect((await state()).connection.id).toBe(current.connection.id);
  context.mockClear();history.mockClear();
  const restored=await service.app.inject({method:'POST',url:route,headers,payload:route==='/api/a2a/restore'?{id:current.connection.id,revision:current.revision}:{}});
  expect(restored.statusCode,restored.body).toBe(200);expect(await readFile(path,'utf8')).toBe(original);
  expect(history).not.toHaveBeenCalled();expect(context).not.toHaveBeenCalled();expect((await state()).connection).toBeNull();
 }finally{history?.mockRestore();context?.mockRestore();await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('records the real switch error when the client only sees an internal failure',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'switch-failure-'));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const restore=vi.spyOn(CodexThreadMigration.prototype,'restore').mockRejectedValue(Object.assign(new Error('旧对话缺失 tfl_secretvalue Bearer raw-token\n    at hidden'),{code:'ENOENT'}));
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')},agentProcesses:async()=>[]});
 try{
  const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
  const response=await service.app.inject({method:'POST',url:'/api/a2a/codex-migration/restore',headers,payload:{restoreHistory:true}});
  expect(response.statusCode).toBe(500);expect(response.json().error).toBe('Internal runner error');
  const failures=(await service.app.inject({url:'/api/a2a',headers})).json().switchFailures;
  expect(failures[0]).toMatchObject({action:'migration-restore',target:'codex',code:'ENOENT',message:'旧对话缺失 [key] Bearer [token]'});
  expect(JSON.stringify(failures)).not.toContain('tfl_');expect(JSON.stringify(failures)).not.toContain('raw-token');expect(JSON.stringify(failures)).not.toContain('at hidden');
 }finally{restore.mockRestore();await service.app.close();await rm(root,{recursive:true,force:true});}
});
