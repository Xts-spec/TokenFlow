import { app, BrowserWindow, safeStorage, session, dialog, shell, nativeImage, ipcMain, clipboard, Tray, Menu } from 'electron';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSecrets } from './secrets.js';
import { resolveProfile } from './profile.js';
import { createDesktopService } from '../../../packages/core/src/service.js';

const here=dirname(fileURLToPath(import.meta.url));
// Retain the existing profile across the product rename, without copying credentials.
const profile=resolveProfile(app.getPath('appData'),process.env.AGENT_DATA_ROOT);
mkdirSync(profile,{recursive:true,mode:0o700});
app.setPath('userData',profile);
// macOS encryption retains the original keychain service across the display-name change.
app.setName(process.platform==='darwin'?'token-flow':'TokenFlow');
if(!app.requestSingleInstanceLock()) app.quit();
else { void start().catch(error=>{dialog.showErrorBox('TokenFlow 启动失败',error instanceof Error?error.message:String(error));app.exit(1);}); }
async function start() {
  let window:BrowserWindow|undefined;
  let closing=false;
  let tray:Tray|undefined;
  await app.whenReady();
  if(process.platform==='darwin'){
    if(safeStorage.isEncryptionAvailable())safeStorage.encryptString('');
    app.setName('TokenFlow');
  }
  const icon=join(here,'console','app-icon.png');
  if(process.platform==='darwin')app.dock?.setIcon(nativeImage.createFromPath(icon));
  const root=process.env.AGENT_DATA_ROOT?resolve(process.env.AGENT_DATA_ROOT):app.getPath('userData');
  await mkdir(join(root,'secrets'),{recursive:true,mode:0o700});
  const secrets=createSecrets(root,safeStorage);
  let localKey=await secrets.get('cliproxy');
  if(!localKey){
    localKey=randomBytes(32).toString('hex');
    if(secrets.canEncrypt())await secrets.set('cliproxy',localKey);
    else secrets.temporaryGateway();
  }
  const token=randomBytes(32).toString('hex');
  const base=app.isPackaged?process.resourcesPath:resolve(here,'..');
  const service=await createDesktopService({root,token,localKey,secrets,credentialWarnings:secrets.warnings,openExternal:url=>shell.openExternal(url),proxyPort:process.env.AGENT_PROXY_PORT?Number(process.env.AGENT_PROXY_PORT):undefined,binary:process.env.CLIPROXY_BINARY?resolve(process.env.CLIPROXY_BINARY):join(base,'sidecars',`${process.platform}-${process.arch}`,process.platform==='win32'?'cliproxyapi.exe':'cliproxyapi'),uiRoot:join(here,'console')});
  const address=await service.app.listen({host:'127.0.0.1',port:Number(process.env.AGENT_PORT??9527)});
  ipcMain.handle('clipboard:write-text',(event,text:unknown)=>{
    if(!window || event.sender!==window.webContents || event.senderFrame!==window.webContents.mainFrame || new URL(event.senderFrame.url).origin!==address)throw new Error('Clipboard request denied');
    if(typeof text!=='string' || text.length>1_000_000)throw new Error('Invalid clipboard text');
    clipboard.writeText(text);
  });
  await session.defaultSession.cookies.set({url:address,name:'agent_session',value:token,httpOnly:true,sameSite:'strict',path:'/'});
  const show=async()=>{
    if(process.platform==='darwin')await app.dock?.show();
    if(window){if(window.isMinimized())window.restore();window.show();window.focus();return;}
    window=new BrowserWindow({width:1320,height:900,minWidth:900,minHeight:640,show:false,backgroundColor:'#161719',title:'TokenFlow',icon,...(process.platform==='darwin'?{titleBarStyle:'hiddenInset' as const,trafficLightPosition:{x:20,y:20}}:{}),webPreferences:{preload:join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
    window.webContents.setWindowOpenHandler(({url})=>{
      if(['https://github.com/haruinia/token-flow/issues','https://github.com/haruinia/token-flow/blob/main/README.md','https://github.com/haruinia/token-flow/blob/main/docs/usage.md'].includes(url))void shell.openExternal(url).catch(()=>{
        dialog.showErrorBox('无法打开项目页面',`请在浏览器中打开 ${url}`);
      });
      return {action:'deny'};
    });
    window.webContents.on('will-navigate',(event,url)=>{if(new URL(url).origin!==address)event.preventDefault();});
    window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    window.on('close',event=>{
      if(closing)return;
      event.preventDefault();
      window?.hide();
      if(process.platform==='darwin')app.dock?.hide();
    });
    window.on('closed',()=>{window=undefined;});
    await window.loadURL(address);
    window.show();
    window.focus();
  };
  const trayIcon=nativeImage.createFromPath(process.platform==='darwin'?join(here,'console','tray-icon.png'):icon).resize({width:14,height:14});
  if(process.platform==='darwin')trayIcon.setTemplateImage(true);
  tray=new Tray(trayIcon);
  tray.setToolTip('TokenFlow');
  const trayMenu=Menu.buildFromTemplate([
    {label:'打开工作台',click:()=>{void show();}},
    {label:'维修师傅',click:()=>{void show().then(()=>window?.webContents.send('repair:open'));}},
    {type:'separator'},
    {label:'退出 TokenFlow',click:()=>app.quit()},
  ]);
  tray.on('right-click',()=>tray?.popUpContextMenu(trayMenu));
  tray.on('click',()=>{void show();});
  app.on('will-quit',()=>tray?.destroy());
  app.on('second-instance',()=>{void show();});app.on('activate',()=>{void show();});
  // Keep the gateway and menu bar alive even if the workspace is destroyed.
  app.on('window-all-closed',()=>{});
  app.on('before-quit',event=>{if(closing)return;event.preventDefault();closing=true;void service.app.close().finally(()=>app.quit());});
  // The workspace opens immediately; saved accounts, namespaced models and quotas load in the background.
  void service.discoverLocal().catch(() => undefined); // Failure is exposed in the model center with a retry action.
  await show();
}
