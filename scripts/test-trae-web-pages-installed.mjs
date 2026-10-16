import {writeFile} from 'node:fs/promises';
import {readTraeAcceptanceConfig} from './trae-acceptance-config.mjs';
if(process.env.TOKEN_FLOW_TRAE_INSTALLED_LIVE!=='1')throw Error('Set TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 for real account calls.');
let cfg=await readTraeAcceptanceConfig();
let ready=false;for(let n=0;n<60;n++){try{cfg=await readTraeAcceptanceConfig();const r=await fetch(`http://127.0.0.1:${cfg.port}/v1/models`,{headers:{Authorization:'Bearer '+cfg['api-keys'][0]},signal:AbortSignal.timeout(5000)});const j=await r.json();if(j.data?.some(m=>m.id==='trae/deepseek-v4.1-flash')){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,1000));}if(!ready)throw Error('Installed TRAE model discovery did not become ready.');
const workers=Number(process.env.TRAE_INSTALLED_WORKERS??16);if(!Number.isInteger(workers)||workers<1||workers>32)throw Error('TRAE_INSTALLED_WORKERS must be 1–32');
const rows=[],page='https://www.iana.org/help/example-domains';
await Promise.all(Array.from({length:workers},async(_,worker)=>{
 const input=[];for(let i=0;i<100;i++)input.push({role:'user',content:`Historical task ${i} completed. ${'Synthetic long context for full page and find acceptance. '.repeat(10)}`},{role:'assistant',content:`Recorded ${i}.`});
 const web={type:'web_search',external_web_access:worker%2===1,filters:{allowed_domains:['iana.org']}};
 for(let round=0;round<4;round++){
  const marker=`TRAE_PAGES_${worker}_COMPLETE_OK`;
  input.push({role:'user',content:round===0?`Use the web tool action=open_page to read ${page}. State the phrase after "not designed to support" from the document.`:round===1?`Use action=find_in_page on ${page}, with pattern exactly "RFC 6761". Return the matching context.`:round===2?`Call read_probe with step ${worker}.`:`The tools are finished. This is a new user instruction: output only ${marker}. No browsing is needed.`});
  const body={model:'trae/deepseek-v4.1-flash',input,stream:worker%2===0,tools:[web],tool_choice:round<2?{type:'web_search'}:round===2?{type:'function',name:'read_probe'}:'none'};
  if(round===2)body.tools.push({type:'function',name:'read_probe',description:'Read a step',parameters:{type:'object',properties:{step:{type:'integer'}},required:['step']}});
  const start=Date.now(),row={worker,round,stream:body.stream,cached:!web.external_web_access};
  try{
   const r=await fetch(`http://127.0.0.1:${cfg.port}/v1/responses`,{method:'POST',headers:{Authorization:'Bearer '+cfg['api-keys'][0],'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(120000)});row.http=r.status;let response;
   if(body.stream){for(const line of (await r.text()).split('\n'))if(line.startsWith('data:')){try{const e=JSON.parse(line.slice(5));if(e.type==='response.completed')response=e.response;}catch{}}}else response=await r.json();
   const output=response?.output??[],text=output.flatMap(i=>i.content??[]).map(p=>p.text??'').join(''),actions=output.filter(i=>i.type==='web_search_call'),call=output.find(i=>i.type==='function_call');
   row.actions=actions.map(i=>({type:i.action?.type,url:i.action?.url,pattern:i.action?.pattern,status:i.status}));
   row.passed=r.ok&&response?.status==='completed'&&(round===0?actions.some(i=>i.status==='completed'&&i.action?.type==='open_page'&&i.action.url===page)&&text.toLowerCase().includes('production applications'):round===1?actions.some(i=>i.status==='completed'&&i.action?.type==='find_in_page'&&i.action.pattern==='RFC 6761')&&text.includes('6761'):round===2?call?.name==='read_probe'&&JSON.parse(call.arguments).step===worker:text===marker&&actions.length===0);
   if(row.passed){input.push(...output);if(call)input.push({type:'function_call_output',call_id:call.call_id,output:'Requested step read successfully'});}else{row.text=text;row.error=response?.error??'Expected web action, document evidence, client tool or final marker missing';}
  }catch(e){row.passed=false;row.error=e.name+': '+e.message}
  row.ms=Date.now()-start;rows.push(row);if(!row.passed)break;
 }
}));
const report={workers,requests:rows.length,passed:rows.length===workers*4&&rows.every(r=>r.passed),rows};await writeFile(process.env.TOKEN_FLOW_TRAE_INSTALLED_REPORT??'.tmp/trae-web-pages-installed.json',JSON.stringify(report,null,2)+'\n');console.log({workers,requests:rows.length,passed:rows.filter(r=>r.passed).length,failures:rows.filter(r=>!r.passed),maxMs:Math.max(...rows.map(r=>r.ms))});if(!report.passed)process.exitCode=1;
