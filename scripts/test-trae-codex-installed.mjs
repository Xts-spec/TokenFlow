// Opt-in acceptance using the real installed Codex CLI and TokenFlow sidecar.
import {spawn,spawnSync} from 'node:child_process';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {parse} from 'yaml';
import {createServer,request as httpRequest} from 'node:http';
if(process.env.TOKEN_FLOW_TRAE_INSTALLED_LIVE!=='1')throw Error('Set TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 for real account calls.');
const root=resolve('.tmp/trae-codex-acceptance-'+Date.now());
const project=join(root,'project'),clientHome=join(root,'client');
await mkdir(project,{recursive:true});await mkdir(clientHome,{recursive:true});
let cfg=parse(await readFile(join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/config.yaml'),'utf8'));
let upstreamPort=Number(process.env.TOKEN_FLOW_TRAE_ACCEPTANCE_PORT??cfg.port);
// A listening desktop service can precede asynchronous account discovery.
let ready=false;for(let attempt=0;attempt<60;attempt++){try{if(attempt>0){cfg=parse(await readFile(join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/config.yaml'),'utf8'));upstreamPort=Number(process.env.TOKEN_FLOW_TRAE_ACCEPTANCE_PORT??cfg.port);}const r=await fetch(`http://127.0.0.1:${upstreamPort}/v1/models`,{headers:{Authorization:'Bearer '+cfg['api-keys'][0]},signal:AbortSignal.timeout(5000)});const j=await r.json();if(j.data?.some(m=>m.id==='trae/deepseek-v4.1-flash')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Installed TRAE model discovery did not become ready.');
// Observe tool declarations only; never persist headers or credentials.
const declarations=[],searches=[];
const proxy=createServer(async(req,res)=>{const chunks=[];for await(const b of req)chunks.push(b);const body=Buffer.concat(chunks);try{const value=JSON.parse(body);declarations.push(value.tools);await writeFile(join(root,'tool-declarations.json'),JSON.stringify(declarations,null,2));}catch{}const upstream=httpRequest({host:'127.0.0.1',port:upstreamPort,path:req.url,method:req.method,agent:false,headers:{...req.headers,'accept-encoding':'identity'}},r=>{res.writeHead(r.statusCode,r.headers);let wire='';r.on('data',b=>{wire+=b;});r.on('end',()=>{for(const line of wire.split('\n')){if(!line.startsWith('data:'))continue;try{const e=JSON.parse(line.slice(5));if(e.type==='response.output_item.done'&&e.item?.type==='web_search_call')searches.push({status:e.item.status,query:e.item.action?.query,sources:e.item.action?.sources??[]});}catch{}}});r.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(body);});
await new Promise(r=>proxy.listen(0,'127.0.0.1',r));
await writeFile(join(clientHome,'config.toml'),`model = "trae/deepseek-v4.1-flash"\nmodel_provider = "trae_acceptance"\napproval_policy = "never"\nsandbox_mode = "workspace-write"\n[model_providers.trae_acceptance]\nname = "TokenFlow TRAE acceptance"\nbase_url = "http://127.0.0.1:${proxy.address().port}/v1"\nwire_api = "responses"\nenv_key = "TOKEN_FLOW_TRAE_ACCEPTANCE_KEY"\nrequest_max_retries = 0\nstream_max_retries = 0\nstream_idle_timeout_ms = 120000\n`);
const seed='TRAE_CODEX_FIXTURE_7319';await writeFile(join(project,'seed.txt'),seed+'\n');
const common='Only work on files in this temporary project. Never inspect credentials, environment variables or external configuration. Use real shell/file tools, wait for each result before the next dependent step. Do not merely describe tool calls. ';
const longContext=Array.from({length:100},(_,i)=>`Historical case ${i}: ${'Synthetic gateway context for long conversation and multi-round tool acceptance. '.repeat(8)}\n`).join('');
const prompts=[
 common+'First use the provided web search tool to search the query "OpenAI Codex". This web search must actually run; do not use shell/network commands or remembered knowledge in place of it. Then read seed.txt using a tool. Then use a separate tool call to create round1.txt containing the exact seed plus |ROUND1. Then use a third tool call to read round1.txt and verify it. Keep the seed and search findings in conversation memory for later continuation. Final answer exactly TRAE_CODEX_ROUND1_OK.\n\nSynthetic long context follows (background only):\n'+longContext,
 common+'Continue our existing conversation. First use the provided web search tool to search "TRAE IDE documentation"; do not substitute shell/network commands. Then use a tool to read round1.txt. In a separate call create round2.txt using the remembered seed plus |ROUND2. In a third call read round2.txt to verify it. Final answer exactly TRAE_CODEX_ROUND2_OK.',
 common+'Continue this same conversation again. Read round1.txt and round2.txt using tools. In a separate call create round3.txt with the seed from our first turn plus |ROUND3. Then read round3.txt in another tool call to verify it. Final answer exactly TRAE_CODEX_ROUND3_OK.'
];
const version=spawnSync('codex',['--version'],{encoding:'utf8'}).stdout.trim();
const report={client:version,model:'trae/deepseek-v4.1-flash',endpoint:'installed-sidecar-responses',longContextCharacters:longContext.length,isolatedConfiguration:true,webSearchConfiguration:'Codex default (no override)',rounds:[]};let thread;
for(let i=0;i<prompts.length;i++){
 const args=['exec','-C',project,'--skip-git-repo-check','--json','-o',join(root,`final-${i+1}.txt`)];
 if(thread)args.push('resume',thread,'--skip-git-repo-check','--json','-');else args.push('-');
 const started=Date.now(),searchStart=searches.length;let out='',err='';const child=spawn('codex',args,{cwd:project,env:{...process.env,CODEX_HOME:clientHome,TOKEN_FLOW_TRAE_ACCEPTANCE_KEY:cfg['api-keys'][0]}});
 const timer=setTimeout(()=>child.kill('SIGTERM'),240000);
 child.stdout.on('data',b=>{out+=b;});child.stderr.on('data',b=>{err+=b;});child.stdin.end(prompts[i]);
 const code=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});clearTimeout(timer);
 await writeFile(join(root,`round-${i+1}.jsonl`),out);await writeFile(join(root,`round-${i+1}.stderr`),err);
 const events=out.split('\n').flatMap(line=>{try{return [JSON.parse(line)];}catch{return [];}});
 thread??=events.find(e=>e.type==='thread.started')?.thread_id;
 const tools=events.filter(e=>e.type==='item.completed'&&e.item?.type==='command_execution');
 const errors=events.filter(e=>e.type==='error'||e.type==='turn.failed');
 const final=await readFile(join(root,`final-${i+1}.txt`),'utf8').catch(()=>'');
 const fixture=await readFile(join(project,`round${i+1}.txt`),'utf8').catch(()=>'');
 const roundSearches=searches.slice(searchStart),searchPassed=i===2||roundSearches.some(s=>s.status==='completed'&&s.sources.length>0);
 const passed=code===0&&errors.length===0&&tools.length>=3&&searchPassed&&final.trim()===`TRAE_CODEX_ROUND${i+1}_OK`&&fixture.trim()===seed+`|ROUND${i+1}`;
 const clientSearches=events.filter(e=>e.type==='item.completed'&&e.item?.type==='web_search');
 const row={round:i+1,resumed:i>0,exitCode:code,toolsCompleted:tools.length,clientSearches:clientSearches.length,searches:roundSearches,durationMs:Date.now()-started,passed,final:final.trim(),...(errors.length?{errors}:{}),...(!passed?{diagnosticsRoot:root}:{} )};report.rounds.push(row);console.log(JSON.stringify(row));if(!passed)break;
}
report.passed=report.rounds.length===3&&report.rounds.every(r=>r.passed);
await writeFile(process.env.TOKEN_FLOW_TRAE_INSTALLED_REPORT??join(root,'report.json'),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,diagnosticsRoot:root}));if(!report.passed)process.exitCode=1;
proxy.close();proxy.closeAllConnections();
