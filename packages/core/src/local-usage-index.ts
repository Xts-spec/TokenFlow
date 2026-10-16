import {Worker} from 'node:worker_threads';
import {dirname,join} from 'node:path';
import type {AgentPaths} from './agent-connections.js';
import type {LocalUsageSnapshot} from './local-usage.js';
import {deepseekHome} from './deepseek-config.js';
export class LocalUsageIndex{
 private worker?:Worker;private state:LocalUsageSnapshot={rows:[],coverage:[],scanning:false};private last=0;private closed=false;
 constructor(private root:string,private paths:AgentPaths,private gatewayPorts:()=>number[]=()=>[]){}
 snapshot(){
  if(!this.closed&&!this.worker){this.state.scanning=true;this.worker=new Worker(new URL(import.meta.url.endsWith('.ts')?'./local-usage-worker.ts':'./local-usage-worker.js',import.meta.url),{workerData:{root:this.root,gatewayPorts:this.gatewayPorts(),sources:{codex:[join(dirname(this.paths.codex),'sessions'),join(dirname(this.paths.codex),'archived_sessions')],claude:[join(dirname(this.paths.claude),'projects')],qoder:[join(dirname(this.paths.qoder),'projects')],workbuddy:[join(dirname(this.paths.workbuddy),'projects')],pi:[join(dirname(this.paths.pi),'sessions')],deepseek:[join(deepseekHome(this.paths.deepseek),'sessions')]}},...(import.meta.url.endsWith('.ts')?{execArgv:['--import','tsx/esm']}:{})});
   this.worker.on('message',(state:LocalUsageSnapshot)=>{this.state=state;});this.worker.on('error',()=>{this.state={...this.state,scanning:false,warning:'本机用量索引暂不可用。'};});this.worker.unref();this.last=Date.now();
  }else if(this.worker&&Date.now()-this.last>60000&&!this.state.scanning){this.last=Date.now();this.worker.postMessage('refresh');}
  return this.state;
 }
 async close(){this.closed=true;await this.worker?.terminate();}
}
