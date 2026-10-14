import {expect,it,vi} from 'vitest';
import {CodexSwitchLifecycle} from '../packages/core/src/codex-switch-lifecycle.js';

it('terminates Codex, waits for its runtime, changes configuration, then opens it once',async()=>{
 let pids=[120,121];const events:string[]=[];
 const run=vi.fn(async(file:string,args:string[])=>{expect(file).toBe('/bin/kill');events.push(args.join(' '));pids=pids.filter(pid=>String(pid)!==args[1]);});
 const launch=vi.fn(async()=>{events.push('open');return {message:'opened'};});
 const lifecycle=new CodexSwitchLifecycle(async()=>pids,run,launch,'darwin',async()=>{});
 await expect(lifecycle.change(async()=>{expect(pids).toEqual([]);expect(lifecycle.phase).toBe('changing');events.push('backup/migrate');return 'done';})).resolves.toBe('done');
 expect(events).toEqual(['-TERM 120','-TERM 121','backup/migrate','open']);expect(lifecycle.phase).toBe('idle');
});
it('force terminates only the still-running Codex processes after the grace period',async()=>{
 let pids=[120,121];
 const run=vi.fn(async(_file:string,args:string[])=>{if(args[0]==='-TERM'&&args[1]==='120')pids=[121];if(args[0]==='-KILL')pids=[];});
 const work=vi.fn(async()=>{});
 await new CodexSwitchLifecycle(async()=>pids,run,async()=>({message:''}),'darwin',async()=>{}).change(work);
 expect(run.mock.calls.map(([,args])=>args)).toEqual([['-TERM','120'],['-TERM','121'],['-KILL','121']]);expect(work).toHaveBeenCalledOnce();
});
it('never changes configuration or reopens when a runtime cannot be stopped',async()=>{
 const work=vi.fn(async()=>{}),launch=vi.fn(async()=>({message:''}));
 const lifecycle=new CodexSwitchLifecycle(async()=>[120],async()=>{},launch,'darwin',async()=>{});
 await expect(lifecycle.change(work)).rejects.toThrow('仍在运行');expect(work).not.toHaveBeenCalled();expect(launch).not.toHaveBeenCalled();expect(lifecycle.phase).toBe('idle');
});
it('keeps a failed migration stopped and allows retry without another manual exit',async()=>{
 const launch=vi.fn(async()=>({message:''}));const lifecycle=new CodexSwitchLifecycle(async()=>[],async()=>{},launch,'darwin',async()=>{});
 await expect(lifecycle.change(async()=>{throw Error('backup failed');})).rejects.toThrow('backup failed');expect(launch).not.toHaveBeenCalled();
 await lifecycle.change(async()=>{});expect(launch).toHaveBeenCalledOnce();
});
it('reports a completed change separately from a failed relaunch',async()=>{
 const work=vi.fn(async()=>{});const lifecycle=new CodexSwitchLifecycle(async()=>[],async()=>{},async()=>{throw Error('launch failed');},'darwin',async()=>{});
 await expect(lifecycle.change(work)).rejects.toThrow('配置操作已完成');expect(work).toHaveBeenCalledOnce();expect(lifecycle.phase).toBe('idle');
});
it('rejects a second change during migration without restarting over it',async()=>{
 let release!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const launch=vi.fn(async()=>({message:''}));
 const lifecycle=new CodexSwitchLifecycle(async()=>[],async()=>{},launch,'darwin',async()=>{});
 const first=lifecycle.change(()=>pending);await expect(lifecycle.change(async()=>{})).rejects.toThrow('正在切换');release();await first;expect(launch).toHaveBeenCalledOnce();
});
it('uses exact Windows process IDs and force closes only after waiting',async()=>{
 let alive=true;const run=vi.fn(async(_file:string,args:string[])=>{if(args.includes('/F'))alive=false;});
 await new CodexSwitchLifecycle(async()=>alive?[123]:[],run,async()=>({message:''}),'win32',async()=>{}).change(async()=>{});
 expect(run.mock.calls).toEqual([['taskkill',['/PID','123','/T']],['taskkill',['/PID','123','/T','/F']]]);
});
