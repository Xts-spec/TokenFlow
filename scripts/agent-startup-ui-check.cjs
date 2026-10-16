/** Run after the console build with Electron. All API data is isolated fixtures. */
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');

async function main(){
 app.on('window-all-closed',()=>{});
 const root=await mkdtemp(join(tmpdir(),'tokenflow-startup-'));
 app.setPath('userData',root);await app.whenReady();app.dock?.hide();
 const counts={};let fail=false;
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[],models:[{id:'codex/test',provider:'codex'}],quotas:{},quotaBusy:false,providers:[]};
 const target={id:'codex',name:'Codex',installation:{installed:true,version:'1.0'},exists:true,revision:'fixture',pids:[],connection:null,configurationState:'unmanaged',backups:[]};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   counts[path]=(counts[path]??0)+1;res.setHeader('Content-Type','application/json');
   if(fail&&['/api/a2a','/api/local-agent'].includes(path)){res.statusCode=503;res.end(JSON.stringify({error:'fixture offline'}));return;}
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[target]}:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:path==='/api/activity/traces'?{records:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<100;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 const click=async text=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)})?.click()`);await pause(150);};
 const errors=[];const check=(label,fn)=>{try{fn();console.log('PASS '+label);}catch(e){errors.push(label+': '+e.message);console.error('FAIL '+label+': '+e.message);}};
 const reads=()=>Object.fromEntries(Object.entries(counts).filter(([p])=>['/api/local-agent','/api/a2a','/api/a2a/program-updates','/api/codex-accounts'].includes(p)||p.startsWith('/api/native-accounts/')));
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait('!!document.querySelector(".tfAgentTitle")');await pause(200);
  const startup=reads();await pause(5500);
  await evaluate('window.dispatchEvent(new Event("focus"));document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("online"))');await pause(200);
  check('idle, focus and reconnect do not reread local data',()=>assert.deepEqual(reads(),startup));
  const beforeNavigation=reads();await click('设置');await click('本地 Agent');await wait('!!document.querySelector(".tfAgentTitle")');
  check('navigation reuses startup data',()=>assert.deepEqual(reads(),beforeNavigation));
  const beforeAccounts=reads();await click('账号授权');await pause(200);await click('本地 Agent');await wait('!!document.querySelector(".tfAgentTitle")');
  check('account page shares native login reads',()=>{for(const [path,count]of Object.entries(beforeAccounts))assert.equal(counts[path],count,path);});
  const beforeActivity=reads();await click('活动');await pause(4500);await click('本地 Agent');await wait('!!document.querySelector(".tfAgentTitle")');
  check('activity page reuses the Agent snapshot',()=>assert.deepEqual(reads(),beforeActivity));
  fail=true;win.reload();await wait('!!document.querySelector(".tfLoadError")');await pause(200);
  const feedback=await evaluate('({middle:document.querySelectorAll(".tfAgentsPage .tfLoadError").length,top:document.querySelectorAll(".tfRequestStatus .tfLoadError").length,toast:document.querySelectorAll(".tfToast.error").length,text:document.querySelector(".tfAgentsPage .tfLoadError")?.textContent})');
  check('failure stays in the Agent page',()=>{assert.equal(feedback.middle,1);assert.equal(feedback.top,0);assert.equal(feedback.toast,0);assert.match(feedback.text,/暂时无法读取本机 Agent/);});
  const failedReads=reads();await pause(4500);
  check('failed startup waits for manual retry',()=>assert.deepEqual(reads(),failedReads));
  await click('重新加载');
  check('retry reloads both failed sources once',()=>{assert.equal(counts['/api/local-agent'],failedReads['/api/local-agent']+1);assert.equal(counts['/api/a2a'],failedReads['/api/a2a']+1);});
  fail=false;await click('重新加载');await wait('!!document.querySelector(".tfAgentTitle")');
  const remainingErrors=await evaluate('document.querySelectorAll(".tfLoadError").length');
  check('retry recovers and clears the message',()=>assert.equal(remainingErrors,0));
  const beforeRestart=reads();win.reload();await wait('!!document.querySelector(".tfAgentTitle")');await pause(200);
  check('new app session reads again',()=>{for(const path of Object.keys(startup))assert.equal(counts[path],beforeRestart[path]+1,path);});
  if(errors.length)throw Error(errors.join('\n'));
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
