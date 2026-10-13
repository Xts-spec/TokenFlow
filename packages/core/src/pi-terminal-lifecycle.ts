import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {homedir} from 'node:os';
import {dirname} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {agentProcesses} from './agent-connections.js';
import {detectAgent,type AgentInstallation} from './agent-installation.js';
import type {ClaudeTerminalSession} from './claude-terminal-lifecycle.js';
const exec=promisify(execFile);
type Run=(file:string,args:string[])=>Promise<{stdout:string}>;
const quote=(s:string)=>`'${s.replaceAll("'","'\\''")}'`;
const apple=(s:string)=>JSON.stringify(s);
const failure=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export class PiTerminalLifecycle{
 private busy=false;
 constructor(private configPath:string,private run:Run=(file,args)=>exec(file,args,{timeout:15000,maxBuffer:1024*1024,windowsHide:true}),private platform=process.platform,private processes=()=>agentProcesses('pi'),private installation:()=>Promise<AgentInstallation>=()=>detectAgent('pi'),private wait=()=>delay(250)){}
 async sessions():Promise<ClaudeTerminalSession[]>{
  if(this.platform!=='darwin')return [];
  const pids=new Set(await this.processes());if(!pids.size)return [];
  const {stdout}=await this.run('/bin/ps',['-axo','pid=,tty=,comm=']);const result:ClaudeTerminalSession[]=[];
  for(const line of stdout.split('\n')){
   const m=line.trim().match(/^(\d+)\s+(ttys\d+)\s+/);if(!m||!pids.has(Number(m[1])))continue;
   try{const data=await this.run('/usr/sbin/lsof',['-a','-p',m[1],'-d','cwd','-Fn']);const cwd=data.stdout.split('\n').find(s=>s.startsWith('n/'))?.slice(1);if(cwd&&!/[\r\n\x00]/.test(cwd))result.push({pid:Number(m[1]),tty:m[2],cwd});}catch{/* Session ended during discovery. */}
  }
  return result;
 }
 async restart(expected?:ClaudeTerminalSession,model?:string){
  if(!['darwin','win32'].includes(this.platform))throw failure('请在原终端退出并重新启动官方 Pi。');
  if(this.busy)throw failure('Pi 终端正在重启，请稍候。');this.busy=true;
  try{
   const installed=await this.installation();if(!installed.installed||!installed.path)throw failure('未找到官方 Pi，请先安装。');
   const current=await this.sessions();
   if(expected&&!current.some(s=>s.pid===expected.pid&&s.tty===expected.tty&&s.cwd===expected.cwd))throw failure('所选 Pi 会话已变化，请刷新会话列表后重试。');
   const pids=await this.processes();if(!expected&&pids.length)throw failure('Pi 正在运行，请选择原终端会话，或在原终端结束任务后重试。');
   if(expected){
    await this.run('/bin/kill',['-TERM',String(expected.pid)]);
    for(let i=0;(await this.processes()).includes(expected.pid);i++){if(i===40)throw failure('Pi 尚未退出，请在原终端结束任务后重试。未强制结束进程。');await this.wait();}
   }
   const cwd=expected?.cwd??homedir(),config=dirname(this.configPath);
   if(this.platform==='darwin'){
    const command=`cd -- ${quote(cwd)} && env PI_CODING_AGENT_DIR=${quote(config)} ${quote(installed.path)}${model?` --provider token-flow --model ${quote(model)}`:''}${expected?' --resume':''}`;
    await this.run('/usr/bin/osascript',['-e',`tell application id "com.apple.Terminal" to do script ${apple(command)}`]);
   }else{
    const psQuote=(value:string)=>`'${value.replaceAll("'","''")}'`;
    const command=`$env:PI_CODING_AGENT_DIR=${psQuote(config)}; Set-Location -LiteralPath ${psQuote(cwd)}; & ${psQuote(installed.path)}${model?` --provider 'token-flow' --model ${psQuote(model)}`:''}`;
    const script=`Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit','-NoProfile','-EncodedCommand','${Buffer.from(command,'utf16le').toString('base64')}')`;
    await this.run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')]);
   }
   return {message:expected?'官方 Pi 已在原目录重新打开，请从续聊列表选择原对话。':'已在终端打开官方 Pi，将加载已保存的模型配置。'};
  }finally{this.busy=false;}
 }
}
