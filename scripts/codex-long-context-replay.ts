// Read-only rollout replay. Default uses a fixture; --live explicitly opts into
// real quota. Never edits the selected rollout or the running Codex profile.
import {mkdtemp,mkdir,readFile,writeFile,copyFile,rm,stat,realpath} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {createHash} from 'node:crypto';
import YAML from 'yaml';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
import {CodexContext,codexContextScope,portableCodexItem} from '../packages/core/src/codex-context.js';
import {readSummaryResponse,summaryTranscript} from '../packages/core/src/context-summary.js';
import {upstreamIdle} from '../packages/core/src/upstream-idle.js';
import {CursorProvider} from '../packages/core/src/cursor.js';
const flag=(name:string)=>process.argv.find(s=>s.startsWith('--'+name+'='))?.slice(name.length+3);
const rollout=flag('rollout');if(!rollout)throw Error('Provide --rollout=/absolute/path/to/rollout.jsonl');
const live=process.argv.includes('--live'),model=flag('model')??'qoder/dfmodel';
const maxCalls=Number(flag('max-calls')??(live?'12':'32'));
if(!Number.isSafeInteger(maxCalls)||maxCalls<1||maxCalls>33)throw Error('Provide --max-calls as an integer from 1 to 33 (including the final answer).');
const root=await mkdtemp(join(await realpath(tmpdir()),'tokenflow-long-replay-'));let calls=0;
const idle=upstreamIdle();
let cursor:CursorProvider|undefined;let cursorSource:string|undefined;
const started=Date.now(),requests:unknown[]=[];
const scrub=(text:string)=>text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi,'Bearer [REDACTED]').replace(/\b(?:sk-|tfl_)[A-Za-z0-9_-]{12,}/g,'[REDACTED]').replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)["']?\s*[=:]\s*["']?)[^\s"',;}]+/gi,'$1[REDACTED]');
try{
 const before=await readFile(rollout);const hash=createHash('sha256').update(before).digest('hex');
 const events=before.toString().split('\n').filter(Boolean).map(l=>JSON.parse(l));
 const firstCheckpoint=process.argv.includes('--first-checkpoint');
 let index=-1;for(let i=0;i<events.length;i++)if(events[i].type==='compacted'&&events[i].payload?.replacement_history?.some((x:any)=>x.type==='compaction')){index=i;if(firstCheckpoint)break;}
 if(index<0)throw Error('Selected rollout has no official compaction checkpoint');
 await mkdir(join(root,'sessions'));await copyFile(rollout,join(root,'sessions',basename(rollout)));
 const context=await GatewayContext.open(flag('cache-root')??root),migration=new CodexContext(root,join(root,'config.toml'),context);
 const initial=events[index].payload.replacement_history;
 let subsequent=events.slice(index+1).filter(r=>r.type==='response_item').map(r=>r.payload).filter(r=>r.type!=='compaction');
 if(firstCheckpoint){
  // Official compaction can occur while tools are pending. Continue through
  // the next complete exchange before simulating a user's provider switch.
  const pending=new Set<string>();const track=(item:any)=>{if(['function_call','custom_tool_call'].includes(item.type))pending.add(item.call_id);if(['function_call_output','custom_tool_call_output'].includes(item.type))pending.delete(item.call_id);};
  const restored=await migration.recover(initial.find((x:any)=>x.type==='compaction'),[]);restored.forEach(track);
  const next=[];for(const item of subsequent){next.push(item);track(item);if(item.type==='message'&&item.role==='assistant'&&pending.size===0)break;}
  subsequent=next;
 }
 const sanitize=(v:any):any=>typeof v==='string'?scrub(v):Array.isArray(v)?v.map(sanitize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,/^(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|authorization)$/i.test(k)?'[REDACTED]':sanitize(x)])):v;
 if(!live){const restored=sanitize(await migration.recover(initial.find((x:any)=>x.type==='compaction'),[]));const sizes:Record<string,number>={};for(const x of [...restored,...subsequent.flatMap(portableCodexItem)]){const k=x.role??x.type;sizes[k]=(sizes[k]??0)+Buffer.byteLength(summaryTranscript([x]));}console.log(JSON.stringify({summaryBytesByType:sizes}));}
 const input=[...sanitize(initial),...sanitize(subsequent),{role:'user',content:'Briefly state this task’s goal, important constraints and the next unfinished step. Use only the supplied history. Do not execute tools or claim new work.'}];
 let endpoint='',key='';
 if(live&&model.startsWith('cursor/')){
  if(!process.argv.includes('--cursor-credential-stdin'))throw Error('Cursor replay requires --cursor-credential-stdin; pass an existing authorized credential through a private pipe, never argv or logs.');
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(Buffer.byteLength(raw)>200000)throw Error('Credential input exceeds limit');}
  cursor=new CursorProvider(root,{get:async name=>name==='cursor-account'?raw:'',set:async()=>{throw Error('Replay cannot change saved credentials');}});
  await cursor.load();const snapshot=cursor.snapshot();
  cursorSource=snapshot.accounts.find(a=>!a.disabled&&a.models?.includes(model))?.id;
  if(!cursorSource)throw Error('Selected Cursor model is not available for this authorized account');
  console.log(JSON.stringify({cursorCatalogVerified:true,model,quotaKnown:snapshot.quotas[cursorSource]?.status==='ok'}));
 }else if(live){const cfg=YAML.parse(await readFile(join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/config.yaml'),'utf8'));endpoint='http://127.0.0.1:'+cfg.port+'/v1/responses';key=cfg['api-keys'][0];}
 const send=async(_path:string,body:Record<string,unknown>)=>{
  if(calls>=maxCalls)throw Error('Replay paid-call limit reached');calls++;
  const bytes=Buffer.byteLength(JSON.stringify(body));if(bytes>128*1024)throw Error('Unsafe upstream payload size');
  const summary=typeof body.instructions==='string'&&body.instructions.startsWith('Summarize the supplied');requests.push({call:calls,summary,bytes});
  console.log(JSON.stringify({call:calls,summary,bytes,live}));
  if(!live)return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Checkpoint: preserve task constraints and original files; verify outstanding work before merging.'}]}],usage:{input_tokens:100,output_tokens:20}});
  if(cursor)return idle.watch(await cursor.response('responses',body,idle.signal,cursorSource));
  return idle.watch(await fetch(endpoint,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},body:JSON.stringify(body),signal:idle.signal}));
 };
 let report:unknown;
 const response=await context.response('responses',{model,input,store:false,stream:true,max_output_tokens:512},'replay-only','selected-source',send,{scope:codexContextScope,normalize:portableCodexItem,recover:async item=>sanitize(await migration.recover(item,[]))},{onCompaction:r=>{report=r;console.log(JSON.stringify({compaction:r}));}});
 const result=await readSummaryResponse(response);
 const answer=result.output?.filter((x:any)=>x.role==='assistant').flatMap((x:any)=>x.content??[]).filter((p:any)=>p.type==='output_text').map((p:any)=>p.text).join('\n');
 if(result.status!=='completed'||!answer?.trim())throw Error('Replay did not produce a completed answer');
 if(hash!==createHash('sha256').update(await readFile(rollout)).digest('hex'))throw Error('Original rollout changed during replay');
 console.log(JSON.stringify({passed:true,live,model,historyWindow:firstCheckpoint?'first-official-checkpoint':'latest-window',originalRolloutUnchanged:true,rolloutBytes:(await stat(rollout)).size,calls,elapsedMs:Date.now()-started,report,usage:result.usage,answer:scrub(answer).slice(0,1500),requests}));
}finally{idle.abort();idle.close();await cursor?.close();await rm(root,{recursive:true,force:true});}
