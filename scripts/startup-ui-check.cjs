// Run with: npx electron scripts/startup-ui-check.cjs (isolated profile; no credentials accessed).
const {app,BrowserWindow,dialog}=require('electron');
const {mkdtemp,writeFile,rm}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-startup-ui-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});
 const bundle=join(root,'startup-window.cjs');require('esbuild').buildSync({entryPoints:['apps/desktop/src/startup-window.ts'],bundle:true,platform:'node',format:'cjs',external:['electron'],outfile:bundle});
 await app.whenReady();
 const startup=await require(bundle).createStartupWindow(join(process.cwd(),'dist/console/app-icon.png'));
 const win=BrowserWindow.getAllWindows()[0];assert.ok(win.isVisible());
 await startup.update('正在读取已保存的凭据…','系统可能请求钥匙串权限，用于解密已保存的凭据。');
 assert.equal(await win.webContents.executeJavaScript("document.querySelector('[role=status]').textContent"),'正在读取已保存的凭据…');
 let choice=1,calls=0;
 dialog.showMessageBox=async(parent,options)=>{
  assert.equal(parent,win);assert.ok(parent.isVisible());assert.equal(options.defaultId,1);assert.equal(options.cancelId,1);
  assert.deepEqual(options.buttons,['允许读取','暂不读取']);assert.ok(options.detail.includes('安全存储'));
  assert.equal(await win.webContents.executeJavaScript("document.querySelector('main').getAttribute('aria-busy')"),'false');calls++;
  return {response:choice,checkboxChecked:false};
 };
 assert.equal(await startup.confirmCredentialAccess(),false);
 choice=0;assert.equal(await startup.confirmCredentialAccess(),true);assert.equal(calls,2);
 await startup.update('正在打开工作台…');
 await writeFile(join(process.cwd(),'.tmp/startup-window.png'),(await win.webContents.capturePage()).toPNG());
 startup.close();assert.ok(win.isDestroyed());
 console.log('PASS: visible startup, pre-access confirmation, allow/skip decisions, and automatic dismissal');
 await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100}).catch(()=>{});app.exit(0);
})().catch(error=>{console.error(error);app.exit(1);});
