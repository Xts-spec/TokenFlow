import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
const exec=promisify(execFile);
type Run=(file:string,args:string[])=>Promise<{stdout:string}>;
const failure=(message:string)=>Object.assign(new Error(message),{statusCode:409});
export type ClaudeTerminalSession={pid:number;tty:string;cwd:string};
const shellQuote=(value:string)=>`'${value.replaceAll("'","'\\''")}'`;
const appleString=(value:string)=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
export class ClaudeTerminalLifecycle{
 private busy=false;
 constructor(private run:Run=(file,args)=>exec(file,args,{timeout:15000,maxBuffer:1024*1024}),private platform=process.platform,private wait=()=>delay(250)){}
 private async processes(){
  const {stdout}=await this.run('/bin/ps',['-axo','pid=,tty=,comm=']);
  return stdout.split('\n').flatMap(line=>{const match=line.trim().match(/^(\d+)\s+(ttys\d+)\s+(.+)$/);return match&&/(?:^|\/)claude$/.test(match[3])?[{pid:Number(match[1]),tty:match[2]}]:[];});
 }
 async sessions():Promise<ClaudeTerminalSession[]>{
  if(this.platform!=='darwin')return [];
  const sessions=[];
  for(const process of await this.processes())try{
   const {stdout}=await this.run('/usr/sbin/lsof',['-a','-p',String(process.pid),'-d','cwd','-Fn']);
   const cwd=stdout.split('\n').find(line=>line.startsWith('n/'))?.slice(1);
   if(cwd&&!/[\r\n\x00]/.test(cwd))sessions.push({...process,cwd});
  }catch{/* A session may have exited between reads. */}
  return sessions;
 }
 async restart(expected:ClaudeTerminalSession){
  if(this.platform!=='darwin')throw failure('此系统请在原终端退出并重新运行 Claude Code。');
  if(this.busy)throw failure('Claude Code 终端正在重启，请稍候。');
  this.busy=true;
  try{
   const current=(await this.sessions()).find(session=>session.pid===expected.pid&&session.tty===expected.tty&&session.cwd===expected.cwd);
   if(!current)throw failure('所选终端会话已变化，请刷新会话列表后重试。');
   // Graceful termination only; never escalate to SIGKILL or terminate a terminal/IDE.
   await this.run('/bin/kill',['-TERM',String(current.pid)]);
   for(let i=0;;i++){
    if(!(await this.processes()).some(session=>session.pid===current.pid))break;
    if(i===40)throw failure('Claude Code 尚未退出，请在原终端结束任务后重试。未强制结束进程。');
    await this.wait();
   }
   // Resume picker lets the user choose the exact conversation, including when several share a directory.
   const command=`cd -- ${shellQuote(current.cwd)} && claude --resume`;
   await this.run('/usr/bin/osascript',['-e',`tell application id "com.apple.Terminal" to do script ${appleString(command)}`]);
   return {message:'原 Claude Code 进程已退出，已在新终端启动续聊选择。请选择原对话；若终端提示找不到 claude，请检查终端 PATH。'};
  }finally{this.busy=false;}
 }
}
