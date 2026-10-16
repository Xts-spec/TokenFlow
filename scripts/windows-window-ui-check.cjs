// Renderer simulation only: npx electron scripts/windows-window-ui-check.cjs
// Validates Windows layout and theme messaging on any host; native Windows controls require a Windows machine.
const {app,BrowserWindow,ipcMain}=require('electron');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-windows-ui-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 const themes=[];ipcMain.handle('fixture:set-theme',(_event,theme)=>{assert.ok(['dark','light'].includes(theme));themes.push(theme);});
 const preload=join(root,'preload.cjs');await writeFile(preload,"const {contextBridge,ipcRenderer}=require('electron');contextBridge.exposeInMainWorld('desktop',{platform:'win32',setTheme:theme=>ipcRenderer.invoke('fixture:set-theme',theme)});");
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[],models:[],quotas:{},quotaBusy:false,providers:[{id:'codex',label:'Codex',flow:'callback'}]};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{sandbox:true,preload}});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const wait=async code=>{for(let n=0;n<120;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,30));}throw Error('Windows renderer did not become ready');};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await wait("!!document.querySelector('.nativeWindows .tfTitlebar')");
  assert.equal(await evaluate('document.documentElement.dataset.platform'),'win32');
  assert.equal(await evaluate("getComputedStyle(document.querySelector('.tfTitlebar')).getPropertyValue('-webkit-app-region')"),'drag');
  assert.equal(await evaluate("document.querySelector('.tfTitlebar').getBoundingClientRect().height"),40);
  assert.equal(await evaluate("document.querySelector('.tfMain').getBoundingClientRect().top>=40"),true);
  await evaluate("[...document.querySelectorAll('button')].find(b=>b.textContent==='设置').click()");await wait("!!document.querySelector('[aria-label=浅色外观]')");
  await evaluate("document.querySelector('[aria-label=浅色外观]').click()");await wait("document.documentElement.dataset.theme==='light'");
  await new Promise(r=>setTimeout(r,50));assert.ok(themes.includes('light'));assert.equal(themes[0],'dark');
  await evaluate("document.querySelector('[aria-label=深色外观]').click()");await wait("document.documentElement.dataset.theme==='dark'");
  win.setSize(900,640);await new Promise(r=>setTimeout(r,50));
  assert.equal(await evaluate('document.documentElement.scrollWidth<=innerWidth'),true);
  await writeFile(resolve('.tmp/windows-titlebar-renderer.png'),(await win.webContents.capturePage()).toPNG());
  console.log('PASS: Windows drag region, reserved caption space, compact layout, and dark/light theme messages (native Windows controls untested)');
 }finally{win.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));ipcMain.removeHandler('fixture:set-theme');await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});}
 app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
