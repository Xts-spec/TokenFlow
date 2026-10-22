// Run after npm run build: npx electron scripts/qoder-usage-ui-check.cjs
// Isolated fixtures only; no real account credentials or provider requests.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdir,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-qoder-ui-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 const day=new Date().toLocaleDateString('en-CA'),last=new Date().toISOString();
 const base={day,last,keyId:'native',keyName:'官方登录',sourceId:'account',provider:'qoder',origin:'native',channel:'official',requests:1,failed:0,unmeasured:0,inputTokens:100,cachedTokens:60,cacheBaseTokens:100,outputTokens:20,durationMs:0};
 const rows=[{...base,target:'qoder-ide',model:'qoder/dfmodel'},{...base,target:'qoder',model:'qoder/kmodel_latest',inputTokens:0,outputTokens:0,cachedTokens:0,cacheBaseTokens:0,unmeasured:1,credits:0.16},{...base,target:'qoder-ide',model:'company-model',sourceId:'',channel:'api',inputTokens:30,outputTokens:10,cachedTokens:0,cacheBaseTokens:0}];
 const account={id:'account',provider:'qoder',label:'fixture@example.test',status:'active',disabled:false,models:['qoder/dfmodel'],nativeClients:['qoder','qoder-ide']};
 const grant={id:'grant-one',source:'Qoder',status:'usable',preferred:true,refreshedAt:'2026-10-21T00:00:00Z',expiresAt:'2035-01-01T00:00:00Z'};account.credentialCount=2;account.authorizations=[grant,{...grant,id:'grant-two',source:'Qoder IDE',preferred:false,status:'expired',refreshedAt:undefined,expiresAt:'2025-01-01T00:00:00Z'}];
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[account],models:[{id:'qoder/dfmodel',provider:'qoder',displayName:'DeepSeek V4 Flash'}],quotas:{},quotaBusy:false,providers:[{id:'qoder',label:'Qoder',flow:'callback',hint:'fixture'}]};
 const target={id:'qoder',name:'Qoder',installation:{installed:true,version:'1.0'},exists:true,revision:'fixture',pids:[],connection:null,configurationState:'unmanaged',backups:[]};
 const coverage=['qoder','qoder-ide'].map(target=>({target,status:'ready',files:1,indexed:1,skipped:0}));
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[target]}:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/codex-accounts'||path.includes('accounts/')?{revision:'fixture',accounts:[{id:'account',accountId:'uid',email:account.label,switchable:true}],accountId:'uid',email:account.label,loginState:'signed-in',pids:[],backup:null,gatewayConnected:false}:path==='/api/usage/overview'?{rows:[],nativeRows:rows,combinedRows:rows,allRows:rows,coverage,scanning:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code).catch(error=>{throw Error(code+': '+error.message);}),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<100;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 const click=async(text,selector='button')=>{const code=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)})`;await wait(`!!(${code})`);await evaluate(`(${code}).click()`);await pause(100);};
 const screenshot=async name=>{const directory=resolve('release/qoder-usage-test');await mkdir(directory,{recursive:true});await writeFile(join(directory,name),(await win.webContents.capturePage()).toPNG());};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await wait('!!document.querySelector(".tfAgentTitle") && !!document.querySelector(".tfUsageFoldHead")');
  assert.match(await evaluate('document.querySelector(".tfUsageFoldHead").innerText'),/未提供/);assert.doesNotMatch(await evaluate('document.querySelector(".tfUsageFoldHead").innerText'),/Credits/);
  await evaluate('document.querySelector(".tfUsageFoldHead").click()');await wait('!!document.querySelector(".tfUsagePopover")');
  assert.match(await evaluate('document.querySelector(".tfUsagePopover").innerText'),/Credits 消耗/);
  await evaluate('document.querySelector(".tfUsagePopover .iconButton").click()');
  await click('Qoder IDE');await wait('document.querySelector(".tfAgentTitle h2")?.textContent==="Qoder IDE"');
  assert.match(await evaluate('document.querySelector(".tfUsageFoldHead").innerText'),/160/);
  assert.match(await evaluate('document.querySelector(".tfPanel").innerText'),/company-model/);await screenshot('qoder-ide.png');
  await click('账号授权');await wait('!!document.querySelector(".tfProviderHead")');
  await click('授权明细（2 份）','summary');assert.match(await evaluate('document.querySelector(".tfAccountDetail").innerText'),/默认优先.*模型已验证/s);assert.match(await evaluate('document.querySelector(".tfAccountDetail").innerText'),/Qoder IDE.*已过期/s);assert.match(await evaluate('document.querySelector(".tfAccountDetail").innerText'),/授权时间：未知/);
  assert.match(await evaluate('document.querySelector(".tfAccountsPage .tfUsageFold").innerText'),/120/);
  assert.doesNotMatch(await evaluate('document.querySelector(".tfAccountsPage .tfUsageFold").innerText'),/Credits/);
  await evaluate('document.querySelector(".tfAccountsPage .tfUsageFoldHead").click()');await wait('!!document.querySelector(".tfUsagePopover")');
  assert.equal(await evaluate('document.querySelector(".tfAccountsPage").innerText.includes("company-model")'),false);await evaluate('document.querySelector(".tfUsagePopover .iconButton").click()');await wait('!document.querySelector(".tfUsagePopover")');await screenshot('qoder-account.png');
  await click('本地 Agent');await click('Qoder IDE');await win.setSize(760,1000);await pause(100);
  assert.equal(await evaluate('document.documentElement.scrollWidth>window.innerWidth'),false);await screenshot('qoder-ide-narrow.png');
  console.log('PASS: Qoder and IDE account totals combine; custom API is Agent-only; Token style retained; Credits confined to expanded details; desktop/narrow layout checked.');
 }catch(error){console.error(error);process.exitCode=1;}
 finally{win.destroy();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});app.exit(process.exitCode??0);}
})();
