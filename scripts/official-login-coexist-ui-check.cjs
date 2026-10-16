/** Built UI with isolated fixtures. No real client configuration or credentials are read. */
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');

async function main(){
 app.on('window-all-closed',()=>{});const root=await mkdtemp(join(tmpdir(),'tf-official-coexist-'));app.setPath('userData',root);await app.whenReady();app.dock?.hide();
 let unpooled=false;
 const providers=['codex','workbuddy','workbuddy-ai','qoder'];
 const accounts=providers.map((provider,i)=>({id:String(i+1).repeat(24),provider:provider==='workbuddy-ai'?'workbuddy':provider,label:`${provider}@example.test`,status:'active',models:[provider==='workbuddy-ai'?'workbuddy/test':`${provider}/test`]}));
 const status=provider=>{const i=providers.indexOf(provider),domain=provider==='workbuddy'?'copilot.tencent.com':provider==='workbuddy-ai'?'www.workbuddy.ai':undefined;return {revision:'1'.repeat(64),loginState:'signed-in',accountId:provider,email:`${provider}@example.test`,domain,pids:[],backup:null,gatewayConnected:true,accounts:unpooled?[]:[{id:accounts[i].id,accountId:provider,email:`${provider}@example.test`,domain,switchable:true,reason:''}]};};
 const local={state:'running',port:8317,logs:[],accounts,models:accounts.flatMap(a=>a.models.map(id=>({id,provider:a.provider}))),quotas:{},quotaBusy:false,providers:[],loginState:'idle'};
 const targets=['codex','workbuddy','qoder'].map(id=>({id,name:id==='codex'?'Codex':id==='qoder'?'Qoder':'WorkBuddy',installation:{installed:true,version:'fixture'},exists:true,revision:'1'.repeat(64),pids:[],configurationState:'configured',backups:[],connection:{id:'11111111-1111-4111-8111-111111111111',target:id,sourceId:accounts[0].id,model:'codex/test',selections:[{sourceId:accounts[0].id,model:'codex/test'}],state:'applied'}}));
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   const provider=path==='/api/codex-accounts'?'codex':path.split('/').pop();
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets}:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?providers.includes(provider)?status(provider):{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:path==='/api/activity/traces'?{records:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=()=>new Promise(r=>setTimeout(r,60));
 const wait=async code=>{for(let i=0;i<100;i++){if(await evaluate(code))return;await pause();}throw Error('UI timeout: '+code);};
 const choose=async name=>{const index=['Codex','WorkBuddy','Qoder'].indexOf(name);await evaluate(`document.querySelectorAll('.tfTile')[${index}].click()`);await pause();};
 const selected=()=>evaluate('!!document.querySelector(".tfOfficialAccounts .tfLoginRadio.on")');
 const test=async()=>{
  await wait('!!document.querySelector(".tfTile")');
  await choose('WorkBuddy');await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="WorkBuddy")?.click()');await wait('!!document.querySelector(".tfOfficialAccounts .tfLoginRadio")');assert.equal(await selected(),true,'WorkBuddy official login stays selected with custom models');
  assert.equal(await evaluate('document.querySelector(".tfOfficialAccounts .tfUsing")?.textContent'),'已登录');
  await evaluate('[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="WorkBuddyAI")?.click()');await pause();await wait('!!document.querySelector(".tfWorkBuddyPanel .tfLoginRadio")');assert.equal(await selected(),true,'WorkBuddyAI official login stays selected');
  await choose('Qoder');await wait('!!document.querySelector(".tfOfficialAccounts .tfLoginRadio")');assert.equal(await selected(),true,'Qoder official login stays selected with a custom provider');
  await choose('Codex');await wait('!!document.querySelector(".tfOfficialAccounts .tfLoginRadio")');assert.equal(await selected(),false,'Codex API routing remains exclusive with the official mode');
 };
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await test();console.log('PASS pooled official accounts coexist for WorkBuddy, WorkBuddyAI and Qoder; Codex mode remains exclusive');
  unpooled=true;await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.reload();});await test();console.log('PASS unpooled native identities use the same coexistence rule');
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
