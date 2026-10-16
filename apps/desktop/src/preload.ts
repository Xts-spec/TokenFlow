import { contextBridge, ipcRenderer } from 'electron';
// Expose bounded text writes and appearance changes, never clipboard reads or arbitrary IPC.
contextBridge.exposeInMainWorld('desktop',{
  platform:process.platform,version:'0.1.0',
  copyText:(text:string)=>ipcRenderer.invoke('clipboard:write-text',text),
  setTheme:(theme:'dark'|'light')=>ipcRenderer.invoke('window:set-theme',theme),
});

// A main-process shortcut only; no renderer access to arbitrary IPC.
ipcRenderer.on('repair:open',()=>window.dispatchEvent(new Event('token-flow:open-repair')));
