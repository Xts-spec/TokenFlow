import {describe,it,expect} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parse} from 'smol-toml';
import {UsageAttribution,decodeAccountEvents,enrichAccountRows,mapNativeAccounts,emailIdentity,readAccountEvidence} from '../packages/core/src/usage-attribution.js';
import {LocalUsageParser,nativeIdentity,mergeLocalUsageRows} from '../packages/core/src/local-usage.js';
const now=Date.parse('2026-10-15T12:00:00Z');
const event=(account:string,email:string,time=now,thread='same-thread')=>({resourceLogs:[{scopeLogs:[{logRecords:[{timeUnixNano:String(BigInt(time)*1000000n),body:{stringValue:'PRIVATE_BODY'},attributes:Object.entries({'event.name':'codex.sse_event','event.kind':'response.completed','auth_mode':'chatgpt','conversation.id':thread,model:'gpt-test','user.account_id':account,'user.email':email,input_token_count:'100',cached_token_count:'60',cache_write_token_count:'0',output_token_count:'20',prompt:'PRIVATE_PROMPT',access_token:'PRIVATE_TOKEN'}).map(([key,value])=>({key,value:{stringValue:value}}))}]}]}]});
const row=(time=now,thread='same-thread')=>{const p=new LocalUsageParser('codex','file');p.accept({type:'session_meta',payload:{id:thread,creator_account_id:'old-owner',model_provider:'openai'}});p.accept({type:'turn_context',payload:{model:'gpt-test'}});p.accept({type:'token_usage_record',timestamp:new Date(time).toISOString(),payload:{response_id:`response-${time}`,usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}});return p.rows()[0];};
describe('request-scoped account attribution',()=>{
 it('keeps account A on its completed request even after account B starts in the same thread',()=>{
  const a=row(now),b=row(now+10000),evidence=[...decodeAccountEvents(event('workspace','a@example.test'),now-1,now+10000),...decodeAccountEvents(event('workspace','b@example.test',now+10000),now-1,now+10000)];
  const rows=enrichAccountRows([a,b],evidence);expect(rows.map(r=>r.nativeEmailHash)).toEqual([emailIdentity('a@example.test'),emailIdentity('b@example.test')]);
  expect(mergeLocalUsageRows(rows)).toHaveLength(2);
  const accounts=[{id:'A',accountId:'workspace',email:'a@example.test'},{id:'B',accountId:'workspace',email:'b@example.test'}];expect(mapNativeAccounts(rows,accounts).map(r=>r.sourceId)).toEqual(['A','B']);
  expect(mapNativeAccounts([{...rows[0],nativeEmailHash:undefined}],accounts)[0].sourceId).toBe('');
  expect(JSON.stringify(evidence)).not.toMatch(/example\.test|PRIVATE|workspace|same-thread/);
 });
 it('does not fill historical rows, other threads, mismatching counters, or ambiguous evidence',()=>{
  const evidence=decodeAccountEvents(event('A','a@example.test'),now-1,now);const original=row();
  expect(decodeAccountEvents(event('A','a@example.test',now-10000),now-1,now)).toEqual([]);
  for(const r of [row(now-10000),row(now,'other'),{...original,inputTokens:101}])expect(enrichAccountRows([r],evidence)[0].nativeAccountId).toBeUndefined();
  const conflict=[...evidence,...decodeAccountEvents(event('B','b@example.test'),now-1,now)];expect(enrichAccountRows([original],conflict)[0].nativeAccountId).toBeUndefined();
  expect(enrichAccountRows([{...original,channel:'api'}],evidence)[0].nativeAccountId).toBeUndefined();
  expect(enrichAccountRows([original],[])[0].nativeAccountId).toBeUndefined();
 });
 it('accepts only authenticated completion events and safely ignores malformed or late batches',()=>{
  expect(decodeAccountEvents({resourceLogs:[null,{scopeLogs:[null]}]},now-1,now)).toEqual([]);
  const body=event('A','a@example.test');body.resourceLogs[0].scopeLogs[0].logRecords[0].attributes.find(a=>a.key==='auth_mode')!.value.stringValue='api_key';expect(decodeAccountEvents(body,now-1,now)).toEqual([]);
  expect(decodeAccountEvents(event('A','a@example.test',now+60000),now-1,now)).toEqual([]);
  expect(decodeAccountEvents(event('A','a@example.test',now-700000),now-800000,now)).toEqual([]);
 });
 it('persists only hashed evidence, deduplicates delivery, and retains the activation cutoff across restarts',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tf-attribution-'));try{
   const store=await UsageAttribution.open(root),time=store.since+1;store.accept(event('A','a@example.test',time),time);store.accept(event('A','a@example.test',time),time);await store.close();
   const records=await readAccountEvidence(root);expect(records).toHaveLength(1);expect(records[0].account).toBe(nativeIdentity('codex','A'));expect(await readFile(join(root,'usage-account-evidence.json'),'utf8')).not.toMatch(/PRIVATE|example\.test/);
   const again=await UsageAttribution.open(root);expect(again.since).toBe(store.since);expect(again.token).toBe(store.token);await again.close();expect((await stat(join(root,'usage-account-evidence.json'))).mode&0o777).toBe(0o600);
  }finally{await rm(root,{recursive:true,force:true});}
 });
 it('enables the loopback exporter while preserving unrelated config and an existing external exporter',async()=>{
  const root=await mkdtemp(join(tmpdir(),'tf-attribution-config-'));try{
   const path=join(root,'config.toml'),store=await UsageAttribution.open(root),prefix='# Keep my comment\nmodel = "gpt-test"\n\n[projects."/my/project"]\ntrust_level = "trusted"\n';await writeFile(path,prefix);
   await store.enable(path,'http://127.0.0.1:9527');const updated=await readFile(path,'utf8'),config=parse(updated) as any;expect(updated.startsWith(prefix.trimEnd())).toBe(true);expect(config.otel.exporter['otlp-http'].headers['x-tokenflow-recorder']).toBe(store.token);expect(config.otel.log_user_prompt).toBe(false);expect(config.otel.log_agent_responses).toBe(false);
   await store.enable(path,'http://127.0.0.1:9527');expect(await readFile(path,'utf8')).toBe(updated);
   const external='[otel]\nexporter = { otlp-http = { endpoint = "https://existing.example.test/v1/logs" } }\n';await writeFile(path,external);expect(await store.enable(path,'http://127.0.0.1:9527')).toBe(false);expect(await readFile(path,'utf8')).toBe(external);await store.close();
  }finally{await rm(root,{recursive:true,force:true});}
 });
});

