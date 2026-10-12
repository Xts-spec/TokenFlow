import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {setTimeout as delay} from 'node:timers/promises';

const exec=promisify(execFile);
const failure=(message:string)=>Object.assign(new Error(message),{statusCode:409});
type Run=(file:string,args:string[])=>Promise<{stdout:string}>;

const apps={
 qoder:{name:'Qoder',bundle:'com.qoder.app',executables:['/Qoder.app/Contents/MacOS/Qoder']},
 codex:{name:'Codex',bundle:'com.openai.codex',executables:['/Codex.app/Contents/MacOS/Codex','/ChatGPT.app/Contents/MacOS/ChatGPT']},
 workbuddy:{name:'WorkBuddy',bundle:'com.tencent.workbuddy.mac',executables:['/WorkBuddy.app/Contents/MacOS/Electron']},
 claude:{name:'VS Code',bundle:'com.microsoft.VSCode',executables:['/Visual Studio Code.app/Contents/MacOS/Electron']},
} as const;
export type RestartTarget=keyof typeof apps;
// Only fixed application identities may be quit or opened.

export class AgentLifecycle {
  private busy=false;
  private app:typeof apps[RestartTarget]=apps.qoder;
  constructor(private run:Run=(file,args)=>exec(file,args,{timeout:file==='/usr/bin/open'?5000:15000,maxBuffer:1024*1024}),private platform=process.platform,private wait:()=>Promise<unknown>=()=>delay(250)){}
  private async running(){
    const {stdout}=await this.run('/bin/ps',['-axo','comm=']);
    return stdout.split('\n').some(line=>this.app.executables.some(path=>line.trim().endsWith(path)));
  }
  private async until(running:boolean){
    for(let i=0;i<40;i++){if(await this.running()===running)return;await this.wait();}
    throw failure(running?`${this.app.name} 启动尚未确认，请手动打开后检查模型列表。`:`${this.app.name} 尚未退出，请处理它的保存或退出提示后重试。未强制结束进程。`);
  }
  async restart(target:RestartTarget='qoder'){
    if(this.platform!=='darwin')throw failure('当前系统请完全退出并重新打开对应 Agent。');
    if(this.busy)throw failure('Agent 正在重启，请稍候。');
    this.busy=true;this.app=apps[target];
    try{
      if(await this.running()){
        try{await this.run('/usr/bin/osascript',['-e',`tell application id "${this.app.bundle}" to quit`]);}
        catch{throw failure(`${this.app.name} 未完成退出，请处理保存提示或手动退出后重试。未强制结束进程。`);}
        await this.until(false);
      }
      // LaunchServices can still consider the old app terminating after its process exits.
      for(let attempt=0;attempt<3;attempt++){
        try{await this.run('/usr/bin/open',['-b',this.app.bundle]);break;}
        catch{
          if(attempt===2)throw failure(`无法打开 ${this.app.name}，请确认已安装，或手动打开。`);
          for(let tick=0;tick<4;tick++)await this.wait();
        }
      }
      await this.until(true);
      return {message:target==='qoder'?'Qoder 已重新打开，请在「模型 → 自定义」选择 token-flow 模型。':`${this.app.name} 已重新打开，请确认模型选择。`};
    }finally{this.busy=false;}
  }
}

// Keep the existing Qoder integration compatible.
export {AgentLifecycle as QoderLifecycle};
