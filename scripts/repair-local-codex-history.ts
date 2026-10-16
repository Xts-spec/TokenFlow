// Explicit local maintenance. Stops the desktop before touching saved histories.
// Run detached with --apply --quit-desktop; writes a durable, credential-free report.
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,writeFile,mkdir,stat,rename,readdir} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {parse} from 'smol-toml';
import {AgentConnections,agentProcesses} from '../packages/core/src/agent-connections.js';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
import {CodexContext} from '../packages/core/src/codex-context.js';
import {CodexThreadMigration} from '../packages/core/src/codex-thread-migration.js';
import {codexRuntimeClient} from '../packages/core/src/codex-runtime.js';
const exec=promisify(execFile),pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
const root=join(homedir(),'Library/Application Support/desktop-browser-agent');
const home=join(homedir(),'.codex'),config=join(home,'config.toml');
const output=resolve('artifacts/local-codex-history-repair.json');
const report:any={startedAt:new Date().toISOString(),status:'checking'};
async function save(){await mkdir(resolve('artifacts'),{recursive:true});await writeFile(output+'.tmp',JSON.stringify(report,null,2),{mode:0o600});await rename(output+'.tmp',output);}
function rows(){const db=new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true});try{return db.prepare("SELECT id,model_provider AS provider,model,rollout_path AS rollout,archived FROM threads WHERE model_provider='token_flow'").all();}finally{db.close();}}
const targetThread=process.argv.find(arg=>arg.startsWith('--thread='))?.slice(9);
const apply=process.argv.includes('--apply');
let quit=false;
try{
 const before=await readFile(config,'utf8'),settings=parse(before);
 if(settings.model_provider!=='openai'||typeof settings.model!=='string'||settings.model.includes('/'))throw Error('Expected the currently selected official Codex model; configuration was not changed.');
 const targets=rows();if(targetThread&&!targets.some(row=>row.id===targetThread)){const db=new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true});try{const target=db.prepare('SELECT id,model_provider AS provider,model,rollout_path AS rollout,archived FROM threads WHERE id=?').get(targetThread);if(!target)throw Error('Requested history was not found');targets.push(target);}finally{db.close();}}report.targetThread=targetThread;report.before={provider:settings.model_provider,model:settings.model,threads:targets.length};await save();
 if(!apply){console.log(JSON.stringify(report));process.exit(0);}
 if(!process.argv.includes('--quit-desktop'))throw Error('--quit-desktop is required for offline repair');
 report.status='stopping';await save();quit=true;
 await exec('/usr/bin/osascript',['-e',`tell application ${JSON.stringify(resolve('release/mac-arm64/TokenFlow.app'))} to quit`],{timeout:15000}).catch(()=>{});
 const ensureStopped=async()=>{
 await exec('/usr/bin/osascript',['-e','tell application id "com.openai.codex" to quit'],{timeout:15000}).catch(()=>{});
 for(let i=0;i<80&&(await agentProcesses('codex')).length;i++)await pause(250);
 const remaining=await agentProcesses('codex');
 // Graceful desktop shutdown can leave the bundled app-server orphaned.
 // Terminate only the exact Codex executable identities detected by the app.
 for(const pid of remaining){try{process.kill(pid,'SIGTERM');}catch{}}
 for(let i=0;i<80&&(await agentProcesses('codex')).length;i++)await pause(250);
 if((await agentProcesses('codex')).length)throw Error('Codex did not exit; histories have not been modified.');
  // Wait for shutdown flushes before taking the new preimages.
  await pause(2000);
 };
 await ensureStopped();
 // Catch configuration changes made while the detached worker was starting.
 if(await readFile(config,'utf8')!==before)throw Error('Config changed before repair; stopped without overwriting it.');
 const processes=()=>agentProcesses('codex');
 const connections=new AgentConnections(root,{codex:config},async()=>[]);
 const scopes=((await connections.status()).find(t=>t.id==='codex')?.backups??[]).flatMap(record=>(record.selections??[record]).map(item=>({owner:record.keyId,source:item.sourceId,model:item.model})));
 report.status='repairing';await save();
 const context=new CodexContext(root,config,await GatewayContext.open(root));
 for(let attempt=1;attempt<=3;attempt++){
  report.attempt=attempt;await save();
  try{report.context=await context.prepareOfficial(scopes,async()=>{const pids=await processes();if(pids.length){report.interruptingProcessIds=pids;await save();}return pids;});break;}
  catch(error){
   if(attempt===3||!(error instanceof Error)||!/(重新启动|发生变化|先退出 Codex)/.test(error.message))throw error;
   report.retryReason=error.message;await save();await ensureStopped();
   if(await readFile(config,'utf8')!==before)throw Error('Config changed during repair retry; stopped without overwriting it.');
  }
 }

 if(targetThread){
  const target=targets.find(row=>row.id===targetThread)!;const directory=dirname(String(target.rollout));let invalid=0;
  for(const name of await readdir(directory)){
   if(!name.endsWith('.jsonl')||!name.includes(targetThread))continue;let gateway=false;
   for(const line of (await readFile(join(directory,name),'utf8')).split('\n')){
    if(!line)continue;const row=JSON.parse(line),item=row.payload;
    if(row.type==='session_meta')gateway=item.model_provider==='token_flow';
    if(row.type==='turn_context')gateway=String(item.model).includes('/');
    if(row.type==='response_item'&&gateway&&typeof item.id==='string'&&['message','function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(item.type))invalid++;
   }
  }
  report.targetForeignIdsRemaining=invalid;if(invalid)throw Error('Foreign history item IDs remain after repair');
 }
 const migration=new CodexThreadMigration(root,config,processes);
 report.routes=await migration.restore(settings.model);
 report.status='verifying';await save();
 const client=await codexRuntimeClient(home);let verified=0;const unavailable:string[]=[];
 try{
  for(const row of targets){
   if(!await stat(String(row.rollout)).then(s=>s.isFile()).catch(()=>false)){unavailable.push(String(row.id));continue;}
   if((await processes()).some(pid=>pid!==client.pid))throw Error('Codex reopened during verification; stopped.');
   if(row.archived)await client.rpc('thread/unarchive',{threadId:row.id});
   try{const resumed=await client.rpc('thread/resume',{threadId:row.id});if(resumed.thread?.modelProvider!=='openai'||resumed.model!==settings.model)throw Error('Restored route verification failed');await client.rpc('thread/unsubscribe',{threadId:row.id});verified++;}
   finally{if(row.archived)await client.rpc('thread/archive',{threadId:row.id});}
  }
 }finally{await client.close();}
 if(await readFile(config,'utf8')!==before)throw Error('Config changed during repair');
 report.verifiedThreadIds=targets.filter(row=>!unavailable.includes(String(row.id))).map(row=>String(row.id));report.targetVerified=targetThread?report.verifiedThreadIds.includes(targetThread):undefined;report.verified=verified;report.unavailable=unavailable;report.remaining=rows().map(row=>String(row.id));report.configPreserved=true;
 report.status=unavailable.length?'completed_with_missing_history':'completed';
}catch(e){report.status='failed';report.error=e instanceof Error?e.message:'Repair failed';process.exitCode=1;}
finally{
 report.finishedAt=new Date().toISOString();await save();
 if(quit){await exec('/usr/bin/open',['-a',resolve('release/mac-arm64/TokenFlow.app')]).catch(()=>{});await exec('/usr/bin/open',['-a','/Applications/ChatGPT.app']).then(()=>{report.desktopReopened=true;}).catch(()=>{report.desktopReopened=false;});await save();}
 try{const summaryPath=resolve('artifacts/502-migration-verification.json');const summary=JSON.parse(await readFile(summaryPath,'utf8'));summary.followup={...summary.followup,actualHistoryRepair:report.status,verifiedActualThreads:report.verified,unavailableActualThreads:report.unavailable};await writeFile(summaryPath,JSON.stringify(summary,null,2));}catch{}
 try{const path=resolve('artifacts/codex-history-id-verification.json');const verification=JSON.parse(await readFile(path,'utf8'));verification.actualRepairStatus=report.status;verification.actualTargetVerified=report.targetVerified;verification.actualForeignIdsRemaining=report.targetForeignIdsRemaining;await writeFile(path,JSON.stringify(verification,null,2));}catch{}
 console.log(JSON.stringify(report));
}
