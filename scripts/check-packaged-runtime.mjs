// Run with the packaged Electron executable and ELECTRON_RUN_AS_NODE=1.
// All service data/configuration lives in a disposable directory; no real account is used.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
import {DatabaseSync} from 'node:sqlite';

const archive=resolve(process.argv[2]),fixture=resolve(process.argv[3]);
assert.ok(process.versions.electron,'Use the packaged Electron runtime');
const root=await mkdtemp(join(await realpath(tmpdir()),'tokenflow-packaged-check-'));
const req=createRequire(join(archive,'package.json'));
let service;
try{
 for(const pkg of ['react','react-dom','openai','@earendil-works/pi-ai','esbuild','playwright','puppeteer']){
  await assert.rejects(readFile(join(archive,'node_modules',pkg,'package.json')));
 }
 assert.ok((await readFile(join(archive,'dist/bundled-dependencies.LICENSE.txt'),'utf8')).includes('pi-ai'));
 const cursor=await import(pathToFileURL(join(archive,'node_modules/@cursor/sdk/dist/esm/index.js')).href);
 assert.ok(cursor.Agent,'Cursor SDK loads its native runtime');
 const sdk=await import(pathToFileURL(req.resolve('@token-flow/codebuddy-runtime')).href);
 assert.equal(typeof sdk.runOfficialSDK,'function');
 let createDesktopService;
 for(const file of await readdir(join(archive,'dist'))){
  if(!/^chunk-.*\.js$/.test(file))continue;
  const loaded=await import(pathToFileURL(join(archive,'dist',file)).href);
  if(loaded.createDesktopService)createDesktopService=loaded.createDesktopService;
 }
 assert.equal(typeof createDesktopService,'function');
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 await mkdir(join(root,'cliproxy'),{recursive:true});
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'qoder.json',provider:'qoder',status:'active',models:['kmodel_latest']}]));
 const paths=Object.fromEntries(['codex','claude','qoder','workbuddy','deepseek','pi'].map(t=>[t,join(root,t,t==='codex'?'config.toml':'settings.json')]));
 await mkdir(join(root,'codex/sessions'),{recursive:true});
 await mkdir(join(root,'claude/projects'),{recursive:true});
 await writeFile(paths.claude,'{}');
 await writeFile(join(root,'claude/.credentials.json'),JSON.stringify({claudeAiOauth:{accessToken:'fixture-claude-token'}}));
 await writeFile(join(root,'claude/.claude.json'),JSON.stringify({oauthAccount:{accountUuid:'fixture-claude-account',organizationUuid:'fixture-org',emailAddress:'claude-native@example.test'}}));
 await writeFile(join(root,'codex/sessions/fixture.jsonl'),[
  {type:'session_meta',payload:{id:'isolated-thread',model_provider:'openai'}},
  {type:'turn_context',payload:{model:'isolated-native-model'}},
  {type:'token_usage_record',timestamp:new Date().toISOString(),payload:{response_id:'isolated-response',usage:{input_tokens:100,cached_input_tokens:50,output_tokens:20}}},
 ].map(row=>JSON.stringify(row)).join('\n'));
 const loginPaths=Object.fromEntries(['workbuddy','workbuddy-ai','qoder'].map(provider=>[provider,join(root,'native',provider+'.json')]));await mkdir(join(root,'native'));
 for(const provider of ['workbuddy','workbuddy-ai'])await writeFile(loginPaths[provider],JSON.stringify({account:{uid:provider+'-native',nickname:provider+' native'},auth:{domain:provider==='workbuddy-ai'?'www.workbuddy.ai':'copilot.tencent.com'}}));
 await writeFile(loginPaths.qoder,JSON.stringify({schemaVersion:1,user:{id:'qoder-native',email:'qoder-native@example.test'}}));
 const idePath=join(root,'native/ide.vscdb'),ideDB=new DatabaseSync(idePath);ideDB.exec('CREATE TABLE ItemTable(key TEXT PRIMARY KEY,value TEXT)');ideDB.prepare('INSERT INTO ItemTable VALUES (?,?)').run('secret://aicoding.auth.userInfo',JSON.stringify(Buffer.from(JSON.stringify({id:'qoder-ide-native',email:'ide-native@example.test',token:'fixture-ide-token'}))));ideDB.close();
 const {createSecrets}=await import(pathToFileURL(join(archive,'dist/credential-store.js')).href);await mkdir(join(root,'secrets'),{recursive:true});const secrets=createSecrets(root,{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('fixture:'+value),decryptString:data=>{assert.ok(data.toString().startsWith('fixture:'));return data.toString().slice(8);}});await mkdir(join(root,'cliproxy/auth'),{recursive:true});await writeFile(join(root,'cliproxy/auth/qoder.json'),JSON.stringify({type:'qoder',uid:'fixture-selected-ide',access_token:'fixture-selected-token',refresh_token:'fixture-selected-refresh',expired:'2035-01-01T00:00:00Z'}));
 service=await createDesktopService({root,binary:fixture,token:'fixture-admin',localKey:'fixture-internal',proxyPort:port,agentPaths:paths,agentProcesses:async()=>[],desktopProcesses:async()=>[],desktopAccounts:{paths:loginPaths,crypto:async(op,value)=>op==='decrypt'?Buffer.from(value,'base64').toString():Buffer.from(value).toString('base64')},qoderIde:{path:idePath,crypto:async(op,value)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString(),fetch:async()=>new Response(JSON.stringify({id:'fixture-selected-ide',email:'selected@example.test',whitelistStatus:'PASS'}))},desktopAccountChange:async(target,work)=>{assert.equal(target,'qoder-ide');await work();},nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'antigravity'),secrets,uiRoot:join(archive,'dist/console')});
 await writeFile(join(root,'claude/projects/fixture.jsonl'),JSON.stringify({type:'assistant',timestamp:new Date().toISOString(),message:{id:'fixture-claude-response',model:'claude-sonnet-4-6',usage:{input_tokens:40,cache_read_input_tokens:60,output_tokens:20}}}));
 await service.proxy.start();
 const headers={host:'127.0.0.1:9527',authorization:'Bearer fixture-admin'};
 const request=async(url,method='GET',payload)=>{const response=await service.app.inject({url,method,headers,payload});assert.equal(response.statusCode,200,response.body);return response.json();};
 for(const provider of ['workbuddy','workbuddy-ai','qoder','qoder-ide']){const state=await request('/api/native-accounts/'+provider);assert.equal(state.accountId,provider+'-native');assert.equal(state.loginState,'signed-in');assert.equal(state.backup,null);}
 const ui=await service.app.inject({url:'/',headers});assert.equal(ui.statusCode,200);assert.match(ui.body,/<html/);
 const source=service.proxy.snapshot().accounts.find(a=>a.provider==='qoder');assert.ok(source);
 const standaloneBefore=await readFile(loginPaths.qoder),ideBefore=await request('/api/native-accounts/qoder-ide');const ideSwitched=await request('/api/native-accounts/qoder-ide/switch','POST',{sourceId:source.id,revision:ideBefore.revision});assert.equal(ideSwitched.accountId,'fixture-selected-ide');assert.equal(ideSwitched.backup.state,'applied');const ideRestored=await request('/api/native-accounts/qoder-ide/restore','POST',{revision:ideSwitched.revision});assert.equal(ideRestored.accountId,ideBefore.accountId);assert.equal(ideRestored.backup,null);assert.deepEqual(await readFile(loginPaths.qoder),standaloneBefore);
 const key=await request('/api/gateway-keys','POST',{name:'packaged check',sourceId:source.id,models:['qoder/kmodel_latest']});
 const response=await service.app.inject({url:'/v1/responses',method:'POST',headers:{...headers,authorization:`Bearer ${key.apiKey}`},payload:{model:'qoder/kmodel_latest',input:'OK'}});assert.equal(response.statusCode,200,response.body);
 await request('/api/maintenance','PUT',{sourceId:source.id,model:'qoder/kmodel_latest'});
 const until=async(check)=>{for(let i=0;i<100;i++){const value=await request('/api/maintenance');if(check(value))return value;await new Promise(r=>setTimeout(r,100));}throw Error('Maintenance timed out');};
 await until(value=>value.readiness.status==='ready');
 await request('/api/maintenance/run','POST',{prompt:'今天的模型速度',context:{page:'proxy',range:'today',keyId:key.key.id,origin:'gateway'}});
 const result=await until(value=>value.status==='completed');
 const preflight=result.messages.find(m=>m.text.startsWith('只读预检: '));assert.ok(preflight);
 const data=JSON.parse(preflight.text.slice(6));assert.equal(data.pageData.usage.requests,1);assert.equal(data.pageData.usage.models[0].tokensPerSecond,null);assert.ok(!preflight.text.includes(key.apiKey));
 let overview;for(let i=0;i<100;i++){overview=await request('/api/usage/overview?days=0');if(!overview.scanning)break;await new Promise(r=>setTimeout(r,100));}
 assert.ok(overview.nativeRows.some(row=>row.model==='isolated-native-model'&&row.inputTokens===100&&row.outputTokens===20),'Packaged worker must index the isolated native history');
 assert.ok(overview.nativeRows.some(row=>row.nativeAccountLabel==='claude-native@example.test'&&row.nativeAccountEvidence==='login-snapshot'&&row.inputTokens===100&&row.outputTokens===20),'Packaged worker must associate new Claude usage without switching or importing its account');
 console.log(JSON.stringify({passed:true,electron:process.versions.electron,platform:process.platform,arch:process.arch,checks:['production dependencies','bundled licenses','Cursor native SDK','WorkBuddy SDK import','static UI','Responses gateway','Pi repair conversation','selected usage evidence','local usage worker','Claude native account attribution','existing Qoder and both WorkBuddy edition identities','Qoder IDE switch, restore and standalone isolation']},null,2));
}finally{await service?.app.close();await rm(root,{recursive:true,force:true});}
