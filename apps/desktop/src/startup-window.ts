import {BrowserWindow,app,dialog} from 'electron';

/** Paint before synchronous OS credential access, so a keychain prompt has visible context. */
export async function createStartupWindow(icon:string){
 const window=new BrowserWindow({width:480,height:300,resizable:false,minimizable:false,maximizable:false,show:false,backgroundColor:'#161719',title:'TokenFlow',icon,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 let finished=false;
 window.on('closed',()=>{if(!finished)app.quit();});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 const html=`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>TokenFlow</title><style>
 *{box-sizing:border-box}body{margin:0;background:#161719;color:#f1f2f3;font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;height:100vh;display:grid;place-items:center;text-align:center;padding:24px}h1{font-size:25px;letter-spacing:-.6px;margin:18px 0 12px}p{color:#b9bdc5;line-height:1.7;margin:8px 0}.ring{width:28px;height:28px;margin:auto;border:2px solid #383c42;border-top-color:#40b9a3;border-radius:50%;animation:spin 1s linear infinite}.hint{font-size:12px;max-width:370px;color:#9197a1}@keyframes spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){.ring{animation:none}}
 </style><main aria-busy="true"><div class="ring" aria-hidden="true"></div><h1>TokenFlow</h1><p id="status" role="status" aria-live="polite">正在启动…</p><p class="hint" id="hint">正在准备你的工作台</p></main></html>`;
 await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
 window.show();
 const update=async(status:string,hint='正在准备你的工作台')=>{
  if(window.isDestroyed())return;
  await window.webContents.executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(status)};document.getElementById('hint').textContent=${JSON.stringify(hint)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`).catch(()=>{});
 };
 await update('正在启动…');
 return {update,async confirmCredentialAccess(){
  await update('准备读取本地登录信息','请确认是否允许访问其他客户端的加密登录信息。');
  await window.webContents.executeJavaScript("document.querySelector('.ring').style.animation='none';document.querySelector('main').setAttribute('aria-busy','false')");
  const {response}=await dialog.showMessageBox(window,{type:'question',title:'本地登录信息',message:'是否允许读取客户端的加密登录信息？',detail:`用于识别和复用 Claude Code、Qoder 等客户端的本地登录。${process.platform==='darwin'?'macOS 随后可能弹出对应客户端的钥匙串授权提示。':'系统可能需要授权访问客户端的安全存储。'}\n\n选择“暂不读取”后，本次启动不会访问这些客户端的安全存储；TokenFlow 已保存的账号仍可使用。下次启动时可重新选择。`,buttons:['允许读取','暂不读取'],defaultId:1,cancelId:1,noLink:true});
  if(!window.isDestroyed())await window.webContents.executeJavaScript("document.querySelector('.ring').style.animation='';document.querySelector('main').setAttribute('aria-busy','true')");
  return response===0;
 },close(){finished=true;if(!window.isDestroyed())window.destroy();}};
}
