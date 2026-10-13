import {it,expect,vi} from 'vitest';
import {QoderLifecycle} from '../packages/core/src/agent-lifecycle.js';

const qoder='/Applications/Qoder.app/Contents/MacOS/Qoder';
it('waits for standalone Qoder to exit before reopening and confirms launch',async()=>{
  const states=[qoder,qoder,'','',qoder];
  const run=vi.fn(async(file:string)=>({stdout:file==='/bin/ps'?states.shift()??'':''}));
  const lifecycle=new QoderLifecycle(run,'darwin',async()=>{});
  await expect(lifecycle.restart()).resolves.toHaveProperty('message');
  expect(run.mock.calls.map(([file])=>file)).toEqual(['/bin/ps','/usr/bin/osascript','/bin/ps','/bin/ps','/usr/bin/open','/bin/ps','/bin/ps']);
  expect(run).toHaveBeenCalledWith('/usr/bin/open',['-b','com.qoder.app']);
});
it('opens a stopped app without quitting Qoder IDE',async()=>{
  let opened=false;
  const run=vi.fn(async(file:string)=>{if(file==='/usr/bin/open')opened=true;return {stdout:opened?qoder:'/Applications/Qoder IDE.app/Contents/MacOS/Qoder'};});
  await new QoderLifecycle(run,'darwin',async()=>{}).restart();
  expect(run.mock.calls.some(([file])=>file==='/usr/bin/osascript')).toBe(false);
});
it('does not force quit or relaunch when normal quit is cancelled',async()=>{
  const run=vi.fn(async(file:string)=>{if(file==='/usr/bin/osascript')throw Error('cancelled');return {stdout:qoder};});
  await expect(new QoderLifecycle(run,'darwin',async()=>{}).restart()).rejects.toThrow('未强制结束');
  expect(run.mock.calls.map(([file])=>file)).toEqual(['/bin/ps','/usr/bin/osascript']);
});
it('reports timeout without launching a duplicate process',async()=>{
  const run=vi.fn(async()=>({stdout:qoder}));
  await expect(new QoderLifecycle(run,'darwin',async()=>{}).restart()).rejects.toThrow('尚未退出');
  expect(run).not.toHaveBeenCalledWith('/usr/bin/open',expect.anything());
});
it('reports an unconfirmed launch and rejects unsupported systems',async()=>{
  const run=vi.fn(async()=>({stdout:''}));
  await expect(new QoderLifecycle(run,'darwin',async()=>{}).restart()).rejects.toThrow('尚未确认');
  run.mockClear();
  await expect(new QoderLifecycle(run,'linux').restart()).rejects.toThrow('当前系统');
  expect(run).not.toHaveBeenCalled();
});
it('rejects duplicate restart requests until the first one finishes',async()=>{
  let release!:()=>void;
  const run=vi.fn(()=>new Promise<{stdout:string}>(resolve=>{release=()=>resolve({stdout:''});}));
  const lifecycle=new QoderLifecycle(run,'darwin',async()=>{});
  const first=lifecycle.restart();
  await expect(lifecycle.restart()).rejects.toThrow('正在重启');
  run.mockRejectedValue(Error('unavailable'));release();
  await expect(first).rejects.toThrow('无法打开');
});

it('retries a transient LaunchServices failure after the old process exits',async()=>{
  let attempts=0,opened=false;
  const run=vi.fn(async(file:string)=>{
    if(file==='/usr/bin/open'){if(++attempts===1)throw Error('old app still terminating');opened=true;}
    return {stdout:opened?qoder:''};
  });
  await new QoderLifecycle(run,'darwin',async()=>{}).restart();
  expect(attempts).toBe(2);
});

