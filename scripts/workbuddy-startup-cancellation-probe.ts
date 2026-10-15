// No real credentials or paid inference: exercise cancellation during SDK startup.
import {pathToFileURL} from 'node:url';
const runtimePath=process.env.PROBE_RUNTIME??resolve('packages/codebuddy-runtime/index.js');
const {runOfficialSDK}=await import(pathToFileURL(runtimePath).href) as typeof import('../packages/codebuddy-runtime/index.js');
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';import {AsyncLocalStorage} from 'node:async_hooks';
const require=createRequire(runtimePath);
const {ProcessTransport}=require(resolve(require.resolve('@tencent-ai/agent-sdk'),'../transport/process-transport.js'));
const scope=new AsyncLocalStorage<number>();const children:any[]=[];
const start=ProcessTransport.prototype.start;
ProcessTransport.prototype.start=function(){
 const wasClosed=this.closed,previous=this.process;
 const result=start.call(this);
 if(this.process&&this.process!==previous)children.push({request:scope.getStore(),startedAfterClose:wasClosed,child:this.process});
 return result;
};
const root=await mkdtemp(join(tmpdir(),'tf-sdk-startup-cancel-'));
try{
 const results=await Promise.all([0,1,50,250].flatMap(ms=>Array.from({length:4},(_,worker)=>({ms,worker}))).map(async({ms,worker},request)=>{
  const cwd=join(root,String(request));await mkdir(cwd);const controller=new AbortController();if(ms===0)controller.abort();
  const timer=ms>0?setTimeout(()=>controller.abort(),ms):undefined;const begin=Date.now();const events:any[]=[];
  try{await scope.run(request,()=>runOfficialSDK({token:'invalid-isolated-startup-probe',region:'china',model:'hy4-preview',prompt:'No tools',tools:[],signal:controller.signal,cwd,configDir:cwd,onDiagnostic:e=>events.push(e)}));return {request,ms,worker,unexpectedSuccess:true};}
  catch{return {request,ms,worker,cancelled:true,elapsedMs:Date.now()-begin,closed:events.some(e=>e.event==='closed')};}
  finally{clearTimeout(timer);}
 }));
 const processes=children.map(({request,startedAfterClose,child})=>({request,startedAfterClose,exited:child.exitCode!==null||child.signalCode!==null}));
 const report={results,processes,passed:results.every(r=>r.cancelled&&r.elapsedMs!<3000)&&processes.every(p=>!p.startedAfterClose&&p.exited)};
 console.log(JSON.stringify(report));if(process.env.PROBE_REPORT)await writeFile(process.env.PROBE_REPORT,JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}finally{ProcessTransport.prototype.start=start;for(const {child} of children)if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await rm(root,{recursive:true,force:true});}
