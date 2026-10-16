// Run with: npx electron scripts/startup-ui-check.cjs (isolated profile; no credentials accessed).
const {app,BrowserWindow}=require('electron');
const {mkdtemp,writeFile,rm,mkdir}=require('node:fs/promises');
const {tmpdir}=require('node:os'),{join}=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 await mkdir(join(process.cwd(),'.tmp'),{recursive:true});
 const root=await mkdtemp(join(tmpdir(),'tf-startup-position-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});const bundle=join(root,'startup-window.cjs');require('esbuild').buildSync({entryPoints:['apps/desktop/src/startup-window.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});await app.whenReady();
 for(const [width,height] of [[1320,900],[900,640]])for(const allow of [false,true]){
  const startup=await require(bundle).createStartupWindow(join(process.cwd(),'apps/console/public/app-icon.png'));
  const win=BrowserWindow.getAllWindows()[0],ev=code=>win.webContents.executeJavaScript(code);win.setBounds({width,height});
  const box=()=>ev(`(()=>{const e=document.querySelector('.brand'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,count:document.querySelectorAll('.brand').length}})()`);
  const initial=await box();assert.equal(initial.count,1);assert.equal(await ev('getComputedStyle(document.getElementById("loading")).visibility'),'hidden','loading animation must wait for a choice');const decision=startup.confirmCredentialAccess();
  await ev('new Promise(resolve=>requestAnimationFrame(resolve))');
  assert.equal(await ev('document.activeElement.id'),'access-title');
  assert.equal(await ev('document.getElementById("consent").getAttribute("role")'),'region');
  assert.equal(await ev('getComputedStyle(document.getElementById("consent")).backgroundColor'),'rgba(0, 0, 0, 0)');
  assert.equal(await ev('getComputedStyle(document.getElementById("skip")).textDecorationLine'),'none');
  assert.deepEqual(await box(),initial,'brand shifted when showing choice');
  assert.equal(await ev('getComputedStyle(document.getElementById("loading")).visibility'),'hidden');
  if(width===1320&&!allow)await writeFile('.tmp/startup-position-choice.png',(await win.webContents.capturePage()).toPNG());
  if(allow){
   for(const id of ['skip','allow']){win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});await ev('new Promise(resolve=>requestAnimationFrame(resolve))');assert.equal(await ev('document.activeElement.id'),id);}
   assert.equal(await ev('getComputedStyle(document.getElementById("skip")).textDecorationLine'),'none');
  }
  await ev(`document.getElementById('${allow?'allow':'skip'}').click()`);assert.equal(await decision,allow);
  assert.deepEqual(await box(),initial,'brand shifted after choosing');
  assert.equal(await ev('getComputedStyle(document.getElementById("consent")).visibility'),'hidden');
  assert.equal(await ev('getComputedStyle(document.getElementById("loading")).visibility'),'visible');
  for(const [status,hint] of [['正在准备网络连接…',''],['正在读取已保存的凭据…','系统可能请求钥匙串权限，用于解密已保存的凭据。'],['正在启动本地服务…',''],['正在打开工作台…','']]){
   await startup.update(status,hint);assert.deepEqual(await box(),initial,'brand shifted during '+status);
  }
  if(width===1320&&!allow)await writeFile('.tmp/startup-position-loading.png',(await win.webContents.capturePage()).toPNG());
  const escaped=startup.confirmCredentialAccess();await ev('new Promise(resolve=>requestAnimationFrame(resolve))');win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});assert.equal(await escaped,false);assert.deepEqual(await box(),initial);assert.deepEqual(startup.bounds(),win.getBounds());
  startup.close();assert.ok(win.isDestroyed());console.log('PASS',width,height,allow?'allow':'skip','one shared brand stays at identical coordinates across choice and all loading stages.');
 }
 await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
