// Run with: npx electron scripts/startup-ui-check.cjs (isolated profile; no credentials accessed).
const {app,BrowserWindow}=require('electron');
const {mkdtemp,writeFile,rm,mkdir}=require('node:fs/promises');
const {tmpdir}=require('node:os'),{join}=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 await mkdir(join(process.cwd(),'.tmp'),{recursive:true});
 const root=await mkdtemp(join(tmpdir(),'tf-startup-position-'));
 app.setPath('userData',root);app.on('window-all-closed',()=>{});
 const bundle=join(root,'startup-window.cjs');
 require('esbuild').buildSync({entryPoints:['apps/desktop/src/startup-window.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});
 await app.whenReady();
 for(const [width,height] of [[1320,900],[900,640]])for(const allow of [false,true]){
  const startup=await require(bundle).createStartupWindow(join(process.cwd(),'apps/console/public/app-icon.png'));
  const win=BrowserWindow.getAllWindows()[0],ev=code=>win.webContents.executeJavaScript(code);
  win.setBounds({width,height});
  const frames=()=>ev('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  await frames();
  // Observe every rendered frame, including the click and status transitions, not just their final states.
  await ev(`(()=>{
   const visible=e=>!!e&&getComputedStyle(e).visibility==='visible'&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0;
   const rect=e=>{const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};};
   window.startupFrames=[];window.startupPhase='initial';window.collectStartup=true;
   window.startupSnapshot=()=>({phase:window.startupPhase,brand:[...document.querySelectorAll('.brand,.brand img,.brand span')].map(rect),
    choice:visible(document.getElementById('consent')),loading:visible(document.getElementById('loading')),
    buttons:[...document.querySelectorAll('button')].filter(visible).length,
    rings:[...document.querySelectorAll('.ring')].filter(visible).length,
    descriptions:[...document.querySelectorAll('#access-detail,#access-hint')].filter(visible).length,
    statuses:[...document.querySelectorAll('[role="status"]')].filter(visible).length,
    busy:document.querySelector('main').getAttribute('aria-busy'),
    overflow:document.documentElement.scrollWidth>innerWidth||document.documentElement.scrollHeight>innerHeight});
   const sample=()=>{window.startupFrames.push(window.startupSnapshot());if(window.collectStartup)requestAnimationFrame(sample);};sample();
  })()`);
  const snapshot=()=>ev('window.startupSnapshot()');
  const initial=await snapshot();assert.equal(initial.brand.length,3);assert.equal(initial.rings,0);
  const decision=startup.confirmCredentialAccess();
  assert.equal(startup.confirmCredentialAccess(),decision,'repeated confirmation must share the same pending choice');
  await ev("window.startupPhase='choice'");await frames();
  assert.equal(await ev('document.activeElement.id'),'access-title');
  assert.equal(await ev('document.getElementById("consent").getAttribute("role")'),'region');
  assert.equal(await ev('getComputedStyle(document.getElementById("consent")).backgroundColor'),'rgba(0, 0, 0, 0)');
  assert.equal(await ev('getComputedStyle(document.getElementById("skip")).textDecorationLine'),'none');
  const choice=await snapshot();assert.equal(choice.choice,true);assert.equal(choice.loading,false);assert.equal(choice.buttons,2);assert.equal(choice.descriptions,2);
  await writeFile(`.tmp/startup-${width}-${allow?'allow':'skip'}-choice.png`,(await win.webContents.capturePage()).toPNG());
  for(const id of ['skip','allow']){
   win.webContents.sendInputEvent({type:'keyDown',keyCode:'Tab'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Tab'});
   await frames();assert.equal(await ev('document.activeElement.id'),id);
  }
  assert.equal(await ev('getComputedStyle(document.getElementById("skip")).textDecorationLine'),'none');
  await ev(`window.startupPhase='selected';document.getElementById('${allow?'allow':'skip'}').click()`);
  assert.equal(await decision,allow);await frames();
  const selected=await snapshot();assert.equal(selected.choice,false);assert.equal(selected.loading,true);
  assert.equal(selected.buttons,0);assert.equal(selected.descriptions,0);assert.equal(selected.rings,1);assert.equal(selected.statuses,1);
  for(const [status,hint] of [['正在准备网络连接…',''],['正在读取已保存的凭据…','系统可能请求钥匙串权限，用于解密已保存的凭据。'],['正在启动本地服务…',''],['正在打开工作台…','']]){
   await ev(`window.startupPhase=${JSON.stringify(status)}`);await startup.update(status,hint);
   assert.equal(await ev('document.getElementById("status").textContent'),status);
   assert.equal(await ev('document.getElementById("hint").textContent'),hint,'stale permission hints must be cleared');
  }
  await writeFile(`.tmp/startup-${width}-${allow?'allow':'skip'}-loading.png`,(await win.webContents.capturePage()).toPNG());
  const escaped=startup.confirmCredentialAccess();await frames();
  win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'});win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  assert.equal(await escaped,false);await frames();
  await ev('window.collectStartup=false');await frames();
  const samples=await ev('window.startupFrames');assert.ok(samples.length>=12);
  for(const sample of samples){
   assert.deepEqual(sample.brand,initial.brand,'brand/icon/name shifted during '+sample.phase);
   assert.equal(sample.overflow,false,'startup content overflowed during '+sample.phase);
   assert.ok(!(sample.choice&&sample.loading),'choice and loading overlap during '+sample.phase);
   assert.equal(sample.buttons,sample.choice?2:0,'choice buttons leaked into loading');
   assert.equal(sample.descriptions,sample.choice?2:0,'choice explanation leaked into loading');
   assert.equal(sample.rings,sample.loading?1:0,'loading animation appeared before choice');
   assert.equal(sample.statuses,sample.loading?1:0,'live loading status appeared before choice');
   if(sample.choice)assert.equal(sample.busy,'false');if(sample.loading)assert.equal(sample.busy,'true');
  }
  assert.deepEqual(startup.bounds(),win.getBounds());startup.close();assert.ok(win.isDestroyed());
  console.log('PASS',width,height,allow?'allow':'skip',samples.length,'frames: icon/name anchored, choice/loading exclusive, no overflow; Tab, Escape and all loading stages verified.');
 }
 await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});app.exit(0);
})().catch(e=>{console.error(e);app.exit(1)});
