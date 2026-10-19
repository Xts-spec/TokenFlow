// Run: node --import tsx tests/codex-repeated-local-compaction-repro.mjs
// Uses the installed Codex and a loopback-only synthetic Responses server.
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,rm,writeFile,readFile,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parse,stringify} from 'smol-toml';
import {AgentConnections} from '../packages/core/src/agent-connections.ts';
const fixture=await mkdtemp(join(await realpath(tmpdir()),'codex-compact-loop-'));
const cwd=resolve(import.meta.dirname,'..');
const normalInputTokens=Number(process.env.REPRO_INPUT_TOKENS??140000);
const compactScope=process.env.REPRO_COMPACT_SCOPE;
const growth=process.env.REPRO_GROWTH==='1';
const codexBinary=process.env.CODEX_REPRO_BIN??'/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const cliVersion=execFileSync(codexBinary,['--version'],{encoding:'utf8'}).trim();
const omitCatalogLimit=process.env.REPRO_OMIT_CATALOG_LIMIT==='1';
const requests=[],notifications=[],tokenCounts=[];let child,tools=0,serial=0,turnDone;
const server=createServer(async(req,res)=>{
 try{
 let raw='';for await(const c of req)raw+=c;
 assert.equal(req.url,'/v1/responses');const body=JSON.parse(raw);
 // Local compaction appends a user summarization prompt; it is not a tool turn.
 const last=body.input?.at(-1);const lastText=JSON.stringify(last);
 const compact=/CONTEXT CHECKPOINT COMPACTION/.test(lastText);
 const historyGrowthTokens=growth?(body.input??[]).filter(i=>i.type==='function_call_output').reduce((n,i)=>n+(String(i.output).match(/word /g)?.length??0),0):0;
 const reportedInput=compact?14000:normalInputTokens+historyGrowthTokens;
 requests.push({historyGrowthTokens,kind:compact?'local_compact':'normal',bytes:Buffer.byteLength(raw),inputItems:body.input?.length,lastType:last?.type,lastText:lastText.slice(0,280),toolsDone:tools,responseInputTokens:reportedInput});
 const n=++serial;const tool=!compact&&tools<6;if(tool)tools++;
 const item=tool?{id:`fc_${n}`,type:'function_call',call_id:`call_${n}`,name:'exec_command',arguments:JSON.stringify({cmd:growth?`python3 -c "print('word ' * 20000)"`:`printf fixture_read_only_${tools}`,max_output_tokens:growth?24000:32})}:{id:`msg_${n}`,type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:compact?'Checkpoint: Continue the fixture. Execute remaining read-only tool calls, then finish.':'Fixture complete.',annotations:[]}]};
 const input=reportedInput;
 const response={id:`resp_${n}`,object:'response',created_at:Math.floor(Date.now()/1000),model:body.model,status:'completed',output:[item],usage:{input_tokens:input,output_tokens:20,total_tokens:input+20}};
 if(!body.stream){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(response));return;}
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:{message:e.message}}));}
});
try{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const paths=Object.fromEntries(['codex','claude','qoder','workbuddy'].map(n=>[n,join(fixture,n==='codex'?'config.toml':n+'.json')]));
 await writeFile(paths.codex,'');
 const connections=new AgentConnections(fixture,paths,async()=>[]);
 await connections.apply({target:'codex',revision:(await connections.status())[0].revision,origin:`http://127.0.0.1:${server.address().port}`,model:'workbuddy/hy4-preview',sourceId:'b'.repeat(24),keyId:'synthetic-fixture',key:'synthetic-fixture'});
 if(compactScope){const doc=parse(await readFile(paths.codex,'utf8'));doc.model_auto_compact_token_limit_scope=compactScope;await writeFile(paths.codex,stringify(doc));}
 const config=await readFile(paths.codex,'utf8');const catalogPath=config.match(/model_catalog_json\s*=\s*"([^"]+)"/)[1];const catalog=JSON.parse(await readFile(catalogPath,'utf8'));
 if(omitCatalogLimit)for(const model of catalog.models)delete model.auto_compact_token_limit;
 // The production catalog caps each tool output at 10KB; lift only this isolated
 // fixture cap so six real outputs can cross the 65536-token history threshold.
 if(growth)for(const model of catalog.models)model.truncation_policy={mode:'bytes',limit:500000};
 if(omitCatalogLimit||growth)await writeFile(catalogPath,JSON.stringify(catalog));
 child=spawn(codexBinary,['app-server','--listen','stdio://'],{cwd,env:{PATH:process.env.PATH,HOME:fixture,CODEX_HOME:fixture},stdio:['pipe','pipe','pipe']});
 let buffer='',id=0;const pending=new Map();let stderr='';child.stderr.on('data',c=>stderr+=c);
 child.stdout.on('data',c=>{buffer+=c;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method&&(/compact/i.test(m.method)||/compact/i.test(m.params?.item?.type??'')))notifications.push({method:m.method,itemType:m.params?.item?.type});if(m.method==='thread/tokenUsage/updated')tokenCounts.push(m.params.tokenUsage);if(m.method==='turn/completed')turnDone?.(m.params.turn);}});
 const rpc=(method,params)=>new Promise((resolve,reject)=>{const key=++id;const timer=setTimeout(()=>reject(Error('RPC timeout '+method+' '+stderr.slice(-1000))),15000);pending.set(key,{resolve:v=>{clearTimeout(timer);resolve(v)},reject:e=>{clearTimeout(timer);reject(e)}});child.stdin.write(JSON.stringify({id:key,method,params})+'\n');});
 await rpc('initialize',{clientInfo:{name:'local_compact_repro',version:'1.0'}});child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
 const {thread}=await rpc('thread/start',{cwd,approvalPolicy:'never',sandbox:'read-only'});
 let timeout;const done=new Promise((r,j)=>{turnDone=r;timeout=setTimeout(()=>j(Error('Turn timeout '+JSON.stringify(requests))),45000);});
 await rpc('turn/start',{threadId:thread.id,input:[{type:'text',text:'Execute exactly six read-only fixture tool calls sequentially and finish.'}]});
 const turn=await done;clearTimeout(timeout);
 const compactRequests=requests.filter(r=>r.kind==='local_compact');
 const result={passed:growth?compactRequests.length===1:compactRequests.length<=1,cliVersion,growth,scope:'installed Codex, generated TokenFlow model catalog, isolated HOME/CODEX_HOME, synthetic loopback upstream',cwd,compactScope,omitCatalogLimit,stderr,autoCompactTokenLimit:catalog.models[0].auto_compact_token_limit,tools,turnStatus:turn.status,localCompactions:compactRequests.length,normalInputTokens,tokenCounts,notifications,requests};
 console.log(JSON.stringify(result,null,2));
 assert.equal(turn.status,'completed');assert.equal(tools,6);if(growth){assert.equal(compactRequests.length,1,'Expected exactly one compaction after real history growth');assert.ok(compactRequests[0].historyGrowthTokens>65536,'Compaction happened before the history growth threshold');assert.ok(requests.some(r=>r.kind==='normal'&&r.toolsDone===4&&r.historyGrowthTokens===0),'Compaction did not reset retained history');}assert.ok(compactRequests.length<=1,`Repeated local compaction: ${compactRequests.length} compactions during 6 tiny tool outputs (normal usage=140000; compact usage=14000)`);
}finally{if(child&&child.exitCode===null&&child.signalCode===null)await new Promise(r=>{child.once('exit',r);child.kill();});server.closeAllConnections();await new Promise(r=>server.close(r));await rm(fixture,{recursive:true,force:true,maxRetries:3,retryDelay:50});}
