import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import assert from 'node:assert/strict';
import {connectedConfig} from '../packages/core/src/agent-connections.js';
// The installed desktop's native runtime, isolated config only: no inference requests or real credentials.
const binary='/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-codex-reload-'));const home=join(root,'codex');
await mkdir(home,{recursive:true});
async function readFresh(){
 const child=spawn(binary,['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:home,TMPDIR:process.env.TMPDIR},stdio:['pipe','pipe','pipe']});let seq=0,buffer='';const pending=new Map<number,{resolve:(value:any)=>void;reject:(reason:Error)=>void}>();child.stderr.resume();
 child.stdout.on('data',data=>{buffer+=data;let index;while((index=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+1);let message;try{message=JSON.parse(line);}catch{continue;}const job=pending.get(message.id);if(job){pending.delete(message.id);message.error?job.reject(Error(message.error.message)):job.resolve(message.result);}}});
 const rpc=(method:string,params:unknown)=>new Promise<any>((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});child.stdin.write(JSON.stringify({id,method,params})+'\n');});
 const timeout=setTimeout(()=>{for(const job of pending.values())job.reject(Error('Native config-read timed out'));},15000);
 try{await rpc('initialize',{clientInfo:{name:'token_flow_config_reload',version:'1'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');const result=await rpc('config/read',{includeLayers:false,cwd:root});return result.config;}
 finally{clearTimeout(timeout);child.stdin.end();await new Promise<void>(resolve=>{const stop=setTimeout(()=>child.kill('SIGTERM'),2000);child.once('exit',()=>{clearTimeout(stop);resolve();});});}
}
try{
 for(const model of ['workbuddy/hy4-preview','workbuddy/step-5-preview']){
  await writeFile(join(home,'config.toml'),connectedConfig('codex','approval_policy = "never"\nsandbox_mode = "read-only"\n','http://127.0.0.1:1',model,'fixture-only'),{mode:0o600});
  const config=await readFresh();assert.equal(config.model,model);assert.equal(config.model_provider,'token_flow');console.log(JSON.stringify({nativeCodexConfigReload:'passed',model:config.model,provider:config.model_provider,realDesktopRuntime:true,inferenceRequests:0}));
 }
}finally{await rm(root,{recursive:true,force:true});}
