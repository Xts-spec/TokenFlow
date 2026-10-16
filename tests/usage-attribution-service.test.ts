import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {parse} from 'smol-toml';
import {createDesktopService} from '../packages/core/src/service.js';

it('keeps Antigravity Gemini and Claude usage separated by source account, including failures and service restart',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-antigravity-usage-')),allocator=createServer();
 await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const models=['antigravity/gemini-fixture','antigravity/claude-fixture'];
 const paths=Object.fromEntries(['codex','claude','qoder','workbuddy','pi','deepseek'].map(target=>[target,join(root,target,target==='codex'?'config.toml':'settings.json')]));
 await mkdir(join(root,'cliproxy'),{recursive:true});
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(['a','b'].map(name=>({name:`${name}.json`,email:`${name}@example.test`,provider:'antigravity',status:'active',models:['gemini-fixture','claude-fixture']}))));
 const options={root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'ag.db'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}}};
 let service=await createDesktopService(options);const admin={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 try{
  await service.proxy.start();const accounts=service.proxy.snapshot().accounts.filter(a=>a.provider==='antigravity');expect(accounts).toHaveLength(2);
  const keys=[];
  for(const source of accounts){
   const created=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'Usage fixture',sourceId:source.id,models,agents:['claude']}});
   expect(created.statusCode,created.body).toBe(200);keys.push(created.json());
   for(const [index,model] of models.entries()){
    const result=await service.app.inject({method:'POST',url:'/v1/messages',headers:{host:admin.host,authorization:`Bearer ${created.json().apiKey}`},payload:{model,max_tokens:10,stream:index===1,messages:[{role:'user',content:'Fixture'}]}});
    expect(result.statusCode,result.body).toBe(200);
   }
  }
  const overview=async()=>(await service.app.inject({url:'/api/usage/overview?days=0',headers:admin})).json();
  let snapshot=await overview();expect(snapshot.rows).toHaveLength(4);
  // Exported Keys prove the source, but do not prove which client used them.
  for(const source of accounts)for(const model of models)expect(snapshot.rows.find((r:any)=>r.sourceId===source.id&&r.model===model)).toMatchObject({target:'key',provider:'antigravity',origin:'gateway',channel:'official',requests:1,failed:0,inputTokens:7,outputTokens:3});
  await service.proxy.setAccountEnabled(accounts[0].id,false);
  const failed=await service.app.inject({method:'POST',url:'/v1/messages',headers:{host:admin.host,authorization:`Bearer ${keys[0].apiKey}`},payload:{model:models[0],max_tokens:10,messages:[{role:'user',content:'Fixture'}]}});expect(failed.statusCode).toBe(503);
  snapshot=await overview();expect(snapshot.rows.find((r:any)=>r.sourceId===accounts[0].id&&r.model===models[0])).toMatchObject({requests:2,failed:1,inputTokens:7,outputTokens:3});
  expect(snapshot.rows.filter((r:any)=>r.sourceId===accounts[1].id).reduce((n:number,r:any)=>n+r.requests,0)).toBe(2);
  const target=(await service.app.inject({url:'/api/a2a',headers:admin})).json().targets.find((t:any)=>t.id==='claude');
  const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers:admin,payload:{target:'claude',revision:target.revision,sourceId:accounts[1].id,model:models[1]}});expect(connected.statusCode,connected.body).toBe(200);
  const client=JSON.parse(await readFile(paths.claude,'utf8'));
  const managed=await service.app.inject({method:'POST',url:'/v1/messages',headers:{host:admin.host,authorization:`Bearer ${client.env.ANTHROPIC_AUTH_TOKEN}`},payload:{model:models[1],max_tokens:10,messages:[{role:'user',content:'Fixture'}]}});expect(managed.statusCode,managed.body).toBe(200);
  snapshot=await overview();expect(snapshot.rows).toHaveLength(5);expect(snapshot.rows.find((r:any)=>r.target==='claude')).toMatchObject({sourceId:accounts[1].id,model:models[1],provider:'antigravity',origin:'gateway',channel:'official',requests:1,inputTokens:7,outputTokens:3});
  await service.app.close();service=await createDesktopService(options);await service.proxy.start();
  const restored=await overview();expect(restored.rows).toEqual(snapshot.rows);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});

