import {it,expect,afterEach} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexContext,codexContextScope} from '../packages/core/src/codex-context.js';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(await realpath(tmpdir()),'codex-context-test-'));roots.push(root);const home=join(root,'codex'),file=join(home,'sessions/2026/10/12/rollout-fixture.jsonl');await mkdir(join(home,'sessions/2026/10/12'),{recursive:true});const context=await GatewayContext.open(root);return {root,file,context,migration:new CodexContext(root,join(home,'config.toml'),context)};}
const history=[{type:'message',role:'user',content:[{type:'input_text',text:'Preserve requirements'}]},{type:'function_call',call_id:'one',name:'read',arguments:'{}'},{type:'function_call_output',call_id:'one',output:'original tool result'}];
const checkpoint=(token:string)=>({type:'compacted',payload:{message:'',replacement_history:[history[0],{type:'compaction',encrypted_content:token}],window_number:2}});
const rollout=(token:string)=>[...history.map(payload=>({type:'response_item',payload})),checkpoint(token),{type:'response_item',payload:{type:'message',role:'user',content:'Future turn must not leak into a fork'}}].map(v=>JSON.stringify(v)).join('\n')+'\n';
it('recovers an official opaque window from exact local history, encrypts its cache and excludes future turns',async()=>{
 const f=await fixture();await writeFile(f.file,rollout('official-ciphertext'));
 const recovered=await f.migration.recover({type:'compaction',encrypted_content:'official-ciphertext'},[]);
 expect(recovered).toEqual(history);
 const names=await readdir(join(f.root,'codex-context-cache'));expect(await readFile(join(f.root,'codex-context-cache',names[0]!),'utf8')).not.toContain('original tool result');
 await expect(f.migration.recover({type:'compaction',encrypted_content:'unknown'},[])).rejects.toThrow('无法恢复');
 expect(await readFile(f.file,'utf8')).toBe(rollout('official-ciphertext'));
});
it('blocks live rollout rewrites, migrates legacy gateway checkpoints with backups, and is idempotent',async()=>{
 const f=await fixture();const scope={owner:'old-key',source:'qoder-account',model:'qoder/m'};
 const token=f.context.encodeCheckpoint(history,scope);const original=rollout(token);await writeFile(f.file,original);
 await expect(f.migration.prepareOfficial([scope],async()=>[123])).rejects.toThrow('先退出 Codex');expect(await readFile(f.file,'utf8')).toBe(original);
 expect(await f.migration.prepareOfficial([scope],async()=>[])).toEqual({migrated:1});
 const text=await readFile(f.file,'utf8');const row=JSON.parse(text.split('\n')[3]!);expect(row.payload.replacement_history).toEqual(history);expect(row.payload.window_number).toBe(2);expect(text).toContain('Future turn');
 const batch=(await readdir(join(f.root,'codex-context-backups')))[0]!;expect(await readFile(join(f.root,'codex-context-backups',batch,'0.jsonl'),'utf8')).toBe(original);
 expect(await f.migration.prepareOfficial([scope],async()=>[])).toEqual({migrated:0});
});
it('only materializes foreign encrypted checkpoints that this managed connection recovered',async()=>{
 const f=await fixture();await writeFile(f.file,rollout('official-ciphertext'));
 expect(await f.migration.prepareOfficial([],async()=>[])).toEqual({migrated:0});
 await f.migration.recover({type:'compaction',encrypted_content:'official-ciphertext'},[]);
 expect(await f.migration.prepareOfficial([],async()=>[])).toEqual({migrated:1});
});
it('keeps managed history across source/model/key switches while ordinary exported keys remain isolated',async()=>{
 const f=await fixture();const migration={scope:codexContextScope,recover:(item:Record<string,unknown>)=>f.migration.recover(item,[])};
 let seen:any;const send=async(_p:string,b:Record<string,unknown>)=>{seen=b;return Response.json({id:'source',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'result'}]}]});};
 const first=await(await f.context.response('responses',{model:'qoder/a',input:'first'},'key-a','account-a',send,migration)).json();
 await f.context.response('responses',{model:'workbuddy/b',previous_response_id:first.id,input:'next'},'key-b','account-b',send,migration);expect(JSON.stringify(seen.input)).toContain('first');
 await expect(f.context.response('responses',{model:'workbuddy/b',previous_response_id:first.id,input:'steal'},'exported','account-b',send)).rejects.toThrow('another API key');
 const compact=await(await f.context.response('responses/compact',{model:'qoder/a',input:history},'key-a','account-a',send,migration)).json();
 await f.context.response('responses',{model:'workbuddy/b',input:compact.output},'key-b','account-b',send,migration);expect(seen.input).toEqual(history);
});
it('refuses ambiguous rolled-back histories instead of resurrecting discarded turns',async()=>{
 const f=await fixture();await writeFile(f.file,JSON.stringify({type:'event_msg',payload:{type:'thread_rolled_back',num_turns:1}})+'\n'+rollout('rolled-back'));
 await expect(f.migration.recover({type:'compaction',encrypted_content:'rolled-back'},[])).rejects.toThrow('无法恢复');
});
it('summarizes a recovered long window in bounded calls while keeping constraints and recent tool pairs',async()=>{
 const f=await fixture();const input:any[]=[{type:'message',role:'user',content:'Keep the original API and user files.'}];
 for(let i=0;i<15;i++)input.push({type:'function_call',call_id:`c${i}`,name:'read',arguments:'{}'},{type:'function_call_output',call_id:`c${i}`,output:i<10?'中'.repeat(10000):'recent result'});
 const requests:any[]=[];const send=async(_p:string,b:any)=>{requests.push(b);return Response.json({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Earlier reads completed; preserve API; continue current task.'}]}],usage:{input_tokens:10,output_tokens:2,total_tokens:12}});};
 const result=await(await f.context.response('responses',{model:'workbuddy/m',input,store:false},'new-key','new-source',send,{scope:codexContextScope,recover:i=>f.migration.recover(i,[])})).json();
 const summaries=requests.filter(r=>r.instructions?.startsWith('Summarize the supplied'));expect(summaries.length).toBeGreaterThan(2);
 for(const r of summaries)expect(Buffer.byteLength(r.input[0].content)).toBeLessThan(50*1024);
 const forwarded=requests.at(-1).input;expect(forwarded[0]).toEqual(input[0]);expect(forwarded.slice(-8)).toEqual(input.slice(-8));expect(JSON.stringify(forwarded).length).toBeLessThan(10000);expect(result.output[0].type).toBe('compaction');
});
it('keeps independent guardian records, removes stale positional metadata, and refuses partial files',async()=>{
 const f=await fixture();const token=f.context.encodeCheckpoint([...history,{role:'assistant',content:'checkpoint summary'}],codexContextScope);
 const row=checkpoint(token) as any;row.payload.replacement_history_metadata=[{client_authored:false}];row.payload.guardian_history=[history[0]];
 const original=JSON.stringify(row)+'\n';await writeFile(f.file,original+'{"partial":');
 await expect(f.migration.prepareOfficial([],async()=>[])).rejects.toThrow('记录不完整');expect(await readFile(f.file,'utf8')).toBe(original+'{"partial":');
 await writeFile(f.file,original);await f.migration.prepareOfficial([],async()=>[]);
 const saved=JSON.parse((await readFile(f.file,'utf8')).trim()).payload;
 expect(saved).not.toHaveProperty('replacement_history_metadata');expect(saved.guardian_history).toEqual(row.payload.guardian_history);expect(saved.replacement_history.at(-1)).toEqual({type:'message',role:'assistant',content:[{type:'output_text',text:'checkpoint summary'}]});
});
it('materializes inline automatic-compaction items before native resume and preserves subsequent turns',async()=>{
 const f=await fixture();const token=f.context.encodeCheckpoint(history,codexContextScope);
 const inline={timestamp:'2026-10-12T00:00:00Z',ordinal:10,type:'response_item',payload:{type:'compaction',encrypted_content:token}};
 const tail={type:'response_item',payload:{type:'message',role:'user',content:[{type:'input_text',text:'continue after automatic compaction'}]}};
 await writeFile(f.file,[...history.map(payload=>({type:'response_item',payload})),inline,tail].map(v=>JSON.stringify(v)).join('\n'));
 expect(await f.migration.prepareOfficial([],async()=>[])).toEqual({migrated:1});
 const rows=(await readFile(f.file,'utf8')).split('\n').map(l=>JSON.parse(l));
 expect(rows.at(-2)).toEqual({timestamp:inline.timestamp,ordinal:10,type:'compacted',payload:{message:'',replacement_history:history}});expect(rows.at(-1)).toEqual(tail);
 expect(await f.migration.prepareOfficial([],async()=>[])).toEqual({migrated:0});
});
it('does not reinterpret unrelated official checkpoints while switching the local login',async()=>{
 const f=await fixture();const original=JSON.stringify({type:'compacted',payload:{message:'',replacement_history:[{type:'item_reference',id:'official-item'},{type:'compaction',encrypted_content:'unrelated-official-state'}]}})+'\n';
 await writeFile(f.file,original);expect(await f.migration.prepareOfficial([],async()=>[])).toEqual({migrated:0});expect(await readFile(f.file,'utf8')).toBe(original);
});
it('preserves an official conversation through a failed gateway switch, gateway restart, retry and native restore',async()=>{
 const f=await fixture();const original=rollout('official-before-outage');await writeFile(f.file,original);
 const migration={scope:codexContextScope,normalize:undefined,recover:(item:Record<string,unknown>)=>f.migration.recover(item,[])};
 const request={model:'qoder/gmodel',input:[{type:'compaction',encrypted_content:'official-before-outage'},{role:'user',content:'Continue after switching'}]};
 let attempts=0;
 const failed=await f.context.response('responses',request,'gateway-key','qoder-account',async()=>{attempts++;return Response.json({error:{message:'source cooling down'}},{status:503});},migration);
 expect(failed.status).toBe(503);expect(attempts).toBe(1);expect(await readFile(f.file,'utf8')).toBe(original);
 const restarted=await GatewayContext.open(f.root);const recovered=new CodexContext(f.root,join(f.root,'codex/config.toml'),restarted);
 let forwarded:any;
 const resumed=await(await restarted.response('responses',request,'new-gateway-key','new-source',async(_path,body)=>{forwarded=body;return Response.json({id:'upstream',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'GATEWAY_REPLY_AFTER_RETRY'}]}]});},{scope:codexContextScope,recover:item=>recovered.recover(item,[])})).json();
 expect(forwarded.input).toEqual([...history,{role:'user',content:'Continue after switching'}]);expect(forwarded).not.toHaveProperty('previous_response_id');
 const tail=resumed.output.map((payload:any)=>JSON.stringify({type:'response_item',payload})).join('\n')+'\n';
 await writeFile(f.file,original+tail);
 expect(await recovered.prepareOfficial([],async()=>[])).toEqual({migrated:1});
 const saved=await readFile(f.file,'utf8');const rows=saved.trim().split('\n').map(row=>JSON.parse(row));
 expect(rows.find(row=>row.type==='compacted').payload.replacement_history).toEqual(history);
 expect(saved).toContain('Future turn must not leak into a fork');expect(saved).toContain('GATEWAY_REPLY_AFTER_RETRY');
 expect(await recovered.prepareOfficial([],async()=>[])).toEqual({migrated:0});
});
