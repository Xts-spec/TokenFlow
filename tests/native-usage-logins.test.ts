import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {NativeUsageLogins,enrichNativeLoginRows,readNativeLoginIntervals,type NativeUsageLogin} from '../packages/core/src/native-usage-logins.js';
import {LocalUsageParser,mergeLocalUsageRows,nativeIdentity,type LocalUsageRow} from '../packages/core/src/local-usage.js';
import {mapNativeAccounts} from '../packages/core/src/usage-attribution.js';
import {describeSource} from '../apps/console/src/UsagePanel.js';
import {sourceKey} from '../apps/console/src/usage-model.js';
import type {LocalAgentSnapshot} from '../packages/core/src/cliproxy.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
const now=Date.parse('2026-10-16T10:00:00Z');
const login=(name:string,organizationId='org'):NativeUsageLogin=>({provider:'claude',accountId:`account-${name}`,email:`${name}@example.test`,organizationId});
const row=(at:number,overrides:Partial<LocalUsageRow>={})=>{const p=new LocalUsageParser('claude','file');p.accept({type:'assistant',timestamp:new Date(at).toISOString(),message:{id:`response-${at}`,model:'claude-sonnet-4-6',usage:{input_tokens:40,cache_read_input_tokens:60,output_tokens:20}}});return {...p.rows()[0],...overrides};};
async function setup(){const root=await mkdtemp(join(await realpath(tmpdir()),'tf-login-usage-'));roots.push(root);return {root,store:await NativeUsageLogins.open(root)};}

it('attributes only observed intervals and preserves prior accounts through switching, logout and restart',async()=>{
 const {root,store}=await setup();const a=login('a'),b=login('b');
 await store.observe({claude:a,codex:null},now);await store.observe({claude:a,codex:null},now+5000);
 await store.observe({claude:b,codex:null},now+10000);await store.observe({claude:b,codex:null},now+15000);
 await store.observe({claude:null,codex:null},now+20000);await store.close();
 const restarted=await NativeUsageLogins.open(root);await restarted.observe({claude:b,codex:null},now+21000);await restarted.observe({claude:b,codex:null},now+25000);
 // Suspended/backgrounded app: never bridge an unobserved interval, even for the same account.
 await restarted.observe({claude:b,codex:null},now+60000);await restarted.observe({claude:b,codex:null},now+65000);
 const intervals=await readNativeLoginIntervals(root),rows=enrichNativeLoginRows([-1000,2500,7500,12500,18000,20500,23000,40000,62000].map(delta=>row(now+delta)),intervals);
 expect(rows.map(r=>r.nativeAccountId)).toEqual([undefined,nativeIdentity('claude',a.accountId),undefined,nativeIdentity('claude',b.accountId),undefined,undefined,nativeIdentity('claude',b.accountId),undefined,nativeIdentity('claude',b.accountId)]);
 const persisted=await readFile(join(root,'native-usage-logins.json'),'utf8');expect(persisted).not.toMatch(/account-a|account-b|accessToken|refreshToken|"organization":"org"/);
 expect(restarted.accounts().map(a=>a.label).sort()).toEqual(['a@example.test','b@example.test']);
 if(process.platform!=='win32')expect((await stat(join(root,'native-usage-logins.json'))).mode&0o777).toBe(0o600);
});

it('keeps explicit API, other agents, request identities and conflicts outside the fallback',async()=>{
 const {root,store}=await setup();await store.observe({claude:login('a'),codex:null},now);await store.observe({claude:login('a'),codex:null},now+5000);
 const known=nativeIdentity('claude','request-account'),rows=[row(now+1000,{channel:'api'}),row(now+1000,{target:'pi'}),row(now+1000,{nativeAccountId:known}),row(now+1000,{nativeAccountEvidence:'conflict'})];
 expect(enrichNativeLoginRows(rows,await readNativeLoginIntervals(root))).toEqual(rows);
 const original=row(now+1000),intervals=await readNativeLoginIntervals(root);expect(enrichNativeLoginRows([original],[...intervals,{...intervals[0],account:known}])[0]).toEqual(original);
 const parser=new LocalUsageParser('claude','gateway');parser.accept({type:'assistant',timestamp:new Date(now).toISOString(),message:{id:'gateway-response',model:'claude/claude-sonnet-4-6',usage:{input_tokens:100,output_tokens:20}}});expect(parser.rows()).toEqual([]);
});

it('shows an unsaved native account by name, joins saved Claude accounts by organization and separates organizations',async()=>{
 const {root,store}=await setup(),a=login('a');await store.observe({claude:a,codex:null},now);await store.observe({claude:a,codex:null},now+5000);
 const rows=enrichNativeLoginRows([row(now+1000)],await readNativeLoginIntervals(root)),local=mapNativeAccounts(rows,[],store.accounts())[0];
 expect(local).toMatchObject({sourceId:'',nativeAccountLabel:a.email});
 const pool=[{id:'right',provider:'claude',accountId:a.accountId,email:a.email,organizationId:'org'},{id:'other-org',provider:'claude',accountId:a.accountId,email:a.email,organizationId:'other'}];
 expect(mapNativeAccounts(rows,pool)[0].sourceId).toBe('right');expect(mapNativeAccounts([{...rows[0],nativeOrganizationId:undefined}],pool)[0].sourceId).toBe('');
 expect(mapNativeAccounts([{...local,channel:'api'}],pool,store.accounts())[0]).toMatchObject({sourceId:'',nativeAccountLabel:undefined});
 expect(sourceKey(local)).not.toBe(sourceKey({...local,nativeOrganizationId:nativeIdentity('claude-organization','other')}));
 const snapshot={accounts:[],providers:[],apiSources:[]} as unknown as LocalAgentSnapshot;
 expect(describeSource(snapshot,sourceKey(local),[local])).toMatchObject({label:'a@example.test',sub:expect.stringContaining('本机登录识别')});
});

it('keeps request-level proof above a login inference regardless of duplicate file order',()=>{
 const inferred=row(now,{channel:'official',nativeAccountId:nativeIdentity('claude','a'),nativeAccountEvidence:'login-snapshot'}),verified={...inferred,nativeAccountEvidence:'otel' as const},other={...inferred,nativeAccountId:nativeIdentity('claude','b')};
 for(const rows of [[verified,inferred,other],[other,inferred,verified],[inferred,verified,other]])expect(mergeLocalUsageRows(rows)[0]).toMatchObject({requests:1,nativeAccountId:verified.nativeAccountId,nativeAccountEvidence:'otel'});
});

it('preserves a damaged attribution file and leaves usage unattributed',async()=>{
 const {root}=await setup(),file=join(root,'native-usage-logins.json');await writeFile(file,'damaged-original');const store=await NativeUsageLogins.open(root);await store.observe({claude:login('a'),codex:null},now);
 expect(store.warning).toContain('保留原文件');expect(await readFile(file,'utf8')).toBe('damaged-original');expect(await readNativeLoginIntervals(root)).toEqual([]);
});
