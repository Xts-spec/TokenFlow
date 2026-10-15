// Real pinned SDK + real child-process pipes; a local CLI fixture emits a complete
// tool turn and then stays silent. Does not use any account or upstream inference.
import {pathToFileURL} from 'node:url';
const runtimePath=process.env.PROBE_RUNTIME??resolve('packages/codebuddy-runtime/index.js');
const {runOfficialSDK}=await import(pathToFileURL(runtimePath).href) as typeof import('../packages/codebuddy-runtime/index.js');
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {createRequire} from 'node:module';
const require=createRequire(runtimePath);
const {ProcessTransport}=require(resolve(require.resolve('@tencent-ai/agent-sdk'),'../transport/process-transport.js'));
const start=ProcessTransport.prototype.start;const children:any[]=[];
ProcessTransport.prototype.start=function(){
 this.options.executablePath=resolve('tests/fixtures/codebuddy-tool-turn.mjs');this.options.executable=process.execPath;
 const before=this.process,result=start.call(this);if(this.process&&this.process!==before)children.push(this.process);return result;
};
const root=await mkdtemp(join(tmpdir(),'tf-sdk-handoff-'));
try{
 const results=await Promise.all(Array.from({length:24},async(_,worker)=>{
  const cwd=join(root,String(worker));await mkdir(cwd);const history=Array.from({length:100},(_,step)=>({step,toolResult:'synthetic tool result '.repeat(100)}));
  const rounds=[];
  if(process.env.PROBE_STALL){
   const begin=Date.now();let initialized=false,cancelled=false,closed=false;
   try{await runOfficialSDK({token:'invalid-isolated-fixture',region:'china',model:'test',prompt:JSON.stringify({stall:true}),tools:[],signal:AbortSignal.timeout(2000),cwd,configDir:cwd,onDiagnostic:e=>{if(e.event==='system')initialized=true;if(e.event==='closed')closed=true;}});}catch{cancelled=true;}
   rounds.push({round:-1,elapsedMs:Date.now()-begin,passed:initialized&&cancelled&&closed&&Date.now()-begin<4000});
  }
  for(let round=0;round<4;round++){
   const begin=Date.now();let retries=0;const result=await runOfficialSDK({token:'invalid-isolated-fixture',region:'china',model:'test',prompt:JSON.stringify({step:100+round,history,stallOnce:!!process.env.PROBE_RECOVER}),tools:['first','second'].map(name=>({name,parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}})),signal:AbortSignal.timeout(process.env.PROBE_RECOVER?100000:10000),cwd,configDir:cwd,onDiagnostic:e=>{if(e.event==='idle_retry')retries++;}});
   rounds.push({round,retries,elapsedMs:Date.now()-begin,passed:(!process.env.PROBE_RECOVER||retries===(round===0?1:0))&&!result.failed&&result.calls.length===2&&result.calls.every(c=>JSON.parse(c.arguments).step===100+round)&&result.usage?.input_tokens===100&&result.usage.output_tokens===16});
   history.push({step:100+round,toolResult:'fixture execution result'});
  }
  return {worker,rounds};
 }));
 const summary={concurrency:24,historyTurns:100,rounds:4,requests:process.env.PROBE_STALL?120:96,passed:results.flatMap(r=>r.rounds).filter(r=>r.passed).length,ownedChildren:children.length,allChildrenExited:children.every(p=>p.exitCode!==null||p.signalCode!==null),maxElapsedMs:Math.max(...results.flatMap(r=>r.rounds.map(r=>r.elapsedMs)))};
 console.log(JSON.stringify(summary));await writeFile(process.env.PROBE_REPORT??'artifacts/workbuddy-tool-handoff-probe.json',JSON.stringify({summary,results},null,2));if(summary.passed!==summary.requests||!summary.allChildrenExited)process.exitCode=1;
}finally{ProcessTransport.prototype.start=start;for(const child of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
