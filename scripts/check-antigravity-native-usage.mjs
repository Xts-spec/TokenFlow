// Read-only production Worker check. Only counters and coverage leave this process.
import {Worker} from 'node:worker_threads';
import {mkdtemp,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
const root=await mkdtemp(join(tmpdir(),'tf-antigravity-native-check-'));
const sources={codex:[join(root,'no-codex','sessions')],antigravity:process.argv.slice(2).length?process.argv.slice(2).map(p=>resolve(p)):['antigravity-ide','antigravity'].map(name=>join(homedir(),'.gemini',name,'conversations'))};
let worker;
try{
 const snapshot=await new Promise((resolve,reject)=>{worker=new Worker(new URL('../dist/local-usage-worker.js',import.meta.url),{workerData:{root,sources}});const timer=setTimeout(()=>reject(Error('Native usage scan timed out')),15000);worker.on('message',state=>{if(!state.scanning){clearTimeout(timer);resolve(state);}});worker.on('error',error=>{clearTimeout(timer);reject(error);});});
 const rows=snapshot.rows.filter(row=>row.target==='antigravity'),sum=field=>rows.reduce((n,r)=>n+(r[field]??0),0);
 console.log(JSON.stringify({coverage:snapshot.coverage.find(c=>c.target==='antigravity'),requests:sum('requests'),inputTokens:sum('inputTokens'),cachedTokens:sum('cachedTokens'),outputTokens:sum('outputTokens'),models:[...new Set(rows.map(row=>row.model))],unattributedRequests:rows.filter(r=>!r.nativeAccountId).reduce((n,r)=>n+r.requests,0)},null,2));
 if(snapshot.warning||snapshot.coverage.find(c=>c.target==='antigravity')?.status!=='ready')process.exitCode=1;
}finally{await worker?.terminate();await rm(root,{recursive:true,force:true});}
