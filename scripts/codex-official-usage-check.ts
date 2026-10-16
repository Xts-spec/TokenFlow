/** Read-only diagnostic entry; shared with the desktop recorder. */
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {nativeIdentity} from '../packages/core/src/local-usage.js';
import {readNativeLoginIntervals} from '../packages/core/src/native-usage-logins.js';
import {readOfficialUsage,safeOfficialUsage} from '../packages/core/src/codex-official-usage.js';
export {readOfficialUsage,safeOfficialUsage} from '../packages/core/src/codex-official-usage.js';
async function main(){
 const args=process.argv.slice(2),arg=(name:string)=>{const i=args.indexOf(name);return i<0?undefined:args[i+1];};
 const binary=arg('--binary'),day=arg('--day'),root=arg('--data-root');
 if(!args.includes('--check')||!binary||!day||!/^\d{4}-\d{2}-\d{2}$/.test(day))throw Error('Usage: --check --binary PATH --day YYYY-MM-DD [--data-root PATH]');
 const result=await readOfficialUsage(resolve(binary)),intervals=root?await readNativeLoginIntervals(resolve(root)):[];
 const latest=intervals.filter(i=>i.provider==='codex').sort((a,b)=>b.to-a.to)[0];
 console.log(JSON.stringify({checkedAt:new Date().toISOString(),method:'account/usage/read',...safeOfficialUsage(result.usage,day),emailMatchesLatestObservedCodex:latest?.email&&result.email?nativeIdentity('email',result.email.trim().toLowerCase())===latest.email:null},null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))void main().catch(()=>{console.error(JSON.stringify({status:'unavailable',note:'Official usage check failed; no raw RPC, identity or credentials emitted.'}));process.exitCode=1;});
