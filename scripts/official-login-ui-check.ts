import {createSecrets} from '../apps/desktop/src/secrets.js';
/** Isolated Electron UI smoke: fixture credentials and lifecycle, never the user's apps. */
import {app,BrowserWindow,session} from 'electron';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopService} from '../packages/core/src/service.js';
void main();
async function main(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'official-login-ui-'));
 app.setPath('userData',join(root,'electron'));await app.whenReady();app.dock?.hide();
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});await mkdir(join(root,'native'));
 const entries=[{name:'domestic.json',provider:'workbuddy',uid:'cn-user',email:'domestic@example.test',domain:'www.codebuddy.cn'},{name:'international.json',provider:'workbuddy',uid:'ai-user',email:'international@example.test',domain:'www.workbuddy.ai'},{name:'qoder.json',provider:'qoder',uid:'qoder-user',email:'qoder@example.test'},{name:'qoder-second.json',provider:'qoder',uid:'qoder-second',email:'second@example.test'}];
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(entries.map(a=>({...a,status:'active',models:['fixture']}))));
 for(const a of entries)await writeFile(join(root,'cliproxy/auth',a.name),JSON.stringify({...a,type:a.provider,access_token:'fixture-token',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const paths={workbuddy:join(root,'native/workbuddy-desktop.info'),'workbuddy-ai':join(root,'native/workbuddy-desktop-ai.info'),qoder:join(root,'native/auth.v1.dat')};
 const original={workbuddy:JSON.stringify({account:{uid:'local-cn',nickname:'Local Domestic'},auth:{domain:'copilot.tencent.com'}}),'workbuddy-ai':JSON.stringify({account:{uid:'local-ai',nickname:'Local International'},auth:{domain:'www.workbuddy.ai'}}),qoder:JSON.stringify({schemaVersion:1,user:{id:'local-qoder',email:'qoder-local@example.test'},token:'original-token'})};
 for(const key of Object.keys(paths) as (keyof typeof paths)[])await writeFile(paths[key],original[key]);
 const idePath=join(root,'native/ide.vscdb'),ideDB=new DatabaseSync(idePath);ideDB.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value TEXT)');ideDB.prepare('INSERT INTO ItemTable VALUES (?,?)').run('secret://aicoding.auth.userInfo',JSON.stringify(Buffer.from(JSON.stringify({id:'qoder-user',email:'qoder@example.test',token:'fixture-ide-token'}))));ideDB.close();const ideBefore=await readFile(idePath);
 await mkdir(join(root,'secrets'));
 const secrets=createSecrets(root,{isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from('fixture:'+value),decryptString:data=>{if(!data.toString().startsWith('fixture:'))throw Error('Unreadable fixture');return data.toString().slice(8);}}),changes:string[]=[];let allowDecrypt=false;
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'fixture-admin',localKey:'fixture-key',uiRoot:resolve('dist/console'),agentPaths:{qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/cordis.patch.yml')},agentProcesses:async()=>[],desktopProcesses:async()=>[],nativeProcesses:async()=>[],antigravityPath:join(root,'antigravity.db'),claudeCredentialStore:null,qoderIde:{path:idePath,platform:'darwin',crypto:async(op,value)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString(),fetch:async()=>new Response(JSON.stringify({id:'qoder-second',email:'second@example.test',whitelistStatus:'PASS'}))},secrets,desktopAccountChange:async(target,work)=>{await work();changes.push(target);},desktopAccounts:{platform:'darwin',paths,crypto:async(op,value)=>{if(op==='decrypt'&&!allowDecrypt)throw Error('Fixture keychain locked');return op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString();},fetch:async url=>new Response(JSON.stringify({id:'qoder-user',email:'qoder@example.test',data:{accounts:[{uid:String(url).includes('www.workbuddy.ai')?'ai-user':'cn-user',type:'personal',pluginEnabled:true,nickname:'Pooled WorkBuddy'}]}}))}});
 let legacyBackend=false;service.app.addHook('onRequest',async(req,reply)=>{if(legacyBackend&&req.url.startsWith('/api/native-accounts/workbuddy-ai'))return reply.code(400).send({error:'[{"code":"invalid_enum_value","received":"workbuddy-ai"}]'});});
 let win:BrowserWindow|undefined;
 try{
  await service.proxy.start();const address=await service.app.listen({host:'127.0.0.1',port:0});await session.defaultSession.cookies.set({url:address,name:'agent_session',value:'fixture-admin',httpOnly:true,sameSite:'strict'});
  win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await win.loadURL(address);
  const evaluate=(code:string)=>win!.webContents.executeJavaScript(code);
  const wait=async(code:string)=>{for(let n=0;n<120;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI condition timeout: '+code);};
  let confirmationCount=0;
  const click=async(selector:string,text:string)=>{if(selector==='dialog[open] button'){await wait('!!document.querySelector("dialog[open]")');const geometry=await evaluate('(()=>{const d=document.querySelector("dialog[open]"),r=d.getBoundingClientRect();return {compact:d.classList.contains("tfRestartDialog"),width:r.width,height:r.height,centerX:r.x+r.width/2,centerY:r.y+r.height/2,vw:innerWidth,vh:innerHeight};})()');if(!geometry.compact||geometry.width>460||geometry.height>geometry.vh-60||Math.abs(geometry.centerX-geometry.vw/2)>2||Math.abs(geometry.centerY-geometry.vh/2)>2)throw Error('Official confirmation must reuse centered Codex dialog: '+JSON.stringify(geometry));await screenshot('confirm-'+(++confirmationCount)+'.png');}
   const expression='[...document.querySelectorAll('+JSON.stringify(selector)+')].find(e=>e.textContent.trim()==='+JSON.stringify(text)+'&&!e.disabled)';await wait('!!('+expression+')');await evaluate('('+expression+').click()');await new Promise(r=>setTimeout(r,100));};
  const has=(text:string)=>'document.body.innerText.includes('+JSON.stringify(text)+')';
  const screenshot=async(name:string)=>{await new Promise(r=>setTimeout(r,350));const out=resolve('release/login-dialog-fix-test/ui-check');await mkdir(out,{recursive:true});await writeFile(join(out,name),(await win!.webContents.capturePage()).toPNG());};
  const tile=async(name:string)=>{const expr='[...document.querySelectorAll(".tfTile")].find(e=>e.querySelector("strong")?.textContent==='+JSON.stringify(name)+')';await wait('!!('+expr+')');await evaluate('('+expr+').click()');};
  const product=async(name:string)=>click('[aria-label="账号客户端"] button',name);
  const provider=async(name:string)=>click('.tfProviderTabs button',name);
  const native=(name:string)=>'[...document.querySelectorAll(".tfNativeAccountChip,.tfAccountTabs button,.tfLines li")].some(e=>e.querySelector(".tfUsing")&&e.textContent.includes('+JSON.stringify(name)+'))';
  const selected=(name:string)=>'document.querySelector(".tfAccountTabs [aria-selected=true]")?.textContent.includes('+JSON.stringify(name)+')';
  await evaluate('window.desktop={platform:"darwin"}');
  await click('nav button','账号授权');await provider('WorkBuddy');await wait(native('Local Domestic'));await wait('document.querySelectorAll(".tfAccountTabs button").length===1');await wait(selected('domestic@example.test'));
  if(await evaluate(has('Local International')+'||'+has('无需本机客户端登录')))throw Error('Unselected client or repeated explanation visible');
  await product('WorkBuddyAI');await wait(native('Local International'));await wait(selected('international@example.test'));await wait('[...document.querySelectorAll("button")].some(e=>e.getAttribute("aria-label")==="添加 WorkBuddyAI 账号")');
  await screenshot('workbuddyai-accounts.png');
  await product('WorkBuddy');await click('button','切换到此账号');await click('dialog[open] button','取消');await wait('!document.querySelector("dialog[open]")');if(changes.length)throw Error('Cancel changed native login');
  await click('button','切换到此账号');await click('dialog[open] button','切换并重新打开');await wait('!!document.querySelector(".tfAccountTabs .tfUsing")');await screenshot('workbuddy-accounts.png');
  const cn=JSON.parse(await readFile(paths.workbuddy,'utf8'));cn.auth.domain='copilot.tencent.com';await writeFile(paths.workbuddy,JSON.stringify(cn));await click('button[aria-label="刷新 WorkBuddy 本机登录"]','');await wait(native('domestic@example.test'));
  if(await evaluate('!!document.querySelector(".tfNativeAccountChip")||!!document.querySelector(".tfNativeIdentity")'))throw Error('Duplicate native identity row');

  await click('nav button','本地 Agent');await tile('WorkBuddy');await wait('!!document.querySelector("section[aria-label=官方登录账号] .tfUsing")');
  if(await evaluate('[...document.querySelectorAll(".tfTile strong")].some(e=>["Qoder IDE","WorkBuddyAI"].includes(e.textContent))'))throw Error('Extra product tile visible');
  await click('button','恢复原登录');await click('dialog[open] button','恢复并重新打开');await wait(native('Local Domestic'));
  await click('[aria-label="WorkBuddy 客户端"] button','WorkBuddyAI');await wait(native('Local International'));await wait('!!document.querySelector("button.tfLineMain:not(:disabled)")');await evaluate('document.querySelector("button.tfLineMain:not(:disabled)").click()');await click('dialog[open] button','切换并重新打开');await wait(native('international@example.test'));await screenshot('workbuddyai-local-agent.png');
  await click('[aria-label="WorkBuddy 客户端"] button','WorkBuddy');await wait(native('Local Domestic'));await screenshot('workbuddy-local-agent.png');
  await click('nav button','账号授权');await provider('WorkBuddy');await product('WorkBuddyAI');await wait(native('international@example.test'));await click('button','恢复原登录');await click('dialog[open] button','恢复并重新打开');await wait(native('Local International'));
  legacyBackend=true;await click('button[aria-label="刷新 WorkBuddyAI 本机登录"]','');await wait(has('请重新打开新版 TokenFlow'));if(await evaluate(has('invalid_enum_value')))throw Error('Raw validation error visible');await wait(selected('international@example.test'));legacyBackend=false;await click('button[aria-label="刷新 WorkBuddyAI 本机登录"]','');await wait(native('Local International'));
  await evaluate('window.desktop={platform:"win32"}');
  await provider('Qoder');await wait(has('暂时无法读取本机登录'));await wait('document.querySelectorAll(".tfAccountTabs button").length===2');await wait('!!document.querySelector(".tfModelsSide li")');allowDecrypt=true;await click('button[aria-label="刷新 Qoder 本机登录"]','');await wait(native('qoder-local@example.test'));await screenshot('qoder-accounts.png');
  await click('button','切换到此账号');await click('dialog[open] button','切换并重新打开');await wait('!!document.querySelector(".tfAccountTabs .tfUsing")');
  await click('nav button','本地 Agent');await tile('Qoder 独立版');await wait('!!document.querySelector("section[aria-label=官方登录账号] .tfUsing")');await click('button','恢复原登录');await click('dialog[open] button','恢复并重新打开');await wait(native('qoder-local@example.test'));
  if(!(await readFile(idePath)).equals(ideBefore))throw Error('Standalone switching changed IDE database');
  await click('nav button','账号授权');await provider('Qoder');await product('Qoder IDE');await wait(native('qoder@example.test'));await wait(selected('qoder@example.test'));await screenshot('qoder-ide-accounts.png');
  await click('.tfAccountTabs button','second@example.test');await click('button','切换到此账号');await click('dialog[open] button','取消');await wait('!document.querySelector("dialog[open]")');if(changes.includes('qoder-ide'))throw Error('Cancel switched IDE');
  await click('button','切换到此账号');await click('dialog[open] button','切换并重新打开');await wait(native('second@example.test'));await screenshot('qoder-ide-switched.png');
  await click('nav button','本地 Agent');await click('nav button','账号授权');await product('Qoder IDE');await wait(selected('second@example.test'));
  await click('button','恢复原登录');await click('dialog[open] button','恢复并重新打开');await wait(native('qoder@example.test'));
  win.setSize(900,760);await screenshot('qoder-ide-narrow.png');
  await evaluate('document.documentElement.dataset.theme="light"');await screenshot('qoder-ide-light.png');
  const finalDB=new DatabaseSync(idePath,{readOnly:true});try{const row=finalDB.prepare('SELECT value FROM ItemTable WHERE key=?').get('secret://aicoding.auth.userInfo');if(JSON.parse(Buffer.from(JSON.parse(String(row!.value)).data).toString()).token!=='fixture-ide-token')throw Error('IDE original login not restored');}finally{finalDB.close();}
  if(JSON.stringify(changes)!==JSON.stringify(['workbuddy','workbuddy','workbuddy-ai','workbuddy-ai','qoder','qoder','qoder-ide','qoder-ide']))throw Error('Unexpected fixture lifecycle: '+changes);
  for(const key of Object.keys(paths) as (keyof typeof paths)[])if(await readFile(paths[key],'utf8')!==original[key])throw Error(key+' original login changed');
  console.log('PASS: existing unpooled login detection, independent authorization, explicit retry, both WorkBuddy editions and standalone Qoder switch/restore, product-specific account filters, grouped WorkBuddy local Agent, no IDE Agent, IDE switch/restore, native account selected by default, concise old-backend error, cancel and exact original recovery.');
 }catch(error){console.error(error instanceof Error?error.message:'UI check failed');console.error('fixture changes',changes);console.error(await win?.webContents.executeJavaScript('document.querySelector(".tfProviderPanel")?.innerText??"no provider panel"'));
  if(win){const out=resolve('release/login-dialog-fix-test/ui-check');await mkdir(out,{recursive:true});await writeFile(join(out,'failure.png'),(await win.webContents.capturePage()).toPNG());}console.error(await win?.webContents.executeJavaScript('document.querySelector("dialog[open]")?.textContent??"no open dialog"'));process.exitCode=1;}
 finally{win?.destroy();await service.app.close();await rm(root,{recursive:true,force:true});app.exit(process.exitCode??0);}
}

