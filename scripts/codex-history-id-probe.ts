// Real installed Codex, a private copy of the affected history, and a local
// Responses validator. No user history or credentials leave this machine.
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile,copyFile,rm,readdir,realpath} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {DatabaseSync,backup} from 'node:sqlite';
import assert from 'node:assert/strict';
import {CodexContext} from '../packages/core/src/codex-context.js';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
const id=process.argv[2]??'01a13ded-64e1-7361-bc79-bea35aeb877d';
const home=join(homedir(),'.codex'),root=await mkdtemp(join(await realpath(tmpdir()),'tf-history-id-'));
const captured:any[]=[];const foreignIds=new Set<string>();let child:ReturnType<typeof spawn>|undefined;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||!req.url?.endsWith('/responses')){res.writeHead(405);res.end();return;}
 let data='';for await(const chunk of req)data+=chunk;
 const body=JSON.parse(data);const input=body.input??[];
 const invalid=input.filter((v:any)=>foreignIds.has(v.id));
 const custom=input.filter((v:any)=>v.type==='custom_tool_call'&&v.id&&!v.id.startsWith('ctc'));
 captured.push({inputItems:input.length,foreignIds:invalid.length,badCustomIds:custom.length,toolPairs:input.filter((v:any)=>['function_call','function_call_output','custom_tool_call','custom_tool_call_output'].includes(v.type)).map((v:any)=>({type:v.type,call_id:v.call_id})),subagentContext:JSON.stringify(input).includes('Ramanujan')||JSON.stringify(input).includes('Avicenna')});
 if(invalid.length){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:custom.length?"Invalid input custom-tool item id: expected ctc prefix":"Supplied input item IDs require persisted-item lookup that is not supported by rustponsesapi.",type:'invalid_request_error'}}));return;}
 const item={id:'msg_probe',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'HISTORY_REPLAY_OK',annotations:[]}]};const response={id:'resp_probe',object:'response',status:'completed',output:[item],model:body.model,usage:{input_tokens:1,output_tokens:1,total_tokens:2}};
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:{...item,status:'in_progress',content:[]}},{type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 res.writeHead(200,{'content-type':'text/event-stream'});res.end(events.map((e,i)=>`event: ${e.type}\ndata: ${JSON.stringify({...e,sequence_number:i})}\n\n`).join(''));
});
async function turn(){
 const proc=child=spawn('/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex',['app-server','--listen','stdio://'],{cwd:root,env:{PATH:process.env.PATH,HOME:root,CODEX_HOME:root,OPENAI_API_KEY:'isolated-fixture',OPENAI_BASE_URL:`http://127.0.0.1:${(server.address() as any).port}/v1`},stdio:['pipe','pipe','pipe']});
 let buffer='',next=0,finish:(v:any)=>void=()=>{};const pending=new Map<number,any>();proc.stderr!.resume();
 proc.stdout!.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+1);let m;try{m=JSON.parse(line);}catch{continue;}if(pending.has(m.id)){const p=pending.get(m.id);pending.delete(m.id);m.error?p.reject(Error(JSON.stringify(m.error))):p.resolve(m.result);}if(m.method==='turn/completed')finish(m.params.turn);}});
 const rpc=(method:string,params:any)=>new Promise<any>((resolve,reject)=>{const id=++next,timer=setTimeout(()=>reject(Error('RPC timeout')),30000);pending.set(id,{resolve:(v:any)=>{clearTimeout(timer);resolve(v);},reject:(e:any)=>{clearTimeout(timer);reject(e);}});proc.stdin!.write(JSON.stringify({id,method,params})+'\n');});
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await rpc('initialize',{clientInfo:{name:'history_id_probe',version:'1.0'}});proc.stdin!.write('{"method":"initialized"}\n');await rpc('thread/resume',{threadId:id,model:'native-fixture',modelProvider:'openai',cwd:root,approvalPolicy:'never',sandbox:'read-only'});const done=new Promise<any>((resolve,reject)=>{finish=resolve;timer=setTimeout(()=>reject(Error('turn timed out')),45000);});await rpc('turn/start',{threadId:id,model:'native-fixture',input:[{type:'text',text:'History compatibility check. Reply OK only; do not call any tools.'}]});return await done;}
 finally{clearTimeout(timer);await new Promise<void>(resolve=>{proc.once('exit',()=>resolve());proc.kill();});}
}
try{
 await mkdir(join(root,'sessions'),{recursive:true});
 const sourceDb=new DatabaseSync(join(home,'state_5.sqlite'),{readOnly:true});await backup(sourceDb,join(root,'state_5.sqlite'));sourceDb.close();
 const db=new DatabaseSync(join(root,'state_5.sqlite'));const target=db.prepare('SELECT rollout_path FROM threads WHERE id=?').get(id)!;assert.ok(target);
 const dir=dirname(String(target.rollout_path));
 for(const name of await readdir(dir)){if(!name.includes(id)||!name.endsWith('.jsonl'))continue;const source=join(dir,name),dest=source.replace(home,root);await mkdir(dirname(dest),{recursive:true});await copyFile(source,dest);let gateway=false;for(const line of (await readFile(dest,'utf8')).split('\n')){if(!line)continue;const r=JSON.parse(line),v=r.payload;if(r.type==='session_meta')gateway=v.model_provider==='token_flow';if(r.type==='turn_context')gateway=String(v.model).includes('/');if(r.type==='response_item'&&gateway&&v.id)foreignIds.add(v.id);}}
 db.prepare('UPDATE threads SET rollout_path=replace(rollout_path,?,?),cwd=?').run(home,root,root);db.close();
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${(server.address() as any).port}/v1`;
 await writeFile(join(root,'config.toml'),`model="native-fixture"\nmodel_provider="openai"\nopenai_base_url="${origin}"\n`);await writeFile(join(root,'auth.json'),JSON.stringify({OPENAI_API_KEY:'isolated-fixture'}),{mode:0o600});
 const before=await turn();assert.equal(before.status,'failed');assert.ok(captured[0].foreignIds>0);
 const context=new CodexContext(root,join(root,'config.toml'),await GatewayContext.open(root));const repaired=await context.prepareOfficial([],async()=>[]);
 const after=await turn();assert.equal(after.status,'completed');assert.equal(captured.at(-1).foreignIds,0);assert.equal(captured.at(-1).badCustomIds,0);assert.deepEqual(captured.at(-1).toolPairs,captured[0].toolPairs);assert.equal(captured.at(-1).subagentContext,captured[0].subagentContext);
 const report={passed:true,realCodex:true,localValidator:true,liveOfficialInference:false,repair:repaired,before:{...captured[0],toolPairs:captured[0].toolPairs.length},after:{...captured.at(-1),toolPairs:captured.at(-1).toolPairs.length},toolCallBindingsPreserved:true};
 await writeFile('artifacts/codex-history-id-verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{child?.kill();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
