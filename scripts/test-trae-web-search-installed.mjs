// Real search + function-tool continuation through the installed Responses endpoint.
import {readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {parse} from 'yaml';
if(process.env.TOKEN_FLOW_TRAE_INSTALLED_LIVE!=='1')throw Error('Set TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 for real account calls.');
const cfg=parse(await readFile(join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/config.yaml'),'utf8'));
let ready=false;for(let attempt=0;attempt<30;attempt++){try{const r=await fetch(`http://127.0.0.1:${cfg.port}/v1/models`,{headers:{Authorization:'Bearer '+cfg['api-keys'][0]},signal:AbortSignal.timeout(5000)});const j=await r.json();if(j.data?.some(m=>m.id==='trae/deepseek-v4.1-flash')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Installed TRAE model discovery did not become ready.');
const workers=Number(process.env.TRAE_INSTALLED_WORKERS??8);if(!Number.isInteger(workers)||workers<1||workers>16)throw Error('TRAE_INSTALLED_WORKERS must be 1–16');
const rows=[];
await Promise.all(Array.from({length:workers},async(_,worker)=>{
 const input=[];for(let i=0;i<100;i++)input.push({role:'user',content:`Completed historical task ${i}. ${'Synthetic context for web search and client tools. '.repeat(12)}`},{role:'assistant',content:`Recorded result ${i}.`});
 const web={type:'web_search',external_web_access:worker%2===1,filters:{allowed_domains:['openai.com','learn.chatgpt.com']}};
 for(let round=0;round<3;round++){
  const marker=`TRAE_SEARCH_${worker}_COMPLETE_OK`;
  input.push({role:'user',content:round===0?'Search the web for "OpenAI Codex" and explain briefly. Cite at least one exact returned source URL; preserve its full path and locale.':round===1?`Call read_probe with step ${worker}.`:`The tools have finished. This is the user's new request: reply with only ${marker}. No new search is needed.`});
  const body={model:'trae/deepseek-v4.1-flash',input,stream:worker%2===0,tools:[web],tool_choice:round===0?{type:'web_search'}:round===2?'none':{type:'function',name:'read_probe'}};
  if(round===1)body.tools.push({type:'function',name:'read_probe',description:'Read the requested step',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}});
  const started=Date.now(),row={worker,round,stream:body.stream,externalWebAccess:web.external_web_access};
  try{
   const r=await fetch(`http://127.0.0.1:${cfg.port}/v1/responses`,{method:'POST',headers:{Authorization:'Bearer '+cfg['api-keys'][0],'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});row.http=r.status;let response;
   if(body.stream){const wire=await r.text();for(const line of wire.split('\n'))if(line.startsWith('data:')){try{const e=JSON.parse(line.slice(5));if(e.type==='response.completed')response=e.response;}catch{}}}else response=await r.json();
   const output=response?.output??[],searches=output.filter(i=>i.type==='web_search_call'),text=output.flatMap(i=>i.content??[]).map(c=>c.text??'').join(''),call=output.find(i=>i.type==='function_call');
   row.searches=searches.length;row.sources=searches.flatMap(s=>s.action?.sources??[]).length;row.citations=output.flatMap(i=>i.content??[]).flatMap(c=>c.annotations??[]).filter(a=>a.type==='url_citation').length;
   row.passed=r.ok&&response?.status==='completed'&&(round===0?row.sources>0&&row.citations>0:round===1?call?.name==='read_probe'&&JSON.parse(call.arguments).step===worker:text===marker&&searches.length===0);
   if(row.passed){input.push(...output);if(call)input.push({type:'function_call_output',call_id:call.call_id,output:'Requested step read successfully'});}else{row.error=response?.error??'Search, citations, tool or exact final marker missing';row.text=text;row.status=response?.status;row.outputTypes=output.map(i=>i.type);}
  }catch(e){row.passed=false;row.error=e.name+': '+e.message}
  row.ms=Date.now()-started;rows.push(row);if(!row.passed)break;
 }
}));
const report={workers,requests:rows.length,passed:rows.length===workers*3&&rows.every(r=>r.passed),rows};
await writeFile(process.env.TOKEN_FLOW_TRAE_INSTALLED_REPORT??'.tmp/trae-web-search-installed.json',JSON.stringify(report,null,2)+'\n');
console.log({workers,requests:rows.length,passed:rows.filter(r=>r.passed).length,failures:rows.filter(r=>!r.passed),maxMs:Math.max(...rows.map(r=>r.ms))});if(!report.passed)process.exitCode=1;
