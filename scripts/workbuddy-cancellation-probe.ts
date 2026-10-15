import {runOfficialSDK} from '../packages/codebuddy-runtime/index.js';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const root=await mkdtemp(join(tmpdir(),'tf-sdk-cancel-'));
const results=await Promise.all(Array.from({length:8},async(_,i)=>{
 const cwd=join(root,String(i));await mkdir(cwd);const start=Date.now();const events:any[]=[];
 try{await runOfficialSDK({token:'invalid-isolated-cancellation-probe',region:'china',model:'glm-5.3',prompt:'Do not execute tools',tools:[],signal:AbortSignal.timeout(250),cwd,configDir:cwd,onDiagnostic:e=>events.push(e)});return {unexpectedSuccess:true};}
 catch(e){return {cancelled:true,elapsedMs:Date.now()-start,closed:events.some(e=>e.event==='closed')};}
}));
console.log(JSON.stringify({results,passed:results.every(r=>r.cancelled&&r.closed&&r.elapsedMs!<10000)}));
await rm(root,{recursive:true,force:true});
