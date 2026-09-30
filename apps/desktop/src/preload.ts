import { contextBridge, ipcRenderer } from 'electron';
// Expose only text writes, never clipboard reads or arbitrary IPC.
contextBridge.exposeInMainWorld('desktop',{
  platform:process.platform,version:'0.1.0',
  copyText:(text:string)=>ipcRenderer.invoke('clipboard:write-text',text),
});

// A main-process shortcut only; no renderer access to arbitrary IPC.
ipcRenderer.on('repair:open',()=>window.dispatchEvent(new Event('token-flow:open-repair')));
