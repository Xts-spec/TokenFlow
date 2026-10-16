import {expect,it,vi} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import {LocalUsageIndex} from '../packages/core/src/local-usage-index.js';
import {NativeUsageLogins} from '../packages/core/src/native-usage-logins.js';
import {nativeIdentity} from '../packages/core/src/local-usage.js';

it.each(['cordis.patch.yml','profiles/desktop/cordis.patch.yml'])('indexes shared DeepSeek sessions with settings at %s',async config=>{
 const root=await mkdtemp(join(tmpdir(),'tf-deepseek-usage-')),home=join(root,'.dsh');
 const index=new LocalUsageIndex(root,{...agentPaths(root),deepseek:join(home,config)});
 try{
  await mkdir(join(home,'sessions'),{recursive:true});
  await writeFile(join(home,'sessions','fixture.jsonl'),[
   {type:'model/selection',data:{provider:'deepseek',model:'native-model'}},
   {type:'assistant/message',seq:1,time:Date.now(),data:{usage:{inputTokens:10,outputTokens:5}}},
  ].map(row=>JSON.stringify(row)).join('\n')+'\n');
  index.snapshot();
  await vi.waitFor(()=>{
   const state=index.snapshot();expect(state.scanning).toBe(false);expect(state.warning).toBeUndefined();
   expect(state.coverage.find(item=>item.target==='deepseek')).toMatchObject({files:1,indexed:1,status:'ready'});
   expect(state.rows).toHaveLength(1);expect(state.rows[0]).toMatchObject({target:'deepseek',inputTokens:10,outputTokens:5});
  },{timeout:5000,interval:25});
 }finally{await index.close();await rm(root,{recursive:true,force:true});}
});

it('retains Claude account and official classification when a log grows after restart and older observations expire',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-claude-usage-')),paths=agentPaths(root),directory=join(root,'.claude','projects');let index=new LocalUsageIndex(root,paths);
 try{
  const store=await NativeUsageLogins.open(root),now=Date.parse('2026-10-16T10:00:00Z'),a={provider:'claude' as const,accountId:'a',email:'a@example.test'},b={...a,accountId:'b',email:'b@example.test'};
  await store.observe({codex:null,claude:a},now);await store.observe({codex:null,claude:a},now+5000);
  await mkdir(directory,{recursive:true});const entry=(time:number)=>JSON.stringify({type:'assistant',timestamp:new Date(time).toISOString(),message:{id:`response-${time}`,model:'claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20}}});const file=join(directory,'session.jsonl'),original=entry(now+1000);
  await writeFile(file,original);index.snapshot();await vi.waitFor(()=>{const state=index.snapshot();expect(state.scanning).toBe(false);expect(state.recent?.[0]).toMatchObject({nativeAccountId:nativeIdentity('claude','a'),channel:'official'});},{timeout:5000,interval:25});await index.close();
  await store.observe({codex:null,claude:b},now+10000);await store.observe({codex:null,claude:b},now+15000);
  const saved=JSON.parse(await readFile(join(root,'native-usage-logins.json'),'utf8'));saved.intervals=saved.intervals.filter((i:{account:string})=>i.account===nativeIdentity('claude','b'));await writeFile(join(root,'native-usage-logins.json'),JSON.stringify(saved));
  await writeFile(file,original+'\n'+entry(now+12000));index=new LocalUsageIndex(root,paths);index.snapshot();
  await vi.waitFor(()=>{const state=index.snapshot();expect(state.scanning).toBe(false);expect(state.rows.map(r=>[r.nativeAccountId,r.channel,r.requests]).sort()).toEqual([['a','official',1],['b','official',1]].map(([id,channel,requests])=>[nativeIdentity('claude',String(id)),channel,requests]).sort());expect(state.recent).toHaveLength(2);},{timeout:5000,interval:25});
 }finally{await index.close();await rm(root,{recursive:true,force:true});}
});
