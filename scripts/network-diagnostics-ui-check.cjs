// Build the console first, then run with Electron. Uses isolated fixture data.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');

async function main(){
 app.on('window-all-closed',()=>{});
 const root=await mkdtemp(join(tmpdir(),'tokenflow-network-ui-'));
 app.setPath('userData',root);await app.whenReady();app.dock?.hide();
 let checks=0;
 const local={state:'running',loginState:'failed',port:8317,logs:['codex [fixture] 浏览器回调已校验并交给网关；等待凭据交换与保存'],accounts:[],models:[],quotas:{},quotaBusy:false,providers:[],network:{mode:'system',loopback:'direct',routes:[]},login:{id:'fixture',provider:'codex',flow:'callback',status:'failed',message:'交换登录凭据失败',diagnostic:{stage:'token_exchange',code:'timeout',reason:'连接或等待超时'}}};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path==='/api/local-agent/network-check'){
    assert.equal(req.method,'POST');checks++;
    local.networkCheck={checkedAt:new Date().toISOString(),results:[{target:'本机网关',host:'127.0.0.1',via:'local',reachable:true,httpStatus:200,elapsedMs:3,code:'reachable',message:'本机网关已响应'},{target:'Codex 授权服务',host:'auth.openai.com',via:'app',reachable:true,httpStatus:403,elapsedMs:50,code:'http_response',message:'已收到响应'},{target:'Codex 授权服务',host:'auth.openai.com',via:'gateway',reachable:false,elapsedMs:10000,code:'timeout',message:'连接或等待超时'}]};
    local.logs.push('网络检查 · Codex 授权服务 · 网关出站 · 未连通 · 10000ms · timeout');
    res.end(JSON.stringify(local));return;
   }
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 win.webContents.on('console-message',event=>{if(event.level==='error')console.error(event.message);});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<100;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,50));}throw Error('UI timeout: '+code);};
 const click=async label=>{await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(label)}&&!e.disabled)?.click()`);};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait('!!document.querySelector("nav")');await new Promise(r=>setTimeout(r,350));await click('设置');
  await wait('document.querySelector(".tfSettingsPage")?.innerText.includes("复制诊断信息")');
  await evaluate('void(window.desktop={platform:"win32",copyText:async text=>{window.copiedDiagnostic=text}})');
  await click('检查网络');
  await wait('document.querySelector("[aria-label=网络检查结果]")?.innerText.includes("10000ms")');
  assert.equal(checks,1);
  const text=await evaluate('document.querySelector(".tfSettingsPage").innerText');
  assert.match(text,/已响应 HTTP 403/);assert.match(text,/未连通.*10000ms.*连接或等待超时/);
  await click('复制诊断信息');await wait('!!window.copiedDiagnostic');
  const report=JSON.parse(await evaluate('window.copiedDiagnostic'));
  assert.equal(report.platform,'win32');assert.equal(report.networkCheck.results.length,3);assert.equal(report.login.diagnostic.stage,'token_exchange');assert.match(report.logs.at(-1),/timeout/);
  await writeFile(resolve('.tmp/network-diagnostics-ui.png'),(await win.webContents.capturePage()).toPNG());
  console.log('PASS: network-check button, separate app/gateway results, 403 wording, failure details, and copied diagnostic report.');
 }catch(error){console.error(await evaluate('document.body.innerText.slice(0,1500)'));throw error;}finally{win.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