it('keeps verified request identity when an unannotated fork contains the same response, independent of file order',()=>{
 const original=enrichAccountRows([row()],decodeAccountEvents(event('A','a@example.test'),now-1,now))[0],fork={...row(),nativeThreadId:nativeIdentity('thread','fork')};
 for(const rows of [[original,fork],[fork,original]]){const merged=mergeLocalUsageRows(rows);expect(merged).toHaveLength(1);expect(merged[0]).toMatchObject({requests:1,nativeAccountId:nativeIdentity('codex','A'),nativeEmailHash:emailIdentity('a@example.test')});}
 const conflict={...original,nativeAccountId:nativeIdentity('codex','B')};expect(mergeLocalUsageRows([original,conflict,original])[0].nativeAccountId).toBeUndefined();
});

it('keeps saved proof without current login access and keeps conflicting proof unconfirmed on subsequent scans',()=>{
 const evidence=decodeAccountEvents(event('A','a@example.test'),now-1,now),attributed=enrichAccountRows([row()],evidence)[0];expect(enrichAccountRows([attributed],[])[0].nativeAccountId).toBe(attributed.nativeAccountId);
 const other=decodeAccountEvents(event('B','b@example.test'),now-1,now),conflicted=enrichAccountRows([attributed],other)[0];expect(conflicted.nativeAccountId).toBeUndefined();expect(enrichAccountRows([conflicted],other)[0].nativeAccountId).toBeUndefined();
});

it('replaces a login snapshot with request-level identity and removes its stale email when absent from the request',()=>{
 const inferred={...row(),channel:'official' as const,nativeAccountId:nativeIdentity('codex','inferred'),nativeEmailHash:emailIdentity('inferred@example.test'),nativeAccountEvidence:'login-snapshot' as const};
 const proof=decodeAccountEvents(event('actual','actual@example.test'),now-1,now);
 expect(enrichAccountRows([inferred],proof)[0]).toMatchObject({nativeAccountId:nativeIdentity('codex','actual'),nativeEmailHash:emailIdentity('actual@example.test'),nativeAccountEvidence:'otel'});
 expect(enrichAccountRows([inferred],proof.map(e=>({...e,email:undefined})))[0].nativeEmailHash).toBeUndefined();
});
