import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join} from 'node:path';
import {readFile,readlink,realpath} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
import {agentProcesses} from './agent-connections.js';
import {detectAgent,type AgentInstallation} from './agent-installation.js';
const exec=promisify(execFile);
type Run=(file:string,args:string[])=>Promise<{stdout:string}>;
const failure=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export type ClaudeTerminalSession={pid:number;tty:string;cwd:string;started?:string;executable?:string};
const quote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
const psQuote=(value:string)=>`'${value.replaceAll("'","''")}'`;
type Options={processes?:()=>Promise<number[]>;installation?:()=>Promise<AgentInstallation>;verify?:(path:string)=>Promise<boolean>;launch?:(file:string,args:string[])=>Promise<void>};
/** Only a verified installation and a PID/start-time pair may be stopped. Console hosts are never killed. */
export class ClaudeTerminalLifecycle{
 private busy=false;
 constructor(private run:Run=(file,args)=>exec(file,args,{env:{...process.env,LC_ALL:'C'},timeout:15000,maxBuffer:1024*1024,windowsHide:true}),private platform=process.platform,private wait=()=>delay(250),private options:Options={},private configDir=process.env.CLAUDE_CONFIG_DIR||join(homedir(),'.claude')){}
 private processes(){return (this.options.processes??(()=>agentProcesses('claude')))();}
 private installation(){return (this.options.installation??(()=>detectAgent('claude')))();}
 private async verified(path:string){
  if(this.options.verify)return this.options.verify(path);
  if(!isAbsolute(path))return false;
  try{
   const resolved=await realpath(path),installed=await this.installation();
   if(installed.installed&&installed.path&&resolved===await realpath(installed.path))return true;
   // npm native payloads and the official VS Code extension have publisher-owned manifests.
   let dir=dirname(resolved);
   for(let i=0;i<5;i++,dir=dirname(dir))try{const pkg=JSON.parse(await readFile(join(dir,'package.json'),'utf8'));if(pkg.name==='@anthropic-ai/claude-code'||pkg.name?.startsWith('@anthropic-ai/claude-code-'))return true;}catch{}
  }catch{}
  return false;
 }
 async sessions():Promise<ClaudeTerminalSession[]>{
  if(!['darwin','linux'].includes(this.platform))return [];
  const candidates=new Set(await this.processes());if(!candidates.size)return [];
  const {stdout}=await this.run('/bin/ps',['-axo','pid=,tty=,lstart=,comm=']);
  const sessions:ClaudeTerminalSession[]=[];
  for(const line of stdout.split('\n')){
   const m=line.trim().match(/^(\d+)\s+(ttys\d+|pts\/\d+|tty\d+)\s+(.{24})\s+(.+)$/);if(!m||!candidates.has(Number(m[1])))continue;
   const pid=Number(m[1]);let cwd='',executable=m[4];
   try{
    if(this.platform==='linux'){cwd=await readlink(`/proc/${pid}/cwd`);executable=await readlink(`/proc/${pid}/exe`);}
    else{
     const info=(await this.run('/usr/sbin/lsof',['-a','-p',String(pid),'-d','cwd,txt','-Fn'])).stdout;
     let field='';for(const row of info.split('\n')){if(row[0]==='f')field=row.slice(1);if(row.startsWith('n/')){if(field==='cwd')cwd=row.slice(1);if(field==='txt'&&(/(?:^|\/)(?:claude(?:\.exe)?|node)$/.test(row.slice(1))||/\/claude\/versions\/\d+\.\d+\.\d+(?:[-.+][\w.-]+)?$/.test(row.slice(1))||row.slice(1)===process.execPath))executable=row.slice(1);}}
    }
    if(/(?:^|\/)node$/.test(executable)||executable===process.execPath){
     // Read only the launcher token, never retain or expose prompt/credential arguments.
     const command=(await this.run('/bin/ps',['-p',String(pid),'-o','args='])).stdout;
     const args=command.match(/^\s*(?:"[^"]*"|\S+)\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
     const script=args?.[1]??args?.[2]??args?.[3];
     if(!script||!/(?:\/@anthropic-ai\/claude-code\/cli\.js|\/claude)$/.test(script)||!await this.verified(script))continue;
     executable=script;
    }else if(!await this.verified(executable))continue;
    if(cwd&&![cwd,executable].some(s=>/[\r\n\x00]/.test(s)))sessions.push({pid,tty:m[2],cwd,started:m[3],executable});
   }catch{/* A process which cannot be identified is never terminated. */}
  }
  return sessions;
 }
 private async stop(expected:ClaudeTerminalSession){
  if(!expected.started||!expected.executable)throw failure('会话信息已过期，请刷新终端列表。');
  const current=(await this.sessions()).find(s=>s.pid===expected.pid&&s.tty===expected.tty&&s.cwd===expected.cwd&&s.started===expected.started&&s.executable===expected.executable);
  if(!current)throw failure('所选终端会话已变化，未关闭任何程序。请刷新后重试。');
  await this.run('/bin/kill',['-TERM',String(current.pid)]);
  for(let tick=0;(await this.processes()).includes(current.pid);tick++){if(tick===40)throw failure('Claude Code 尚未退出，请在原终端结束任务后重试。未强制结束进程。');await this.wait();}
 }
 private async launch(session?:ClaudeTerminalSession){
  const installed=await this.installation();
  const executable=session?.executable??installed.path;
  if(!executable||!await this.verified(executable))throw failure('未能确认 Claude Code 安装位置，请先安装官方客户端。');
  const cwd=session?.cwd??homedir();
  const javascript=/\.[cm]?js$/i.test(executable);
  if(this.platform==='win32'){
   const command=`$env:CLAUDE_CONFIG_DIR=${psQuote(this.configDir)};${javascript?"$env:ELECTRON_RUN_AS_NODE='1';":''}Set-Location -LiteralPath ${psQuote(cwd)};& ${javascript?`${psQuote(process.execPath)} `:''}${psQuote(executable)}${session?' --resume':''}`;
   const script=`Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-NoProfile','-EncodedCommand','${Buffer.from(command,'utf16le').toString('base64')}')`;
   await this.run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]);
  }else{
   const command=`cd -- ${quote(cwd)} && env CLAUDE_CONFIG_DIR=${quote(this.configDir)} ${javascript?`ELECTRON_RUN_AS_NODE=1 ${quote(process.execPath)} `:''}${quote(executable)}${session?' --resume':''}`;
   if(this.platform==='darwin')await this.run('/usr/bin/osascript',['-e',`tell application id "com.apple.Terminal" to do script ${JSON.stringify(command)}`]);
   else if(this.platform==='linux'){
    let terminal:string|undefined;for(const name of ['x-terminal-emulator','gnome-terminal','konsole','xterm'])try{const found=(await this.run('/usr/bin/which',[name])).stdout.trim();if(found.startsWith('/')){terminal=found;break;}}catch{}
    if(!terminal)throw failure('配置已保存。未找到图形终端，请在原终端重新运行 claude。');
    const args=terminal.endsWith('gnome-terminal')?['--','/bin/sh','-c',command]:['-e','/bin/sh','-c',command];
    if(this.options.launch)await this.options.launch(terminal,args);else await new Promise<void>((resolve,reject)=>{const child=spawn(terminal!,args,{detached:true,stdio:'ignore'});child.once('error',()=>reject(failure('终端未能打开，请手动运行 claude。')));child.once('spawn',()=>{child.unref();resolve();});});
   }else throw failure('此系统请在原终端重新运行 Claude Code。');
  }
 }
 async restart(expected?:ClaudeTerminalSession){return this.change(async()=>{},expected,false);}
 async change(work:()=>Promise<unknown>,expected?:ClaudeTerminalSession,allMustExit=true){
  if(this.busy)throw failure('Claude Code 终端正在处理，请稍候。');this.busy=true;
  let saved=false;
  try{
   const installed=await this.installation();if(!installed.installed||!installed.path||!await this.verified(installed.path))throw failure('未找到可确认的 Claude Code 安装，请先安装官方客户端。');
   const pids=await this.processes();
   if(!expected&&pids.length){const sessions=await this.sessions();if(sessions.length===1&&pids.length===1)expected=sessions[0];else throw failure('请先退出其他 Claude Code 终端、后台任务或 IDE 会话，再重试。Windows 终端需在原窗口手动退出，未关闭任何窗口。');}
   if(allMustExit&&pids.some(pid=>pid!==expected?.pid))throw failure('其他 Claude Code 会话仍在运行，请先退出，未修改登录。');
   if(expected)await this.stop(expected);
   if(allMustExit&&(await this.processes()).length)throw failure('Claude Code 又有会话运行，请退出后重试。未修改登录。');
   await work();saved=true;await this.launch(expected);
   return {message:expected?'已在原目录打开 Claude Code 续聊选择，请选择原对话。':'已在终端打开 Claude Code，请确认账号和模型。'};
  }catch(error){if(saved)throw failure(`配置已处理，原登录备份保留；重新打开未确认。${error instanceof Error?error.message:'请手动运行 claude。'}`);throw error;}
  finally{this.busy=false;}
 }
}
