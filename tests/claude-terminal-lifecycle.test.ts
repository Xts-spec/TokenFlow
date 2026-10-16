import {it,expect,vi} from 'vitest';
import {ClaudeTerminalLifecycle} from '../packages/core/src/claude-terminal-lifecycle.js';
import type {AgentInstallation} from '../packages/core/src/agent-installation.js';
const session={pid:42,tty:'ttys001',cwd:"/tmp/project ' $(echo unsafe)",started:'Fri Oct 16 10:00:00 2026',executable:'/verified/claude'};
function fixture(platform:NodeJS.Platform='darwin'){
 const state={pids:[42],started:session.started,verified:true,close:true,path:session.executable};
 const run=vi.fn(async(file:string,args:string[])=>{
  if(file==='/bin/kill'&&state.close)state.pids=[];
  return {stdout:file==='/bin/ps'?`${state.pids.includes(42)?`42 ttys001 ${state.started} ${state.path}`:''}\n43 ?? ${session.started} /extension/claude\n44 ttys002 ${session.started} unrelated`:file==='/usr/sbin/lsof'?`p42\nfcwd\nn${session.cwd}\nftxt\nn${state.path}\n`:''};
 });
 const installation=async()=>({installed:true,path:state.path,channel:'other',download:'https://code.claude.com',automatic:false} satisfies AgentInstallation);
 const lifecycle=new ClaudeTerminalLifecycle(run,platform,async()=>{},{processes:async()=>state.pids,installation,verify:async()=>state.verified},'/fixture/config');
 return {state,run,lifecycle};
}
it('lists only interactive, verified Claude processes with start time and executable identity',async()=>{
 const f=fixture();expect(await f.lifecycle.sessions()).toEqual([session]);f.state.verified=false;expect(await f.lifecycle.sessions()).toEqual([]);
});
it('terminates only the selected session and shell-quotes its working directory for resume',async()=>{
 const f=fixture();await expect(f.lifecycle.restart(session)).resolves.toHaveProperty('message');
 expect(f.run).toHaveBeenCalledWith('/bin/kill',['-TERM','42']);
 const script=f.run.mock.calls.find(([file])=>file==='/usr/bin/osascript')![1].join(' ');
 expect(script).toContain('--resume');expect(script).toContain('/fixture/config');expect(script).toContain("'\\\\''");
});
it('rejects a reused PID and does not force a stalled process to exit',async()=>{
 const f=fixture();f.state.started='Fri Oct 16 11:00:00 2026';await expect(f.lifecycle.restart(session)).rejects.toThrow('已变化');
 expect(f.run).not.toHaveBeenCalledWith('/bin/kill',expect.anything());
 f.state.started=session.started;f.state.close=false;await expect(f.lifecycle.restart(session)).rejects.toThrow('尚未退出');
 expect(f.run).toHaveBeenCalledWith('/bin/kill',['-TERM','42']);expect(f.run).not.toHaveBeenCalledWith('/usr/bin/osascript',expect.anything());
});
it('does not stop any session or change login while other Claude tasks are running',async()=>{
 const f=fixture();f.state.pids=[42,43];const work=vi.fn();await expect(f.lifecycle.change(work,session)).rejects.toThrow('其他');
 expect(work).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalledWith('/bin/kill',expect.anything());
});
it('opens an idle Windows CLI in a separate terminal, but never closes a console host',async()=>{
 const f=fixture('win32'),work=vi.fn();await expect(f.lifecycle.change(work)).rejects.toThrow('Windows');expect(work).not.toHaveBeenCalled();expect(f.run).not.toHaveBeenCalled();
 f.state.pids=[];f.state.path="C:\\User's Apps\\claude.exe";await f.lifecycle.change(work);expect(work).toHaveBeenCalledOnce();
 const outer=Buffer.from(f.run.mock.calls[0][1].at(-1)!,'base64').toString('utf16le');expect(outer).toContain('Start-Process');expect(outer).not.toMatch(/Stop-Process|taskkill/);
 const encoded=outer.match(/'-EncodedCommand','([^']+)'/)![1];const command=Buffer.from(encoded,'base64').toString('utf16le');expect(command).toContain("C:\\User''s Apps\\claude.exe");expect(command).toContain('CLAUDE_CONFIG_DIR');
});
it('launches the npm JavaScript installation with an explicit runtime on Windows',async()=>{
 const f=fixture('win32');f.state.pids=[];f.state.path='C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js';await f.lifecycle.restart();
 const outer=Buffer.from(f.run.mock.calls[0][1].at(-1)!,'base64').toString('utf16le'),encoded=outer.match(/'-EncodedCommand','([^']+)'/)![1];const command=Buffer.from(encoded,'base64').toString('utf16le');expect(command).toContain('ELECTRON_RUN_AS_NODE');expect(command).toContain(process.execPath.replaceAll("'","''"));
});
it('reports a saved configuration if reopening fails without rolling login forward again',async()=>{
 const f=fixture();f.state.pids=[];f.run.mockRejectedValue(Error('terminal unavailable'));const work=vi.fn();await expect(f.lifecycle.change(work)).rejects.toThrow('配置已处理');expect(work).toHaveBeenCalledOnce();
});

it('resolves the official native install whose executable is named after its version',async()=>{
 const f=fixture();f.state.path='/Users/test/.local/share/claude/versions/2.1.121';expect(await f.lifecycle.sessions()).toEqual([{...session,executable:f.state.path}]);
});