it('receives protected local account evidence and joins switched users into overview and activity without guessing historical accounts',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-attribution-service-'));const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/settings.json')};
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await mkdir(join(root,'codex/sessions'),{recursive:true});
 await writeFile(join(root,'codex/config.toml'),'# user comment\nmodel = "gpt-test"\n');
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(['a','b'].map(name=>({name:name+'.json',provider:'codex',status:'active',email:name+'@example.test',models:['model-a']}))));
 for(const name of ['a','b'])await writeFile(join(root,'cliproxy/auth',name+'.json'),JSON.stringify({account_id:'shared-workspace',email:name+'@example.test',access_token:'fixture-token',refresh_token:'fixture-refresh',id_token:'x.e30.x'}));
 const service=await createDesktopService({root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),agentPaths:paths,agentProcesses:async()=>[],token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}}});
 try{
  await service.proxy.start();await service.app.listen({host:'127.0.0.1',port:0});
  await expect.poll(async()=>{const c=parse(await readFile(paths.codex,'utf8')) as any;return !!c.otel;}).toBe(true);
  const config=parse(await readFile(paths.codex,'utf8')) as any,exporter=config.otel.exporter['otlp-http'];const auth={'x-tokenflow-recorder':exporter.headers['x-tokenflow-recorder'],host:'127.0.0.1:9527'};
  const cutoff=JSON.parse(await readFile(join(root,'usage-account-recorder.json'),'utf8')).since;
  const logs=[{type:'session_meta',payload:{id:'thread',model_provider:'openai',creator_account_id:'old-owner'}},{type:'turn_context',payload:{model:'gpt-test'}},...[-10000,100,10100].map((delta,i)=>({type:'token_usage_record',timestamp:new Date(cutoff+delta).toISOString(),payload:{response_id:'resp-'+i,usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}}))];
  await writeFile(join(root,'codex/sessions/fixture.jsonl'),logs.map(r=>JSON.stringify(r)).join('\n'));
  const batch={resourceLogs:[{scopeLogs:[{logRecords:['a','b'].map((name,i)=>({timeUnixNano:String(BigInt(cutoff+100+i*10000)*1000000n),body:{stringValue:'DO_NOT_STORE'},attributes:Object.entries({'event.name':'codex.sse_event','event.kind':'response.completed',auth_mode:'chatgpt','user.account_id':'shared-workspace','user.email':name+'@example.test','conversation.id':'thread',model:'gpt-test',input_token_count:'100',cached_token_count:'60',output_token_count:'20'}).map(([key,value])=>({key,value:{stringValue:value}}))}))}]}]};
  const endpoint='/local-telemetry/codex/v1/logs';expect((await service.app.inject({method:'POST',url:endpoint,headers:{host:auth.host,authorization:'Bearer admin'},payload:batch})).statusCode).toBe(401);
  expect((await service.app.inject({method:'POST',url:endpoint,headers:auth,payload:batch})).statusCode).toBe(200);
  await expect.poll(async()=>JSON.parse(await readFile(join(root,'usage-account-evidence.json'),'utf8').catch(()=>'{}')).records?.length).toBe(2);
  const admin={host:auth.host,authorization:'Bearer admin'};
  await expect.poll(async()=>{const overview=(await service.app.inject({url:'/api/usage/overview?days=0',headers:admin})).json();return overview.nativeRows.filter((r:any)=>r.sourceId).length;},{timeout:10000}).toBe(2);
  const overview=(await service.app.inject({url:'/api/usage/overview?days=0',headers:admin})).json();expect(overview.nativeRows.filter((r:any)=>!r.nativeAccountId).reduce((n:number,r:any)=>n+r.requests,0)).toBe(1);expect(new Set(overview.nativeRows.filter((r:any)=>r.sourceId).map((r:any)=>r.sourceId)).size).toBe(2);
  const activity=(await service.app.inject({url:'/api/activity/traces?days=0',headers:admin})).json().records;expect(activity.filter((r:any)=>r.accountLabel).map((r:any)=>r.accountLabel).sort()).toEqual(['a@example.test','b@example.test']);
  expect(await readFile(join(root,'usage-account-evidence.json'),'utf8')).not.toMatch(/DO_NOT_STORE|example\.test|fixture-token|shared-workspace/);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
},20000);

