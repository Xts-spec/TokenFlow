// Run after npm run build: npx electron scripts/account-startup-ui-check.cjs
// Delayed fixture data only; never reads real credentials or contacts provider services.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-account-startup-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 let reads=0,mutations=0;const since=Date.now();
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[],models:[],quotas:{},quotaBusy:false,providers:[{id:'codex',label:'Codex',flow:'callback',hint:'fixture'}],accountsLoading:true};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');if(req.method==='POST')mutations++;
   if(path==='/api/local-agent'){
    reads++;
    if(Date.now()-since>1200){local.accountsLoading=false;local.accounts=[{id:'fixture-account',provider:'codex',label:'startup-fixture@example.test',status:'active',disabled:false,unavailable:false,models:['codex/fixture-model']}];local.models=[{id:'codex/fixture-model',provider:'codex'}];local.quotas={'fixture-account':{status:'ok',observedAt:new Date().toISOString(),windows:[{id:'weekly',label:'每周额度',usedPercent:25}]}};}
    res.end(JSON.stringify(local));return;
   }
   const value=path==='/api/a2a'?{targets:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<150;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Account startup UI did not update automatically');};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await wait("!![...document.querySelectorAll('button')].find(b=>b.textContent==='账号授权')");
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='账号授权').click()");
  await wait("!!document.getElementById('provider-panel-codex')");
  assert.equal(await evaluate("document.body.innerText.includes('还没有 Codex 账号')"),false,'Must not show an empty account state while startup discovery is still pending');
  assert.equal(await evaluate("!!document.querySelector('[aria-label=\"正在加载已保存的账号\"]')"),true);
  await wait("!!document.querySelector('[id=account-tab-fixture-account]')");
  assert.equal(await evaluate("!!document.querySelector('.tfAccountManage .tfNativeRefresh')"),false,'Duplicate native-login refresh button must be removed');
  assert.equal(await evaluate("!!document.querySelector('.tfNativeLogin .tfNativeRefresh')"),false);
  assert.equal(await evaluate("!!document.querySelector('.tfProviderRefresh')"),true);
  assert.equal(await evaluate("document.body.innerText.includes('剩余 75%')"),true);
  assert.ok(reads>=2);assert.equal(mutations,0,'Automatic startup polling must not trigger manual refresh mutations');
  const settledReads=reads;await new Promise(r=>setTimeout(r,1900));assert.equal(reads,settledReads,'Polling stops after discovery completes');
  console.log('PASS: delayed accounts load automatically, loading stays distinct from empty, duplicate refresh removed, top refresh retained, and polling stops');
 }finally{win.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
 app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
