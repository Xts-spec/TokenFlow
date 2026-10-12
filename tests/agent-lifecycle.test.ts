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
  await expect(new QoderLifecycle(run,'win32').restart()).rejects.toThrow('当前系统');
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
] as const)('restarts only the selected %s desktop application',async(target,path,bundle)=>{
 let running=true;
 const run=vi.fn(async(file:string)=>{if(file==='/usr/bin/osascript')running=false;if(file==='/usr/bin/open')running=true;return {stdout:file==='/bin/ps'&&running?path:''};});
 await new QoderLifecycle(run,'darwin',async()=>{}).restart(target);
 expect(run).toHaveBeenCalledWith('/usr/bin/osascript',['-e',`tell application id "${bundle}" to quit`]);
 expect(run).toHaveBeenCalledWith('/usr/bin/open',['-b',bundle]);
});
