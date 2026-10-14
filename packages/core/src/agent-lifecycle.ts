import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';
import {desktopCandidates} from './agent-installation.js';

const exec=promisify(execFile);
const failure=(message:string)=>Object.assign(new Error(message),{statusCode:409});
type Run=(file:string,args:string[])=>Promise<{stdout:string}>;
// Windows process image names (without .exe). Claude Code is a terminal program and has no desktop restart.
const psQuote=(value:string)=>`'${value.replaceAll("'","''")}'`;
const powershell=(script:string)=>['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')];

const apps={
 qoder:{name:'Qoder',bundle:'com.qoder.app',executables:['/Qoder.app/Contents/MacOS/Qoder'],image:'Qoder'},
 codex:{name:'Codex',bundle:'com.openai.codex',executables:['/Codex.app/Contents/MacOS/Codex','/ChatGPT.app/Contents/MacOS/ChatGPT'],image:'Codex'},
 workbuddy:{name:'WorkBuddy',bundle:'com.tencent.workbuddy.mac',executables:['/WorkBuddy.app/Contents/MacOS/Electron'],image:'WorkBuddy'},
 claude:{name:'VS Code',bundle:'com.microsoft.VSCode',executables:['/Visual Studio Code.app/Contents/MacOS/Electron']},
 deepseek:{name:'DeepSeek Harness',bundle:'com.deepseek.dsh',executables:['/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness'],image:'DeepSeek Harness'},
} as const;
export type RestartTarget=keyof typeof apps;
// Only fixed application identities may be quit or opened.

export class AgentLifecycle {
  private busy=false;
  private app:typeof apps[RestartTarget]=apps.qoder;
  private target:RestartTarget='qoder';
  constructor(private run:Run=(file,args)=>exec(file,args,{timeout:file==='/usr/bin/open'?5000:15000,maxBuffer:1024*1024,windowsHide:true}),private platform=process.platform,private wait:()=>Promise<unknown>=()=>delay(250)){}
  private image(){return 'image' in this.app?this.app.image:undefined;}
  private async running(){
    if(this.platform==='win32'){
      const image=`${this.image()}.exe`;
      const {stdout}=await this.run('tasklist',['/FI',`IMAGENAME eq ${image}`,'/FO','CSV','/NH']);
      return stdout.split('\n').some(line=>line.trim().toLowerCase().startsWith(`"${image.toLowerCase()}"`));
    }
    const {stdout}=await this.run('/bin/ps',['-axo','comm=']);
    return stdout.split('\n').some(line=>this.app.executables.some(path=>line.trim().endsWith(path)));
  }
  private async until(running:boolean){
    for(let i=0;i<40;i++){if(await this.running()===running)return;await this.wait();}
    throw failure(running?`${this.app.name} 启动尚未确认，请手动打开后检查模型列表。`:`${this.app.name} 尚未退出，请处理它的保存或退出提示后重试${this.platform==='win32'?'；如果它最小化在系统托盘，请先从托盘菜单退出':''}。未强制结束进程。`);
  }
  /** Ask the application's own windows to close. Windows never receives a forced termination. */
  private async quit(){
    if(this.platform!=='win32'){await this.run('/usr/bin/osascript',['-e',`tell application id "${this.app.bundle}" to quit`]);return [];}
    const script=`$list=@(Get-Process -Name ${psQuote(this.image()!)} -ErrorAction SilentlyContinue)
$paths=@($list|ForEach-Object{try{$_.Path}catch{}}|Where-Object{$_}|Select-Object -Unique)
foreach($p in $list){if($p.MainWindowHandle -ne 0){[void]$p.CloseMainWindow()}}
ConvertTo-Json -Compress -InputObject @($paths)`;
    const {stdout}=await this.run('powershell.exe',powershell(script));
    try{const paths=JSON.parse(stdout.trim()||'[]');return Array.isArray(paths)?paths.filter((path):path is string=>typeof path==='string'):[];}
    catch{return [];}
  }
  private async open(paths:string[]){
    if(this.platform!=='win32'){await this.run('/usr/bin/open',['-b',this.app.bundle]);return;}
    // Prefer the path the running app actually used, then the standard install roots, then the Start menu entry (also covers Microsoft Store apps).
    const known=[...paths,...desktopCandidates(this.target,'win32')];
    const script=`$paths=@(${known.map(psQuote).join(',')})
foreach($p in $paths){if($p -and $p -notlike '*\\WindowsApps\\*' -and (Test-Path -LiteralPath $p -PathType Leaf)){Start-Process -FilePath $p;exit 0}}
$a=Get-StartApps|Where-Object{$_.Name -eq ${psQuote(this.app.name)}}|Select-Object -First 1
if($a){Start-Process -FilePath 'explorer.exe' -ArgumentList ('shell:AppsFolder\\'+$a.AppID);exit 0}
exit 3`;
    await this.run('powershell.exe',powershell(script));
  }
  async restart(target:RestartTarget='qoder'){
    if(!['darwin','win32'].includes(this.platform)||this.platform==='win32'&&!('image' in apps[target]))throw failure('当前系统请完全退出并重新打开对应 Agent。');
    if(this.busy)throw failure('Agent 正在重启，请稍候。');
    this.busy=true;this.app=apps[target];this.target=target;
    try{
      let paths:string[]=[];
      if(await this.running()){
        try{paths=await this.quit();}
        catch{throw failure(`${this.app.name} 未完成退出，请处理保存提示或手动退出后重试。未强制结束进程。`);}
        await this.until(false);
      }
      // LaunchServices can still consider the old app terminating after its process exits.
      for(let attempt=0;attempt<3;attempt++){
        try{await this.open(paths);break;}
        catch{
          if(attempt===2)throw failure(`无法打开 ${this.app.name}，请确认已安装，或手动打开。`);
          for(let tick=0;tick<4;tick++)await this.wait();
        }
      }
      await this.until(true);
      return {message:target==='qoder'?'Qoder 已重新打开，请在「模型 → 自定义」选择 TokenFlow 模型。':`${this.app.name} 已重新打开，请确认模型选择。`};
    }finally{this.busy=false;}
  }
}

// Keep the existing Qoder integration compatible.
export {AgentLifecycle as QoderLifecycle};
