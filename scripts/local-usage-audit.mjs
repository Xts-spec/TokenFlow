import {Worker} from 'node:worker_threads';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
const root=resolve('artifacts/local-usage-audit-20261013');await mkdir(root,{recursive:true});
const userRoot=join(homedir(),'Library/Application Support/desktop-browser-agent');
const previous=JSON.parse(await readFile(join(userRoot,'local-usage-index.json'),'utf8'));
try{const traces=JSON.parse(await readFile(join(userRoot,'gateway-traces.json'),'utf8'));await writeFile(join(root,'gateway-traces.json'),JSON.stringify({version:1,salt:traces.salt,records:traces.records.map(({keyId,responseRef,responseHash})=>({keyId,responseRef,responseHash}))}),{mode:0o600});}catch{}
const sources=Object.fromEntries(Object.entries({codex:['.codex/sessions','.codex/archived_sessions'],claude:['.claude/projects'],qoder:['.qoder/projects'],workbuddy:['.workbuddy/projects'],pi:['.pi/agent/sessions'],deepseek:['.dsh/sessions']}).map(([k,paths])=>[k,paths.map(p=>join(homedir(),p))]));
const worker=new Worker(new URL('../dist/local-usage-worker.js',import.meta.url),{workerData:{root,gatewayPorts:[9527,8317],sources}});
worker.on('error',e=>{console.error(e);process.exitCode=1;});
worker.on('message',async report=>{if(report.scanning)return;await worker.terminate();
 const current=JSON.parse(await readFile(join(root,'local-usage-index.json'),'utf8'));
 const amount=rows=>rows.reduce((n,r)=>n+r.inputTokens+r.outputTokens,0),byChannel=rows=>Object.fromEntries(['official','api','unknown'].map(k=>[k,amount(rows.filter(r=>r.channel===k))]));
 let unchangedFiles=0,previousTokens=0,currentTokens=0,unknownBefore=0,unknownAfter=0,officialBefore=0,officialAfter=0,apiBefore=0,apiAfter=0;
 for(const[id,e]of Object.entries(current.files)){const old=previous.files[id];if(!old||old.stamp!==e.stamp)continue;unchangedFiles++;const before=byChannel(old.rows),after=byChannel(e.rows);previousTokens+=amount(old.rows);currentTokens+=amount(e.rows);unknownBefore+=before.unknown;unknownAfter+=after.unknown;officialBefore+=before.official;officialAfter+=after.official;apiBefore+=before.api;apiAfter+=after.api;}
 const result={checkedAt:new Date().toISOString(),coverage:report.coverage,channels:byChannel(report.rows),tokens:amount(report.rows),unchangedFilesComparison:{files:unchangedFiles,previousTokens,currentTokens,removedDuplicateTokens:previousTokens-currentTokens,unknownBefore,unknownAfter,officialBefore,officialAfter,apiBefore,apiAfter},rawMessagesStored:false};
 await writeFile(join(root,'report.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
});
