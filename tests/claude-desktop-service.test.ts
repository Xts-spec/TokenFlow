import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.js';
it('authenticates desktop changes, scopes and revokes keys, and retains a recoverable config after reopening fails',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'claude-desktop-api-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'claude.json',provider:'claude',status:'active',models:['claude-sonnet-4-6','claude-opus-4-6']} ]));
 await writeFile(join(root,'cliproxy/auth/claude.json'),JSON.stringify({type:'claude',email:'fixture@example.test',access_token:'fixture-access',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const vault=new Map<string,string>(),directory=join(root,'Claude-3p');let failOpen=false;
 const change=vi.fn(async(work:()=>Promise<unknown>)=>{await work();if(failOpen)throw Error('reopen fixture failure');});
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async n=>vault.get(n)??'',set:async(n,v)=>{vault.set(n,v);}},agentPaths:{qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json')},agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'antigravity.db'),claudeDesktop:{directory,processes:async()=>[],policy:async()=>{}},claudeDesktopChange:change});
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'},url='/api/claude-desktop';
 const status=async()=>(await service.app.inject({url,headers})).json();const keys=async()=>(await service.app.inject({url:'/api/gateway-keys',headers})).json().keys;
 try{
  await service.proxy.start();const sourceId=service.proxy.snapshot().accounts[0].id;const selections=[{sourceId,model:'claude/claude-sonnet-4-6'}];
  expect((await service.app.inject({url,headers:{host:headers.host}})).statusCode).toBe(401);
  let payload={revision:(await status()).revision,selections};
  expect((await service.app.inject({url:`${url}/connect`,method:'POST',headers:{...headers,origin:'https://evil.test'},payload})).statusCode).toBe(403);
  expect((await service.app.inject({url:`${url}/connect`,method:'POST',headers,payload:{...payload,selections:Array.from({length:201},(_,n)=>({sourceId,model:`claude/model-${n}`}))}})).statusCode).toBe(400);expect(change).not.toHaveBeenCalled();expect(await keys()).toEqual([]);
  expect((await service.app.inject({url:`${url}/connect`,method:'POST',headers,payload:{...payload,selections:[{sourceId,model:'codex/gpt-5'}]}})).statusCode).toBe(409);expect(change).not.toHaveBeenCalled();expect(await keys()).toEqual([]);
  const connected=await service.app.inject({url:`${url}/connect`,method:'POST',headers,payload});expect(connected.statusCode,connected.body).toBe(200);expect(connected.json().connected).toBe(true);expect(connected.body).not.toMatch(/fixture-access|fixture-refresh|tfl_/);
  const first=(await keys())[0];expect(first.agents).toEqual(['claude']);expect(first.models).toEqual(['claude/claude-sonnet-4-6']);expect(first.modelSources).toEqual({'claude/claude-sonnet-4-6':sourceId});
  const journal=JSON.parse(vault.get('native-login-claude-desktop')!),profile=JSON.parse(await readFile(join(directory,'configLibrary',`${journal.id}.json`),'utf8'));
  expect(profile.inferenceModels[0]).toMatchObject({name:'claude-sonnet-5'});expect(profile.inferenceModels[0].supports1m).toBeUndefined();expect(profile.inferenceModels[0].prefer1m).toBeUndefined();expect(profile.inferenceGatewayBaseUrl).toBe('http://127.0.0.1:9527');expect(profile.coworkEgressAllowedHosts).toEqual(['*']);expect(profile.disableDeploymentModeChooser).toBe(true);expect(journal.modelAliases['claude-sonnet-5']).toBe('claude/claude-sonnet-4-6');expect(journal.modelAliases['claude-haiku-4-5']).toBe('claude/claude-sonnet-4-6');
  const inferenceHeaders={host:headers.host,authorization:`Bearer ${profile.inferenceGatewayApiKey}`,'user-agent':'Claude/2.42304.0','anthropic-version':'2023-06-01'};
  const message={model:'claude-sonnet-5',max_tokens:16,messages:[{role:'user',content:'fixture'}]};
  const inference=await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:message});expect(inference.statusCode,inference.body).toBe(200);expect(inference.json().content[0].text).toBe('claude');
  expect((await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:{...message,model:'claude-sonnet-5[1m]'}})).statusCode).toBe(200);
  const opusSubagent=await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:{...message,model:'claude-opus-4-8'}});expect(opusSubagent.statusCode,opusSubagent.body).toBe(200);
  const stream=await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:{...message,stream:true}});expect(stream.statusCode,stream.body).toBe(200);expect(stream.body).toContain('message_stop');
  expect((await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:{...message,model:'claude-haiku-4-5'}})).statusCode).toBe(200);
  expect((await service.app.inject({url:'/v1/messages',method:'POST',headers:inferenceHeaders,payload:{...message,model:'claude/claude-opus-4-6'}})).statusCode).toBe(403);
  const usage=(await service.app.inject({url:'/api/gateway/usage?days=0',headers})).json().rows;expect(usage.length).toBeGreaterThan(0);expect(new Set(usage.map((row:{target:string})=>row.target))).toEqual(new Set(['claude-desktop']));
  const billed=usage.filter((row:{inputTokens:number})=>row.inputTokens>0);
  expect(billed).not.toHaveLength(0);
  for(const row of billed)expect(row).toMatchObject({sourceId,model:selections[0].model});
  expect((await service.app.inject({url:`${url}/connect`,method:'POST',headers,payload})).statusCode).toBe(409);expect(change).toHaveBeenCalledOnce();
  payload={revision:(await status()).revision,selections:[{sourceId,model:'claude/claude-opus-4-6'}]};failOpen=true;
  const replaced=await service.app.inject({url:`${url}/connect`,method:'POST',headers,payload});expect(replaced.statusCode,replaced.body).toBe(409);expect(replaced.json().error).toContain('已保存');expect((await status()).connected).toBe(true);expect(await keys()).toHaveLength(1);expect((await keys())[0].id).not.toBe(first.id);
  failOpen=false;const restored=await service.app.inject({url:`${url}/official`,method:'POST',headers,payload:{revision:(await status()).revision}});expect(restored.statusCode,restored.body).toBe(200);expect(restored.json()).toMatchObject({connected:false,backup:null,mode:'1p'});expect(restored.json().message).toContain('账号菜单');expect(await keys()).toEqual([]);expect(JSON.parse(await readFile(join(directory,'claude_desktop_config.json'),'utf8'))).toEqual({deploymentMode:'1p'});
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('separates internal subagent families from eleven menu routes, persists roles and rejects ambiguous legacy mappings',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'claude-subagent-routing-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy'),{recursive:true});
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',models:['dfmodel',...Array.from({length:9},(_,i)=>`extra-${i}`)]},{name:'codex.json',provider:'codex',status:'active',models:['alternate']} ]));
 const vault=new Map<string,string>(),directory=join(root,'Claude-3p');
 const options={root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',secrets:{get:async(n:string)=>vault.get(n)??'',set:async(n:string,v:string)=>{vault.set(n,v);}},agentPaths:Object.fromEntries(['qoder','workbuddy','codex','claude','deepseek','pi'].map(name=>[name,join(root,name,'settings.json')])),agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'antigravity.db'),claudeDesktop:{directory,processes:async()=>[],policy:async()=>{}},claudeDesktopChange:async(work:()=>Promise<unknown>)=>work()};
 let service=await createDesktopService(options);
 const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'},status=async()=>(await service.app.inject({url:'/api/claude-desktop',headers})).json();
 try{
  await service.proxy.start();const accounts=service.proxy.snapshot().accounts,qoder=accounts.find(a=>a.provider==='qoder')!,codex=accounts.find(a=>a.provider==='codex')!;
  const selections=[{sourceId:qoder.id,model:'qoder/dfmodel'},...Array.from({length:9},(_,i)=>({sourceId:qoder.id,model:`qoder/extra-${i}`})),{sourceId:codex.id,model:'codex/alternate'}];
  const connect=async()=>{const response=await service.app.inject({url:'/api/claude-desktop/connect',method:'POST',headers,payload:{revision:(await status()).revision,selections,fast:selections[10]}});expect(response.statusCode,response.body).toBe(200);};
  await connect();expect((await status()).mappingUpdateRequired).toBe(false);
  let journal=JSON.parse(vault.get('native-login-claude-desktop')!);const profile=JSON.parse(await readFile(join(directory,'configLibrary',`${journal.id}.json`),'utf8'));
  let key=profile.inferenceGatewayApiKey;
  const invoke=(model:string,extra:object={},path='messages')=>service.app.inject({url:`/v1/${path}`,method:'POST',headers:{host:headers.host,authorization:`Bearer ${key}`},payload:{model,max_tokens:16,messages:[{role:'user',content:'fixture'}],...extra}});
  for(const model of ['claude-opus-4-8','claude-opus-5-5[1m]','claude-sonnet-4-6','claude-fable-5','claude-mythos-5']){const response=await invoke(model);expect(response.statusCode,response.body).toBe(200);expect(response.json().content[0].text).toBe('qoder');expect(response.headers['x-token-flow-model']).toBe('qoder/dfmodel');}
  const stream=await invoke('claude-opus-4-8',{stream:true});expect(stream.statusCode,stream.body).toBe(200);expect(stream.body).toContain('"text":"qoder"');
  expect((await invoke('claude-opus-4-8',{},'messages/count_tokens')).json()).toEqual({input_tokens:7});
  for(const model of ['claude-haiku-4-5','claude-haiku-5-5[1m]',profile.inferenceModels[10].name,'codex/alternate']){const response=await invoke(model);expect(response.statusCode,response.body).toBe(200);expect(response.json().content[0].text).toBe('codex');}
  for(const model of ['cursor/grok-4.7','claude-opus-arbitrary','claude-sonnet-5-tokenflow-199'])expect((await invoke(model)).statusCode).toBe(403);
  const ordinary=(await service.app.inject({url:'/api/gateway-keys',method:'POST',headers,payload:{name:'ordinary',models:['qoder/dfmodel']}})).json();
  expect((await service.app.inject({url:'/v1/messages',method:'POST',headers:{host:headers.host,authorization:`Bearer ${ordinary.apiKey}`},payload:{model:'claude-opus-4-8',max_tokens:16,messages:[]}})).statusCode).toBe(403);
  await service.app.close();service=await createDesktopService(options);await service.proxy.start();
  expect((await invoke('claude-opus-4-8')).json().content[0].text).toBe('qoder');expect((await invoke('claude-haiku-5-5')).json().content[0].text).toBe('codex');
  // Simulate a pre-upgrade profile whose eleventh menu row collided with Opus 4.8.
  journal=JSON.parse(vault.get('native-login-claude-desktop')!);delete journal.modelAliases[profile.inferenceModels[10].name];journal.modelAliases['claude-opus-4-8']='codex/alternate';vault.set('native-login-claude-desktop',JSON.stringify(journal));
  await service.app.close();service=await createDesktopService(options);await service.proxy.start();
  expect((await status()).mappingUpdateRequired).toBe(true);
  const conflict=await invoke('claude-opus-4-8');expect(conflict.statusCode).toBe(409);expect(conflict.json().error.type).toBe('model_mapping_conflict');expect(conflict.body).toContain('重新应用');
  await connect();expect((await status()).mappingUpdateRequired).toBe(false);
  const oldKey=key;key=JSON.parse(JSON.parse(vault.get('native-login-claude-desktop')!).after.profile).inferenceGatewayApiKey;
  expect((await invoke('claude-opus-4-8')).json().content[0].text).toBe('qoder');
  expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${oldKey}`}})).statusCode).toBe(401);
  const cli=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((target:{id:string})=>target.id==='claude');
  const cliConnected=await service.app.inject({url:'/api/a2a/connect',method:'POST',headers,payload:{target:'claude',...selections[0],selections,fastModel:selections[10].model,fastSourceId:selections[10].sourceId,revision:cli.revision}});expect(cliConnected.statusCode,cliConnected.body).toBe(200);
  key=JSON.parse(await readFile(options.agentPaths.claude,'utf8')).env.ANTHROPIC_AUTH_TOKEN;
  for(const model of ['claude-opus-4-8','sonnet[1m]','opusplan'])expect((await invoke(model)).json().content[0].text).toBe('qoder');
  expect((await invoke('claude-haiku-5-5')).json().content[0].text).toBe('codex');
  await service.app.close();service=await createDesktopService(options);await service.proxy.start();
  expect((await invoke('claude-opus-4-8')).json().content[0].text).toBe('qoder');expect((await invoke('claude-haiku-5-5')).json().content[0].text).toBe('codex');
  const cliTarget=(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((target:{id:string})=>target.id==='claude');
  const cliRestored=await service.app.inject({url:'/api/a2a/restore',method:'POST',headers,payload:{id:cliTarget.connection.id,revision:cliTarget.revision}});expect(cliRestored.statusCode,cliRestored.body).toBe(200);
  const nativeCLI=JSON.parse(await readFile(options.agentPaths.claude,'utf8'));expect(nativeCLI.modelPicker).toBeUndefined();expect(nativeCLI.availableModels).toBeUndefined();expect(nativeCLI.model).toBeUndefined();
  for(const field of ['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL','CLAUDE_CODE_SUBAGENT_MODEL','CLAUDE_CODE_ENABLE_GATEWAY_MODEL_DISCOVERY'])expect(nativeCLI.env?.[field]).toBeUndefined();
  expect((await invoke('claude-opus-4-8')).statusCode).toBe(401);
  const desktopKey=JSON.parse(JSON.parse(vault.get('native-login-claude-desktop')!).after.profile).inferenceGatewayApiKey;
  const desktopRestored=await service.app.inject({url:'/api/claude-desktop/restore',method:'POST',headers,payload:{revision:(await status()).revision}});expect(desktopRestored.statusCode,desktopRestored.body).toBe(200);
  expect(JSON.parse(await readFile(join(directory,'claude_desktop_config.json'),'utf8')).deploymentMode).toBe('1p');
  await expect(readFile(join(directory,'configLibrary',`${JSON.parse(vault.get('native-login-claude-desktop')!).id}.json`))).rejects.toHaveProperty('code','ENOENT');
  expect((await service.app.inject({url:'/v1/models',headers:{host:headers.host,authorization:`Bearer ${desktopKey}`}})).statusCode).toBe(401);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});}
});
