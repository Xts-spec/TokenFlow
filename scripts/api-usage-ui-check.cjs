// Run after npm run build: npx electron scripts/api-usage-ui-check.cjs
// Isolated fixtures; no real credentials, account changes or provider requests.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdir,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-api-ui-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 const day=new Date().toLocaleDateString('en-CA'),old=new Date();old.setDate(old.getDate()-1);
 const source=(id,name,models)=>({id:id.repeat(24),name,models,baseURL:'https://fixture.example/v1',protocol:'chat',enabled:true,hasKey:true});
 const sources=[source('a','DeepSeek',['deepseek-flash']),source('b','SiliconFlow',['deepseek-ai/DeepSeek-V4.1-Flash']),source('c','未调用的接口',['fixture'])];
 const model=s=>`api-${s.id}/${s.models[0]}`;
 const base={day,last:new Date().toISOString(),keyId:'api-probe',keyName:'API 连通性测试',sourceId:sources[0].id,model:model(sources[0]),origin:'gateway',channel:'api',target:'internal',requests:1,failed:0,unmeasured:0,inputTokens:100,cachedTokens:60,cacheBaseTokens:100,outputTokens:20,durationMs:10};
 const rows=[base,{...base,day:old.toLocaleDateString('en-CA'),inputTokens:180,outputTokens:20},{...base,sourceId:sources[1].id,model:model(sources[1]),inputTokens:0,outputTokens:0,cachedTokens:0,cacheBaseTokens:0,unmeasured:1}];
 let syncing=false,syncDone=false;
 const local=()=>({state:'running',loginState:'idle',port:8317,logs:[],accounts:[],models:sources.filter((s,i)=>i!==1||syncDone).map(s=>({id:model(s),provider:'api'})),apiSources:sources,apiRoutesSyncing:syncing,quotas:{},quotaBusy:false,providers:[]});
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path===`/api/sources/${sources[1].id}`&&req.method==='PUT'){
    let body='';for await(const chunk of req)body+=chunk;sources[1].name=JSON.parse(body).name;syncing=true;
    res.end(JSON.stringify({...sources[1],routingPending:true,routingError:'来源已保存，模型路由仍在同步，系统会自动重试。可查看卡片上的路由状态。'}));
    setTimeout(()=>{syncing=false;syncDone=true;},600);return;
   }
   const value=path==='/api/local-agent'?local():path==='/api/a2a'?{targets:[]}:path==='/api/usage/overview'?{rows,combinedRows:rows,allRows:rows,nativeRows:[],coverage:[],scanning:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{ };
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true,backgroundThrottling:false}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<120;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 const screenshot=async name=>{await pause(250);const directory=resolve('release/api-usage-test');await mkdir(directory,{recursive:true});await writeFile(join(directory,name),(await win.webContents.capturePage()).toPNG());};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait('[...document.querySelectorAll("button")].some(e=>e.textContent.trim()==="API 接口")');
  await evaluate('[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="API 接口").click()');
  await wait('document.querySelectorAll(".tfApiSourceCard").length===3');
  const counts=await evaluate('[...document.querySelectorAll(".tfApiUsageCounts")].map(e=>e.innerText)');
  assert.match(counts[0],/当日用量/);assert.match(counts[0],/120Token/);assert.doesNotMatch(counts[0],/累计|320/);
  assert.equal((counts[1].match(/未提供/g)||[]).length,1);assert.equal((counts[2].match(/0/g)||[]).length,1);
  await screenshot('api-usage.png');
  await evaluate('[...document.querySelectorAll(".tfApiSourceCard")][1].querySelector(".tfApiCardManage button").click()');
  await wait('!!document.querySelector("input[name=name]")');
  await evaluate('(()=>{const e=document.querySelector("input[name=name]");Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(e,"SiliconFlow 更新");e.dispatchEvent(new Event("input",{bubbles:true}));})()');
  await evaluate('document.querySelector("form.tfApiEditor").requestSubmit()');
  await wait('document.querySelector(".tfToast.warning strong")?.textContent==="来源已保存"');
  assert.doesNotMatch(await evaluate('document.querySelector(".tfNotifications").innerText'),/操作未完成/);
  await wait('[...document.querySelectorAll(".tfApiSourceCard")][1].querySelector(".tfKeyStatus").textContent==="已就绪"');
  await wait('document.querySelector(".tfToast.ok strong")?.textContent==="模型路由已就绪"');
  await screenshot('api-synced.png');
  await win.setSize(760,1000);await pause(150);
  assert.equal(await evaluate('document.documentElement.scrollWidth>window.innerWidth'),false);
  assert.equal(await evaluate('[...document.querySelectorAll(".tfApiUsageCounts")].every(e=>e.scrollWidth<=e.clientWidth)'),true);
  await screenshot('api-usage-narrow.png');
  console.log('PASS: today-only totals excluding previous days, unknown versus zero, saved warning, automatic route status refresh, desktop/narrow layouts.');
 }catch(error){console.error(error);process.exitCode=1;}
 finally{win.destroy();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});app.exit(process.exitCode??0);}
})();
