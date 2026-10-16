/** Standalone diagnostic entry; the desktop app uses the same recorder. */
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {CodexReconciliationRecorder} from '../packages/core/src/codex-reconciliation.js';
export {CodexReconciliationRecorder,dateInZone} from '../packages/core/src/codex-reconciliation.js';

async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 if(args.includes('--help')){console.log('Usage: node --import tsx scripts/codex-reconciliation-record.ts --data-root PATH (--watch | --once) [--output PATH] [--codex-home PATH] [--since ISO_TIMESTAMP] [--timezone Asia/Shanghai] [--official-binary PATH]\nAppends sanitized request revisions to an ignored private project journal. Default window starts now; restarting the same output resumes it. Official snapshots are optional every 15 minutes. Stop with Ctrl+C.');return;}
 const root=arg('--data-root');if(!root||args.includes('--watch')===args.includes('--once'))throw Error('Provide data root and exactly one of --watch or --once');
 const recorder=await CodexReconciliationRecorder.open({output:arg('--output')??resolve('artifacts/codex-reconciliation'),codexHome:arg('--codex-home')??join(homedir(),'.codex'),dataRoot:root,since:arg('--since'),timezone:arg('--timezone')});
 let stop=false,wake:undefined|(()=>void),officialAt=0;const signal=()=>{stop=true;wake?.();};process.once('SIGINT',signal);process.once('SIGTERM',signal);
 try{do{const snapshot=await recorder.scan();console.log(JSON.stringify({status:'recording',at:snapshot.at,added:snapshot.added,revised:snapshot.revised,uniqueResponses:snapshot.uniqueResponses,currentLogin:snapshot.currentLogin.status}));const binary=arg('--official-binary');if(binary&&Date.now()-officialAt>=15*60000){await recorder.officialSnapshot(binary);officialAt=Date.now();}if(args.includes('--once')||stop)break;await new Promise<void>(done=>{const timer=setTimeout(()=>{wake=undefined;done();},60000);wake=()=>{clearTimeout(timer);wake=undefined;done();};});}while(!stop);}
 finally{await recorder.close(Date.now(),stop?'signal':args.includes('--once')?'once':'scan-failed');process.removeListener('SIGINT',signal);process.removeListener('SIGTERM',signal);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error(JSON.stringify({status:'unavailable',note:'Recorder could not continue; existing source files and journal are preserved. Check arguments, output ownership, permissions and whether another recorder is running.'}));process.exitCode=1;});
