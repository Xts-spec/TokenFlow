import {BrowserWindow,app} from 'electron';
import {readFile} from 'node:fs/promises';
import {workspaceWindowOptions} from './window-options.js';

/** Paint before synchronous OS credential access, so a keychain prompt has visible context. */
export async function createStartupWindow(icon:string){
 const window=new BrowserWindow({...workspaceWindowOptions(icon),webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 let finished=false;
 window.on('closed',()=>{if(!finished)app.quit();});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
 const logo=await readFile(icon).then(data=>`data:image/png;base64,${data.toString('base64')}`).catch(()=>undefined);
 const brand=`<header class="brand">${logo?`<img src="${logo}" alt="">`:""}<span>TokenFlow</span></header>`;
 const permissionHint=process.platform==='darwin'?'系统可能请求钥匙串授权。':'系统可能请求安全存储授权。';
 const html=`<!doctype html><html lang="zh-CN"><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>TokenFlow</title><style>
 :root{color-scheme:dark;--canvas:#161719;--surface:#202123;--text:#ececef;--muted:#a5a6ad;--soft:#37383c}*{box-sizing:border-box}[hidden]{display:none!important}body{margin:0;background:var(--canvas);color:var(--text);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;height:100vh;overflow:hidden}.titlebar{position:absolute;inset:0 0 auto;height:64px;-webkit-app-region:drag}.brand{display:flex;justify-content:center;align-items:center;gap:10px;margin-bottom:28px;font-size:18px;font-weight:600;letter-spacing:-.4px}.brand img{width:32px;height:32px}main{height:100%;display:grid;place-items:center;padding:64px 32px}.startupContent{width:min(480px,100%)}.loading{text-align:center;max-width:440px;margin-inline:auto}.ring{width:26px;height:26px;margin:0 auto 24px;border:2px solid var(--soft);border-top-color:var(--text);border-radius:50%;animation:spin 1s linear infinite}h1{font-size:22px;letter-spacing:-.5px;margin:0 0 12px;font-weight:600}p{color:var(--muted);line-height:1.8;margin:0}.hint{font-size:13px;margin-top:8px;max-width:420px}.consent{width:min(480px,100%);padding:32px;border-radius:16px;background:var(--surface);animation:appear 180ms ease-out}h2{font-size:22px;font-weight:600;letter-spacing:-.5px;margin:0 0 16px;line-height:1.4}.detail{font-size:14px}.consent .brand{justify-content:flex-start;margin-bottom:24px}.consent .hint{margin-top:12px;font-size:13px}.actions{display:flex;justify-content:flex-end;gap:12px;margin-top:28px}button{font:inherit;font-size:13px;font-weight:500;min-height:38px;padding:0 16px;border:0;border-radius:7px;cursor:pointer;background:transparent;color:var(--muted);transition:color 150ms,background-color 150ms}button:hover{color:var(--text)}button:focus-visible{outline:none;text-decoration:underline;text-underline-offset:5px}button.primary{background:#e1e3e8;color:#1d1e21;font-weight:600}button.primary:hover{background:#f1f2f5}button:active{transform:translateY(1px)}@keyframes spin{to{transform:rotate(360deg)}}@keyframes appear{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}@media(prefers-reduced-motion:reduce){.ring,.consent{animation:none}button{transition:none}}@media(max-height:650px){.brand{margin-bottom:20px}main{padding:64px 24px 32px}}
 </style><div class="titlebar" aria-hidden="true"></div><main aria-busy="true"><div class="startupContent"><section class="loading" id="loading">${brand}<div class="ring" aria-hidden="true"></div><h1>正在准备工作台</h1><p id="status" role="status" aria-live="polite">正在启动…</p><p class="hint" id="hint"></p></section><section class="consent" id="consent" role="dialog" aria-modal="true" aria-labelledby="access-title" aria-describedby="access-detail access-hint" hidden>${brand}<h2 id="access-title">读取本地登录？</h2><p class="detail" id="access-detail">加载 TokenFlow 已保存的账号时，是否同时读取 Claude Code、Qoder 等客户端的登录？</p><p class="hint" id="access-hint">${permissionHint}暂不读取仅跳过其他客户端，TokenFlow 已保存的账号仍会加载。</p><footer class="actions"><button id="skip" type="button">暂不读取</button><button id="allow" class="primary" type="button">允许读取</button></footer></section></div></main></html>`;
 await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
 window.show();
 const update=async(status:string,hint='')=>{
  if(window.isDestroyed())return;
  await window.webContents.executeJavaScript(`document.getElementById('status').textContent=${JSON.stringify(status)};document.getElementById('hint').textContent=${JSON.stringify(hint)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`).catch(()=>{});
 };
 await update('正在启动…');
 let confirmation:Promise<boolean>|undefined;
 const confirmCredentialAccess=()=>confirmation??=(async()=>{
  if(window.isDestroyed())return false;
  let onClosed:()=>void=()=>{};
  const closed=new Promise<boolean>(resolve=>{onClosed=()=>resolve(false);window.once('closed',onClosed);});
  try{return await Promise.race([closed,window.webContents.executeJavaScript(`new Promise(resolve=>{
   const loading=document.getElementById('loading'),consent=document.getElementById('consent'),main=document.querySelector('main');
   const skip=document.getElementById('skip'),allow=document.getElementById('allow');
   loading.hidden=true;consent.hidden=false;main.setAttribute('aria-busy','false');skip.focus();
   const done=value=>{skip.removeEventListener('click',onSkip);allow.removeEventListener('click',onAllow);document.removeEventListener('keydown',onKey);consent.hidden=true;loading.hidden=false;main.setAttribute('aria-busy','true');resolve(value);};
   const onSkip=()=>done(false),onAllow=()=>done(true);
   const onKey=event=>{if(event.key==='Escape'){event.preventDefault();done(false);}else if(event.key==='Tab'){event.preventDefault();(document.activeElement===skip?allow:skip).focus();}};
   skip.addEventListener('click',onSkip);allow.addEventListener('click',onAllow);document.addEventListener('keydown',onKey);
  })`).then(value=>value===true).catch(()=>false)]);}
  finally{window.removeListener('closed',onClosed);confirmation=undefined;}
 })();
 return {update,confirmCredentialAccess,bounds:()=>window.isDestroyed()?undefined:window.getBounds(),isMaximized:()=>!window.isDestroyed()&&window.isMaximized(),close(){finished=true;if(!window.isDestroyed())window.destroy();}};
}
