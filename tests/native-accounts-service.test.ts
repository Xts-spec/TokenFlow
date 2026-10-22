import { expect,it } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,rm,realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { createDesktopService } from '../packages/core/src/service.js';
it('protects native account APIs, binds sources to providers, switches/restores both clients and keeps the pool',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'native-api-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});const path=join(root,'state.vscdb'),db=new DatabaseSync(path);db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE,value TEXT)');db.close();
 const entries=[{name:'claude.json',provider:'claude',status:'active',models:['sonnet']},{name:'antigravity.json',provider:'antigravity',status:'active',models:['gemini']},{name:'incomplete.json',provider:'claude',status:'active',models:['sonnet']}];
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(entries));const pool:Record<string,string>={};
 for(const a of entries){pool[a.name]=JSON.stringify({type:a.provider,email:a.name==='incomplete.json'?'incomplete@example.test':`${a.provider}@example.test`,access_token:'secret-access',...(a.name==='incomplete.json'?{}:{refresh_token:'secret-refresh'}),expired:'2030-01-01T00:00:00Z'});await writeFile(join(root,'cliproxy/auth',a.name),pool[a.name]);}
 const paths={qoder:join(root,'qoder/settings.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json')};let running=false;
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>running?[1]:[],antigravityPath:path,claudeCredentialStore:null});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 try{
  await service.proxy.start();
  const zcodeStatus=await service.app.inject({url:'/api/native-accounts/zcode',headers});expect(zcodeStatus.statusCode).toBe(410);expect(zcodeStatus.body).toContain('官网授权');
  const zcodeImport=await service.app.inject({url:'/api/local-agent/import-local/zcode',method:'POST',headers,payload:{}});expect(zcodeImport.statusCode).toBe(400);expect(zcodeImport.body).toContain('官网授权');
  for(const provider of ['claude','antigravity']){
   const url=`/api/native-accounts/${provider}`;
   expect((await service.app.inject({url,headers:{host:headers.host}})).statusCode).toBe(401);
   let status=(await service.app.inject({url,headers})).json();if(provider==='claude')expect(status.accounts.map((a:{switchable:boolean})=>a.switchable)).toEqual([true,false]);
   const source=service.proxy.snapshot().accounts.find(a=>a.provider===provider)!;const other=service.proxy.snapshot().accounts.find(a=>a.provider!==provider)!;
   const payload={revision:status.revision,sourceId:source.id,...(provider==='claude'?{model:'claude/sonnet'}:{})};
   expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers:{...headers,origin:'https://evil.test'},payload})).statusCode).toBe(403);
   expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload:{...payload,sourceId:other.id}})).statusCode).toBe(409);
   running=true;expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload})).statusCode).toBe(409);running=false;
   if(provider==='claude')expect((await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload:{...payload,model:'claude/absent'}})).statusCode).toBe(409);
   const switched=await service.app.inject({url:`${url}/switch`,method:'POST',headers,payload});expect(switched.statusCode,switched.body).toBe(200);expect(switched.body).not.toMatch(/secret-|refresh_token|access_token|accessToken/);status=switched.json();expect(status.email).toBe(`${provider}@example.test`);
   if(provider==='antigravity'){
    const before=await readFile(path),count=service.proxy.snapshot().accounts.length;
    const imported=await service.app.inject({url:'/api/local-agent/import-local/antigravity',method:'POST',headers,payload:{}});
    expect(imported.statusCode,imported.body).toBe(200);expect(imported.body).not.toMatch(/secret-access|secret-refresh/);
    expect(service.proxy.snapshot().accounts).toHaveLength(count);expect(await readFile(path)).toEqual(before);
   }
   const restored=await service.app.inject({url:`${url}/restore`,method:'POST',headers,payload:{revision:status.revision}});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json().backup).toBeNull();
  }
  const source=service.proxy.snapshot().accounts.find(a=>a.provider==='claude')!;
  await writeFile(paths.claude,JSON.stringify({env:{ANTHROPIC_BASE_URL:'https://previous.invalid',ANTHROPIC_DEFAULT_OPUS_MODEL:'old-route',CLAUDE_CODE_SUBAGENT_MODEL:'old-subagent'},availableModels:['old-menu'],modelPicker:{replaceBuiltInOptions:true}}));
  const targets=(await service.app.inject({url:'/api/a2a',headers})).json().targets;
  const connected=await service.app.inject({url:'/api/a2a/connect',method:'POST',headers,payload:{target:'claude',revision:targets.find((t:{id:string})=>t.id==='claude').revision,sourceId:source.id,model:'claude/sonnet'}});expect(connected.statusCode,connected.body).toBe(200);
  const status=(await service.app.inject({url:'/api/native-accounts/claude',headers})).json();expect(status.gatewayConnected).toBe(true);
  const blocked=await service.app.inject({url:'/api/native-accounts/claude/switch',method:'POST',headers,payload:{revision:status.revision,sourceId:source.id,model:'claude/sonnet'}});expect(blocked.statusCode,blocked.body).toBe(200);expect(blocked.json().gatewayConnected).toBe(false);expect(blocked.json().email).toBe('claude@example.test');
  const nativeSettings=JSON.parse(await readFile(paths.claude,'utf8'));expect(nativeSettings.availableModels).toBeUndefined();expect(nativeSettings.modelPicker).toBeUndefined();expect(nativeSettings.env?.CLAUDE_CODE_SUBAGENT_MODEL).toBeUndefined();expect(nativeSettings.env?.ANTHROPIC_DEFAULT_OPUS_MODEL).toBeUndefined();
  for(const [name,raw] of Object.entries(pool))expect(await readFile(join(root,'cliproxy/auth',name),'utf8')).toBe(raw);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
it('imports a native Claude login into the model pool without changing the keychain or native profile',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'native-claude-import-'));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const directory=join(root,'claude');await mkdir(directory);
 const settings=join(directory,'settings.json'),profile=join(directory,'.claude.json');
 const profileData=JSON.stringify({oauthAccount:{emailAddress:'native@example.test',accountUuid:'native-user',organizationUuid:'native-org'}});await writeFile(profile,profileData);
 const oauth=JSON.stringify({claudeAiOauth:{accessToken:'private-claude-access',refreshToken:'private-claude-refresh',expiresAt:Date.parse('2035-01-01'),scopes:['user:inference']}});
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{claude:settings},claudeCredentialStore:{read:async()=>oauth,write:async()=>{throw Error('must not change the native login');}}});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 try{
  for(let i=0;i<2;i++){
   const r=await service.app.inject({url:'/api/local-agent/import-local/claude',method:'POST',headers,payload:{}});
   expect(r.statusCode,r.body).toBe(200);expect(r.json().accounts.filter((a:{provider:string})=>a.provider==='claude')).toHaveLength(1);
   expect(r.json().accounts.find((a:{provider:string})=>a.provider==='claude').models).toEqual(['claude/imported-model']);
   expect(r.body).not.toMatch(/private-claude|access_token|refresh_token/);
  }
  expect(await readFile(profile,'utf8')).toBe(profileData);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