it.each([
 ['codex','/Applications/ChatGPT.app/Contents/MacOS/ChatGPT','com.openai.codex'],
 ['workbuddy','/Applications/WorkBuddy.app/Contents/MacOS/Electron','com.tencent.workbuddy.mac'],
 ['claude','/Applications/Visual Studio Code.app/Contents/MacOS/Electron','com.microsoft.VSCode'],
 ['deepseek','/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness','com.deepseek.dsh'],
] as const)('restarts only the selected %s desktop application',async(target,path,bundle)=>{
 let running=true;
 const run=vi.fn(async(file:string)=>{if(file==='/usr/bin/osascript')running=false;if(file==='/usr/bin/open')running=true;return {stdout:file==='/bin/ps'&&running?path:''};});
 await new QoderLifecycle(run,'darwin',async()=>{}).restart(target);
 expect(run).toHaveBeenCalledWith('/usr/bin/osascript',['-e',`tell application id "${bundle}" to quit`]);
 expect(run).toHaveBeenCalledWith('/usr/bin/open',['-b',bundle]);
});

const winImage=(target:string)=>({qoder:'Qoder',codex:'Codex',workbuddy:'WorkBuddy',deepseek:'DeepSeek Harness'} as {[key:string]:string})[target];
const decoded=(args:string[])=>Buffer.from(args[args.indexOf('-EncodedCommand')+1],'base64').toString('utf16le');
it.each(['qoder','codex','workbuddy','deepseek'] as const)('restarts the %s desktop application on Windows without forcing it to quit',async target=>{
 const image=winImage(target);let running=true;const calls:{file:string;script:string}[]=[];
 const run=vi.fn(async(file:string,args:string[])=>{
  if(file==='tasklist')return {stdout:running?`"${image}.exe","10","Console","1","1 K"\r\n`:'INFO: No tasks are running which match the specified criteria.\r\n'};
  const script=decoded(args);calls.push({file,script});
  if(script.includes('CloseMainWindow')){running=false;return {stdout:JSON.stringify([`C:\\Users\\me\\AppData\\Local\\Programs\\${image}\\${image}.exe`])};}
  running=true;return {stdout:''};
 });
 await expect(new QoderLifecycle(run,'win32',async()=>{}).restart(target)).resolves.toHaveProperty('message');
 expect(calls).toHaveLength(2);
 expect(calls[0].script).toContain(`Get-Process -Name '${image}'`);
 // The path from the running process is used first; nothing is killed.
 expect(calls[1].script).toContain(`'C:\\Users\\me\\AppData\\Local\\Programs\\${image}\\${image}.exe'`);
 expect(run.mock.calls.every(([file,args])=>file==='tasklist'||file==='powershell.exe'&&!/Stop-Process|taskkill|-Force/i.test(decoded(args)))).toBe(true);
});
it('opens a stopped Windows app through its Start menu entry when no install path is known, and reports a close that never completes',async()=>{
 let running=false;const scripts:string[]=[];
 const run=vi.fn(async(file:string,args:string[])=>{
  if(file==='tasklist')return {stdout:running?'"Codex.exe","1"':''};
  scripts.push(decoded(args));running=true;return {stdout:''};
 });
 await new QoderLifecycle(run,'win32',async()=>{}).restart('codex');
 expect(scripts).toHaveLength(1);expect(scripts[0]).toContain("Get-StartApps");expect(scripts[0]).toContain("$_.Name -eq 'Codex'");expect(scripts[0]).toContain("-notlike '*\\WindowsApps\\*'");
 const stuck=vi.fn(async(file:string)=>({stdout:file==='tasklist'?'"Codex.exe","1"':'[]'}));
 await expect(new QoderLifecycle(stuck,'win32',async()=>{}).restart('codex')).rejects.toThrow('托盘');
 expect(stuck.mock.calls.filter(([file])=>file==='powershell.exe')).toHaveLength(1);
});
it('does not offer a desktop restart for Claude Code on Windows',async()=>{
 const run=vi.fn(async()=>({stdout:''}));
 await expect(new QoderLifecycle(run,'win32',async()=>{}).restart('claude')).rejects.toThrow('当前系统');
 expect(run).not.toHaveBeenCalled();
});
