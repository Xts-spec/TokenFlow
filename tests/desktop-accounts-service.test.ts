import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopService} from '../packages/core/src/service.js';
it('shares Qoder authorization eligibility and keeps the two native identities independent',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'qoder-editions-api-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await mkdir(join(root,'native'));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',email:'ide@example.test',models:['fixture']}]));
 await writeFile(join(root,'cliproxy/auth/qoder.json'),JSON.stringify({type:'qoder',uid:'ide-user',email:'ide@example.test',access_token:'fixture-token',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const path=join(root,'native/ide.vscdb'),native=join(root,'native/auth.v1.dat'),db=new DatabaseSync(path);db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('secret://aicoding.auth.userInfo',JSON.stringify(Buffer.from(JSON.stringify({id:'ide-user',email:'ide@example.test',token:'private-ide-token'}))));db.close();
 const original=JSON.stringify({schemaVersion:1,user:{id:'standalone-user',email:'standalone@example.test'},token:'private-standalone-token'});await writeFile(native,original);const originalDB=await readFile(path);
 const crypto=async(op:'encrypt'|'decrypt',value:string)=>op==='decrypt'?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64'),change=vi.fn(async(_target:string,work:()=>Promise<unknown>)=>work()),vault=new Map<string,string>();let rejected=false;
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async key=>vault.get(key)??'',set:async(key,value)=>{vault.set(key,value);}},agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/settings.json')},agentProcesses:async()=>[],desktopProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'antigravity.db'),desktopAccountChange:change,desktopAccounts:{paths:{qoder:native},crypto},qoderIde:{path,crypto,fetch:async()=>rejected?new Response('',{status:401}):new Response(JSON.stringify({id:'ide-user',email:'ide@example.test',whitelistStatus:'PASS'}))}});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 try{
  await service.proxy.start();const account=service.proxy.snapshot().accounts.find(a=>a.provider==='qoder')!;expect(account.label).toBe('ide@example.test');expect(account.nativeClients).toEqual(['qoder','qoder-ide']);
  const standalone=(await service.app.inject({url:'/api/native-accounts/qoder',headers})).json(),ide=(await service.app.inject({url:'/api/native-accounts/qoder-ide',headers})).json();expect(standalone).toMatchObject({accountId:'standalone-user',email:'standalone@example.test'});expect(ide).toMatchObject({accountId:'ide-user',email:'ide@example.test',readOnly:false,backup:null});
  expect(JSON.stringify([standalone,ide])).not.toMatch(/private-ide-token|private-standalone-token|fixture-refresh/);
  expect((await service.app.inject({url:'/api/native-accounts/qoder-ide',headers:{host:headers.host}})).statusCode).toBe(401);
  rejected=true;expect((await service.app.inject({url:'/api/native-accounts/qoder-ide/switch',method:'POST',headers,payload:{sourceId:account.id,revision:ide.revision}})).statusCode).toBe(409);expect(change).not.toHaveBeenCalled();expect(await readFile(path)).toEqual(originalDB);
  rejected=false;const switched=await service.app.inject({url:'/api/native-accounts/qoder-ide/switch',method:'POST',headers,payload:{sourceId:account.id,revision:ide.revision}});expect(switched.statusCode,switched.body).toBe(200);expect(switched.json()).toMatchObject({accountId:'ide-user',backup:{state:'applied'},gatewayConnected:false});expect(change.mock.calls.map(c=>c[0])).toEqual(['qoder-ide']);expect(switched.body).not.toMatch(/fixture-token|fixture-refresh/);expect(await readFile(native,'utf8')).toBe(original);
  const restored=await service.app.inject({url:'/api/native-accounts/qoder-ide/restore',method:'POST',headers,payload:{revision:switched.json().revision}});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json()).toMatchObject({accountId:'ide-user',backup:null});expect(change.mock.calls.map(c=>c[0])).toEqual(['qoder-ide','qoder-ide']);expect(await readFile(native,'utf8')).toBe(original);
  const verify=new DatabaseSync(path,{readOnly:true});try{expect(JSON.parse(Buffer.from(JSON.parse(verify.prepare('SELECT value FROM ItemTable WHERE key=?').get('secret://aicoding.auth.userInfo')!.value as string).data).toString()).token).toBe('private-ide-token');}finally{verify.close();}
  expect(vault.has('native-login-qoder')).toBe(false);
  change.mockImplementationOnce(async(_target,work)=>{await work();throw Error('launch failed');});const unconfirmed=await service.app.inject({url:'/api/native-accounts/qoder-ide/switch',method:'POST',headers,payload:{sourceId:account.id,revision:restored.json().revision}});expect(unconfirmed.statusCode).toBe(409);expect(unconfirmed.json().error).toContain('原登录备份仍保留');expect((await service.app.inject({url:'/api/native-accounts/qoder-ide',headers})).json().backup).toMatchObject({state:'applied'});
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
it('switches and restores desktop logins without removing independent custom gateway models',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'desktop-api-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});
 const entries=['qoder','workbuddy'].map(provider=>({name:`${provider}.json`,provider,status:'active',models:['fixture']}));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(entries));
 for(const a of entries)await writeFile(join(root,'cliproxy/auth',a.name),JSON.stringify({type:a.provider,uid:'new',email:'new@example.test',access_token:'test-secret',refresh_token:'test-refresh',expired:'2035-01-01T00:00:00Z'}));
 const paths={qoder:join(root,'qoder/settings.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json')};
 const loginPaths={qoder:join(root,'qoder/auth.v1.dat'),workbuddy:join(root,'workbuddy/workbuddy-desktop.info')};
 const vault=new Map<string,string>();let rejected=false;const change=vi.fn(async(_provider:string,work:()=>Promise<unknown>)=>work());
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async n=>vault.get(n)??'',set:async(n,v)=>{vault.set(n,v);}},agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],antigravityPath:join(root,'state.vscdb'),claudeCredentialStore:null,desktopAccountChange:change,desktopAccounts:{paths:loginPaths,platform:'darwin',crypto:async(op,value)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString(),fetch:async()=>rejected?new Response('',{status:401}):new Response(JSON.stringify({id:'new',email:'new@example.test',data:{accounts:[{uid:'new',type:'personal',pluginEnabled:true}]}}))}});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 try{
  await service.proxy.start();
  for(const provider of ['qoder','workbuddy'] as const){
   const url=`/api/native-accounts/${provider}`;expect((await service.app.inject({url,headers:{host:headers.host}})).statusCode).toBe(401);
   const source=service.proxy.snapshot().accounts.find(a=>a.provider===provider)!;const other=service.proxy.snapshot().accounts.find(a=>a.provider!==provider)!;
   let status=(await service.app.inject({url,headers})).json();expect(status.accounts[0].switchable).toBe(true);
   let payload={sourceId:source.id,revision:status.revision};
   expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers:{...headers,origin:'https://evil.test'},payload})).statusCode).toBe(403);
   expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload:{...payload,sourceId:other.id}})).statusCode).toBe(409);
   const targets=(await service.app.inject({url:'/api/a2a',headers})).json().targets;
   const connected=await service.app.inject({url:'/api/a2a/connect',method:'POST',headers,payload:{target:provider,revision:targets.find((t:{id:string})=>t.id===provider).revision,sourceId:source.id,model:`${provider}/fixture`}});expect(connected.statusCode,connected.body).toBe(200);
   const imported=await readFile(paths[provider]);
   rejected=true;const calls=change.mock.calls.length;
   const denied=await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload});expect(denied.statusCode,denied.body).toBe(409);expect(change.mock.calls.length).toBe(calls);expect((await service.app.inject({url,headers})).json().gatewayConnected).toBe(true);
   rejected=false;const switched=await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload});expect(switched.statusCode,switched.body).toBe(200);status=switched.json();expect(status.gatewayConnected).toBe(true);expect(status.accountId).toBe('new');expect(switched.body).not.toMatch(/test-secret|test-refresh|access_token/);
   expect(await readFile(paths[provider])).toEqual(imported);
   const restored=await service.app.inject({url:`${url}/restore`,method:'POST',headers,payload:{revision:status.revision}});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json().backup).toBeNull();await expect(readFile(loginPaths[provider])).rejects.toHaveProperty('code','ENOENT');
   expect(restored.json().gatewayConnected).toBe(true);expect(await readFile(paths[provider])).toEqual(imported);
   expect((await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:any)=>t.id===provider).connection.id).toBe(connected.json().id);
   const config=JSON.parse(imported.toString()),key=provider==='qoder'?config.providers['token-flow'].apiKey:config[0].apiKey;
   expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${key}`}})).statusCode).toBe(200);
  }
  for(const a of entries)expect(await readFile(join(root,'cliproxy/auth',a.name),'utf8')).toContain('test-refresh');
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('keeps authorization usable without native login and isolates domestic and international account switching',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'desktop-editions-api-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const entries=[{name:'domestic.json',provider:'workbuddy',uid:'cn-user',domain:'copilot.tencent.com'},{name:'international.json',provider:'workbuddy',uid:'ai-user',domain:'www.workbuddy.ai'},{name:'qoder.json',provider:'qoder',uid:'qoder-user'}];
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(entries.map(a=>({...a,email:`${a.uid}@example.test`,status:'active',models:['fixture']}))));
 for(const a of entries)await writeFile(join(root,'cliproxy/auth',a.name),JSON.stringify({...a,type:a.provider,email:`${a.uid}@example.test`,access_token:'fixture-token',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const paths={qoder:join(root,'qoder/settings.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json')};
 const loginPaths={qoder:join(root,'qoder/auth.v1.dat'),workbuddy:join(root,'auth/workbuddy-desktop.info'),'workbuddy-ai':join(root,'auth/workbuddy-desktop-ai.info')};
 const vault=new Map<string,string>(),change=vi.fn(async(_provider:string,work:()=>Promise<unknown>)=>work());
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async n=>vault.get(n)??'',set:async(n,v)=>{vault.set(n,v);}},agentPaths:paths,agentProcesses:async()=>[],desktopProcesses:async()=>[],nativeProcesses:async()=>[],antigravityPath:join(root,'state.vscdb'),claudeCredentialStore:null,desktopAccountChange:change,desktopAccounts:{paths:loginPaths,platform:'darwin',crypto:async(op,value)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString(),fetch:async url=>new Response(JSON.stringify({data:{accounts:[{uid:String(url).includes('www.workbuddy.ai')?'ai-user':'cn-user',type:'personal',pluginEnabled:true}]}}))}});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'},status=async(provider:string)=>(await service.app.inject({url:`/api/native-accounts/${provider}`,headers})).json();
 try{
  await service.proxy.start();const sources=service.proxy.snapshot().accounts;
  for(const a of sources){expect(()=>service.proxy.sourceAuth(a.id,`${a.provider}/fixture`)).not.toThrow();}
  for(const provider of ['workbuddy','workbuddy-ai','qoder'])expect(await status(provider)).toMatchObject({loginState:'signed-out',backup:null});
  const cn=await status('workbuddy'),ai=await status('workbuddy-ai');expect(cn.accounts.map((a:{accountId:string})=>a.accountId)).toEqual(['cn-user']);expect(ai.accounts.map((a:{accountId:string})=>a.accountId)).toEqual(['ai-user']);
  const source=cn.accounts[0],targets=(await service.app.inject({url:'/api/a2a',headers})).json().targets;
  const connected=await service.app.inject({url:'/api/a2a/connect',method:'POST',headers,payload:{target:'workbuddy',revision:targets.find((t:{id:string})=>t.id==='workbuddy').revision,sourceId:source.id,model:'workbuddy/fixture'}});expect(connected.statusCode,connected.body).toBe(200);
  const config=await readFile(paths.workbuddy);
  await mkdir(join(root,'auth'),{recursive:true});const originalCN=JSON.stringify({account:{uid:'existing-cn',nickname:'Local CN'},auth:{domain:'copilot.tencent.com'}}),originalAI=JSON.stringify({account:{uid:'existing-ai',nickname:'Local AI'},auth:{domain:'www.workbuddy.ai'}});
  await writeFile(loginPaths.workbuddy,originalCN);await writeFile(loginPaths['workbuddy-ai'],originalAI);
  const nativeAI=await status('workbuddy-ai');expect(nativeAI).toMatchObject({accountId:'existing-ai',displayName:'Local AI',backup:null});
  const wrong=await service.app.inject({url:'/api/native-accounts/workbuddy-ai/switch',method:'POST',headers,payload:{sourceId:source.id,revision:nativeAI.revision}});expect(wrong.statusCode).toBe(409);expect(change).not.toHaveBeenCalled();
  const switched=await service.app.inject({url:'/api/native-accounts/workbuddy-ai/switch',method:'POST',headers,payload:{sourceId:ai.accounts[0].id,revision:nativeAI.revision}});expect(switched.statusCode,switched.body).toBe(200);expect(switched.json()).toMatchObject({accountId:'ai-user',domain:'www.workbuddy.ai'});expect(change.mock.calls.map(c=>c[0])).toEqual(['workbuddy-ai']);
  expect(await readFile(loginPaths.workbuddy,'utf8')).toBe(originalCN);expect(await readFile(paths.workbuddy)).toEqual(config);expect((await status('workbuddy')).gatewayConnected).toBe(true);
  const restored=await service.app.inject({url:'/api/native-accounts/workbuddy-ai/restore',method:'POST',headers,payload:{revision:switched.json().revision}});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json()).toMatchObject({accountId:'existing-ai',backup:null});expect(await readFile(loginPaths['workbuddy-ai'],'utf8')).toBe(originalAI);expect(await readFile(loginPaths.workbuddy,'utf8')).toBe(originalCN);
  expect(vault.has('native-login-workbuddy')).toBe(false);expect(change.mock.calls.map(c=>c[0])).toEqual(['workbuddy-ai','workbuddy-ai']);
  for(const a of sources)expect(()=>service.proxy.sourceAuth(a.id,`${a.provider}/fixture`)).not.toThrow();
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
