import {it,expect,vi} from 'vitest';
import {ClaudeTerminalLifecycle} from '../packages/core/src/claude-terminal-lifecycle.js';
const session={pid:42,tty:'ttys001',cwd:"/tmp/project ' $(echo unsafe)"};
it('lists only interactive Claude processes, excluding IDE and other terminal programs',async()=>{
 const run=vi.fn(async(file:string)=>({stdout:file==='/bin/ps'?'42 ttys001 claude\n43 ?? /extension/claude\n44 ttys002 node\n':`p42\nn${session.cwd}\n`}));
 expect(await new ClaudeTerminalLifecycle(run,'darwin').sessions()).toEqual([session]);
 expect(run).toHaveBeenCalledTimes(2);
});
it('terminates only the selected session and opens a quoted resume picker in its directory',async()=>{
 let running=true;
 const run=vi.fn(async(file:string)=>{
  if(file==='/bin/kill')running=false;
  return {stdout:file==='/bin/ps'?(running?'42 ttys001 claude':''):file==='/usr/sbin/lsof'?`p42\nn${session.cwd}\n`:''};
 });
 await expect(new ClaudeTerminalLifecycle(run,'darwin',async()=>{}).restart(session)).resolves.toHaveProperty('message');
 expect(run).toHaveBeenCalledWith('/bin/kill',['-TERM','42']);
 const script=run.mock.calls.find(([file])=>file==='/usr/bin/osascript');expect(script).toBeDefined();
 // The command is passed as data to AppleScript, then single-quoted to the terminal shell.
 expect(run).toHaveBeenCalledWith('/usr/bin/osascript',expect.arrayContaining([expect.stringContaining('claude --resume')]));
 expect(run).toHaveBeenCalledWith('/usr/bin/osascript',expect.arrayContaining([expect.stringContaining("'\\\\''")]));
});
it('rejects changed identities and never escalates a stalled exit to force kill',async()=>{
 const run=vi.fn(async(file:string)=>({stdout:file==='/bin/ps'?'42 ttys001 claude':`p42\nn${session.cwd}\n`}));
 const lifecycle=new ClaudeTerminalLifecycle(run,'darwin',async()=>{});
 await expect(lifecycle.restart({...session,cwd:'/different'})).rejects.toThrow('已变化');
 expect(run).not.toHaveBeenCalledWith('/bin/kill',expect.anything());
 await expect(lifecycle.restart(session)).rejects.toThrow('尚未退出');
 expect(run).toHaveBeenCalledWith('/bin/kill',['-TERM','42']);
 expect(run).not.toHaveBeenCalledWith('/usr/bin/osascript',expect.anything());
});