it.each([['codex',true],['claude',true],['codex',false],['claude',false]] as const)('attributes new %s usage from an existing native login without a TokenFlow account switch (saved account: %s)',async(provider,inPool)=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-native-login-usage-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/settings.json')};
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await mkdir(join(root,'codex/sessions'),{recursive:true});await mkdir(join(root,'claude/projects'),{recursive:true});
 const email='native@example.test',account='native-user',org='native-org';const jwt=`x.${Buffer.from(JSON.stringify({email})).toString('base64url')}.x`;
 await writeFile(paths.codex,'model="gpt-test"\n');await writeFile(paths.claude,'{}');
 if(provider==='codex')await writeFile(join(root,'codex/auth.json'),JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:account,id_token:jwt,access_token:'fixture-access',refresh_token:'fixture-refresh'}}));
 else{await writeFile(join(root,'claude/.claude.json'),JSON.stringify({oauthAccount:{emailAddress:email,accountUuid:account,organizationUuid:org}}));await writeFile(join(root,'claude/.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'fixture-access',refreshToken:'fixture-refresh',expiresAt:Date.parse('2035-01-01'),scopes:['user:inference']}}));}
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(inPool?[{name:'native.json',provider,status:'active',email,models:['fixture-model']} ]:[]));
 await writeFile(join(root,'cliproxy/auth/native.json'),JSON.stringify({type:provider,email,account_id:account,account_uuid:account,organization_uuid:org,id_token:jwt,access_token:'fixture-access',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const service=await createDesktopService({root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'ag.db'),token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}}});
 try{
  await service.proxy.start();await service.app.listen({host:'127.0.0.1',port:0});const now=new Date().toISOString();
  const rows=provider==='codex'?[{type:'session_meta',payload:{id:'native-thread',model_provider:'openai',creator_account_id:account}},{type:'turn_context',payload:{model:'gpt-test'}},{type:'token_usage_record',timestamp:now,payload:{response_id:'native-response',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}}]:[{type:'assistant',timestamp:now,sessionId:'native-thread',message:{id:'native-response',model:'claude-sonnet-4-6',usage:{input_tokens:40,cache_read_input_tokens:60,output_tokens:20}}}];
  await writeFile(join(root,provider,provider==='codex'?'sessions':'projects','native.jsonl'),rows.map(r=>JSON.stringify(r)).join('\n'));
  const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};let overview:any;
  await expect.poll(async()=>{overview=(await service.app.inject({url:'/api/usage/overview?days=0',headers})).json();return overview.nativeRows.length;},{timeout:5000}).toBe(1);
  const source=service.proxy.snapshot().accounts.find(a=>a.provider===provider)!;
  expect(overview.nativeRows[0]).toMatchObject({sourceId:inPool?source.id:'',inputTokens:100,outputTokens:20,channel:'official',nativeAccountEvidence:'login-snapshot',nativeAccountLabel:email});
  expect(overview.allRows[0]).toMatchObject({nativeAccountLabel:email,inputTokens:100,outputTokens:20});
  const activity=(await service.app.inject({url:'/api/activity/traces?days=0',headers})).json().records;expect(activity[0].accountLabel).toBe(email);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
