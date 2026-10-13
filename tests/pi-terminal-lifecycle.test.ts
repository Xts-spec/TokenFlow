import {expect,it} from 'vitest';
import {PiTerminalLifecycle} from '../packages/core/src/pi-terminal-lifecycle';
const installed=async()=>({installed:true,channel:'npm' as const,automatic:true,download:'https://pi.dev',path:'/fixture/pi'});
function fixture(){let active=true;const calls:{file:string;args:string[]}[]=[];const run=async(file:string,args:string[])=>{calls.push({file,args});if(file==='/bin/kill')active=false;return {stdout:file==='/bin/ps'?'123 ttys001 node\n456 ?? node\n':file==='/usr/sbin/lsof'?"n/fixture/a'b $(not-run)\n":''};};const lifecycle=new PiTerminalLifecycle('/fixture/config/models.json',run,'darwin',async()=>active?[123,456]:[],installed,async()=>{});return {lifecycle,calls,stop:()=>{active=false;}};}
it('only lists actual Pi terminal processes and restarts exactly the selected session with safe literal quoting',async()=>{
 const f=fixture();const [session]=await f.lifecycle.sessions();expect(session).toEqual({pid:123,tty:'ttys001',cwd:"/fixture/a'b $(not-run)"});
 await f.lifecycle.restart(session,'workbuddy/hy4-preview');expect(f.calls.filter(c=>c.file==='/bin/kill')).toEqual([{file:'/bin/kill',args:['-TERM','123']}]);
 const script=f.calls.find(c=>c.file==='/usr/bin/osascript')!.args[1];expect(script).toContain('com.apple.Terminal');expect(script).toContain('--resume');expect(script).toContain('--provider token-flow --model');expect(script).toContain('PI_CODING_AGENT_DIR');expect(script).toContain("'\\\\''");expect(script).not.toContain('SIGKILL');
});
it('opens official Pi when idle and refuses stale or background sessions without terminating another program',async()=>{
 const f=fixture();await expect(f.lifecycle.restart()).rejects.toThrow('选择原终端');await expect(f.lifecycle.restart({pid:999,tty:'ttys001',cwd:'/different'})).rejects.toThrow('已变化');expect(f.calls.some(c=>c.file==='/bin/kill')).toBe(false);
 f.stop();expect((await f.lifecycle.restart()).message).toContain('打开官方 Pi');expect(f.calls.at(-1)?.args[1]).not.toContain('--resume');
});
it('opens a Windows terminal with an encoded fixed command and a literal npm shim path',async()=>{
 const calls:string[][]=[];const pi=new PiTerminalLifecycle('C:\\config\\models.json',async(_file,args)=>{calls.push(args);return {stdout:''};},'win32',async()=>[],async()=>({...await installed(),path:"C:\\Users\\a'b\\pi.cmd"}));
 await pi.restart();expect(calls[0]).toContain('-EncodedCommand');const outer=Buffer.from(calls[0].at(-1)!,'base64').toString('utf16le');expect(outer).toContain('Start-Process');expect(outer).not.toContain('kill');
});
