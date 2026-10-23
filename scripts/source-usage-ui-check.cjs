// npm run build && npx electron scripts/source-usage-ui-check.cjs
// Isolated account fixtures; no credentials or provider requests.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm,mkdir,writeFile}=require('node:fs/promises');
const {resolve,join,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-source-usage-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 const now=new Date(),day=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
 const account={id:'a'.repeat(24),provider:'qoder',label:'same-account@example.test',status:'active',disabled:false,unavailable:false,models:['qoder/model']};
 const base={day,last:now.toISOString(),target:'codex',keyId:'gateway',keyName:'Codex',sourceId:account.id,model:'qoder/model',origin:'gateway',channel:'official',provider:'qoder',requests:2,failed:1,unmeasured:0,inputTokens:100000,cachedTokens:60000,cacheBaseTokens:100000,outputTokens:20000,durationMs:100};
 const gateway=[base],native=[{...base,target:'qoder-ide',origin:'native',keyId:'native:uid',requests:3,failed:0,inputTokens:50000,cachedTokens:40000,cacheBaseTokens:50000,outputTokens:10000,nativeAccountId:'confirmed-uid',nativeAccountEvidence:'login-snapshot'},{...base,target:'qoder',origin:'native',sourceId:'',keyId:'native:other',nativeAccountId:'unlinked-uid',nativeAccountLabel:'Unlinked account',requests:1,failed:0,inputTokens:1000,cachedTokens:0,cacheBaseTokens:1000,outputTokens:0}];
 const all=[...gateway,...native];
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   const value=path==='/api/local-agent'?{state:'running',loginState:'idle',port:8317,logs:[],accounts:[account],models:[{id:'qoder/model',provider:'qoder'}],quotas:{},quotaBusy:false,providers:[{id:'qoder',label:'Qoder'}]}:path==='/api/a2a'?{targets:[]}:path==='/api/usage/overview'?{rows:gateway,nativeRows:native,combinedRows:all,allRows:all,coverage:[],scanning:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<160;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="用量总览")');
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="用量总览").click()');
  await wait('document.querySelector("button#overview-tab-agent")');await evaluate('document.querySelector("button#overview-tab-agent").click()');
  await wait('document.querySelectorAll(".tfBreakdown li").length===2');
  const same='[...document.querySelectorAll(".tfBreakdown li")].find(e=>e.querySelector("strong")?.textContent==="same-account@example.test")';
  assert.equal(await evaluate('document.querySelectorAll(".tfBreakdown li strong[title=\\"same-account@example.test\\"]").length'),1);
  assert.match(await evaluate(`${same}.querySelector('.tfBreakValue').innerText`),/18万/);
  await evaluate(`${same}.querySelector('.tfSourcePaths summary').click()`);
  assert.equal(await evaluate(`${same}.querySelector('.tfSourcePaths').open`),true);
  const paths=await evaluate(`${same}.querySelector('.tfSourcePaths').innerText`);
  assert.match(paths,/经 TokenFlow/);assert.match(paths,/本机直连/);assert.match(paths,/12万 Token/);assert.match(paths,/6万 Token/);assert.match(paths,/2 次请求 · 1 次失败/);assert.match(paths,/3 次请求/);
  assert.match(await evaluate(`${same}.querySelector('.tfBreakFacts').innerText`),/5 次请求/);
  for(const [width,height] of [[1320,1000],[580,860]]){
   win.setSize(width,height);await pause(150);await evaluate(`${same}.querySelector('.tfSourcePaths').scrollIntoView({block:'center'})`);
   assert.ok(await evaluate(`${same}.querySelector('.tfSourcePaths').scrollWidth<=${same}.clientWidth`),'details should fit narrow layouts');
   if(process.env.TOKENFLOW_UI_ARTIFACTS){await mkdir(process.env.TOKENFLOW_UI_ARTIFACTS,{recursive:true});await writeFile(join(process.env.TOKENFLOW_UI_ARTIFACTS,`source-usage-${width}.png`),(await win.webContents.capturePage()).toPNG());}
  }
  console.log('PASS: confirmed source combines gateway/direct usage once, unknown identity stays separate, path details and narrow layout work.');
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
})().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
