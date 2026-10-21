// Run after npm run build: npx electron scripts/claude-desktop-status-ui-check.cjs
// Fixture-only UI verification; never reads or changes a real client configuration.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm}=require('node:fs/promises');
const {resolve,join,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-desktop-status-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 let connected=true,cliSignedIn=false,fail=false;
 const choice={sourceId:'source',model:'claude/fixture'};
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[{id:'source',provider:'claude',label:'fixture@example.test',status:'active',disabled:false,unavailable:false,models:[choice.model]}],models:[{id:choice.model,provider:'claude'}],quotas:{},quotaBusy:false,providers:[]};
 const target={id:'claude',name:'Claude Code',installation:{installed:true,version:'1.0'},exists:true,revision:'fixture',pids:[],connection:null,configurationState:'unmanaged',backups:[]};
 const desktop=()=>({revision:'fixture',connected,mode:connected?'3p':'1p',backup:connected?{state:'applied'}:null,selections:connected?[choice]:[],unavailableReason:'',pids:[],automaticRestart:false,installation:{installed:true,version:'1.0'}});
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path==='/api/claude-desktop'&&fail){res.statusCode=503;res.end(JSON.stringify({error:'fixture unavailable'}));return;}
   if(path==='/api/claude-desktop/restore')connected=false;
   const value=path.startsWith('/api/claude-desktop')?desktop():path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[target]}:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/native-accounts/claude'?{revision:'fixture',accounts:[],pids:[],backup:null,loginState:cliSignedIn?'signed-in':'signed-out',...(cliSignedIn?{accountId:'cli-account',email:'cli@example.test'}:{})}:path.startsWith('/api/native-accounts/')||path==='/api/codex-accounts'?{revision:'fixture',accounts:[],pids:[],backup:null}:path==='/api/usage/overview'?{rows:[],combinedRows:[],allRows:[],nativeRows:[],coverage:[],scanning:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<160;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 const click=async text=>{await evaluate(`[...(document.querySelector("dialog[open]")??document).querySelectorAll("button")].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled).click()`);};
 const dot='document.querySelector(".tfTile .dot")';
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await evaluate('localStorage.setItem("token-flow.claude.client","desktop")');await win.reload();
  await wait('document.querySelector(".tfPanel [aria-label=\\"启用网关模型\\"]")?.checked===true');
  assert.equal(await evaluate(`${dot}.getAttribute("aria-label")`),'使用中');
  assert.equal(await evaluate(`${dot}.classList.contains("ok")`),true);
  await click('Claude CLI');await wait('!document.querySelector(".tfPanel[aria-label=\\"Claude Desktop\\"]")');
  assert.equal(await evaluate(`${dot}.getAttribute("aria-label")`),'未接入');
  await click('Claude Desktop');await wait('document.querySelector(".tfPanel [aria-label=\\"启用网关模型\\"]")?.checked===true');
  await click('切回官方');await click('切回官方');await wait(`${dot}.getAttribute("aria-label")==="未接入"`);
  cliSignedIn=true;await evaluate('window.dispatchEvent(new Event("tokenflow:native-login-changed"))');await pause(250);
  assert.equal(await evaluate(`${dot}.classList.contains("ok")`),false);
  await click('Claude CLI');await wait(`${dot}.getAttribute("aria-label")==="使用中"`);
  await click('Claude Desktop');await wait('!!document.querySelector(".tfPanel[aria-label=\\"Claude Desktop\\"]")');
  fail=true;await wait(`${dot}.getAttribute("aria-label")==="有问题"`);
  fail=false;connected=true;await click('重试');await wait(`${dot}.getAttribute("aria-label")==="使用中"`);
  console.log('PASS: desktop connection controls the dot; CLI state stays separate; restore, errors and retry update the shared status.');
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
})().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
