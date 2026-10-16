import {afterEach,expect,it,vi} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,realpath,symlink,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {readCursorConversations,cursorConversationHash,rememberCursorGatewayConversation,cursorGatewayConversations} from '../packages/core/src/cursor-conversations.js';
import {CursorNativeUsage,type CursorUsageReader} from '../packages/core/src/cursor-native-usage.js';
import {LocalUsageIndex} from '../packages/core/src/local-usage-index.js';
import type {LocalUsageSnapshot} from '../packages/core/src/local-usage.js';
import type {CursorUsageEvent} from '../packages/core/src/cursor-usage.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
const cleanup:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();vi.restoreAllMocks();});
async function root(){const path=await mkdtemp(join(await realpath(tmpdir()),'cursor-native-'));cleanup.push(()=>rm(path,{recursive:true,force:true}));return path;}
const now=()=>Date.now()-10000;
const local=(ids=['ide-chat']):LocalUsageSnapshot=>({rows:[],recent:[],cursorConversations:ids.map(id=>({hash:cursorConversationHash(id),createdAt:now()-100000})),coverage:[{target:'cursor',files:1,indexed:1,skipped:0,status:'ready'}],scanning:false});
const event=(extra:Partial<CursorUsageEvent>={}):CursorUsageEvent=>({conversationId:'ide-chat',timestamp:now(),model:'gemini-fixture-medium',isHeadless:false,tokenUsage:{inputTokens:10,outputTokens:5,cacheReadTokens:20,cacheWriteTokens:3},...extra});
const reader=(email:string,events:CursorUsageEvent[]):CursorUsageReader&{email:string}=>({id:email.split('@')[0],email,revision:email,read:vi.fn(async()=>({email,events,complete:true}))});

it('selects only local composer identity/time across current and legacy SQLite metadata, with no login or content returned',async()=>{
 const path=join(await root(),'state.vscdb'),db=new DatabaseSync(path),time=now();
 db.exec('CREATE TABLE composerHeaders(composerId TEXT,createdAt INTEGER);CREATE TABLE cursorDiskKV(key TEXT,value TEXT);CREATE TABLE ItemTable(key TEXT,value TEXT)');
 db.prepare('INSERT INTO composerHeaders VALUES (?,?)').run('ide-chat',time);
 db.prepare('INSERT INTO cursorDiskKV VALUES (?,?)').run('composerData:ide-chat',JSON.stringify({composerId:'ide-chat',createdAt:time,text:'DO_NOT_STORE_MESSAGE',blobEncryptionKey:'DO_NOT_STORE_SECRET'}));
 db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('composer.composerData',JSON.stringify({allComposers:[{composerId:'legacy-chat',createdAt:time-1000}]}));
 db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('cursorAuth/accessToken','DO_NOT_READ_NATIVE_TOKEN');db.close();
 const before=await readFile(path),rows=await readCursorConversations(path);
 expect(rows).toEqual([{hash:cursorConversationHash('ide-chat'),createdAt:time},{hash:cursorConversationHash('legacy-chat'),createdAt:time-1000}]);
 expect(JSON.stringify(rows)).not.toMatch(/ide-chat|legacy-chat|DO_NOT_/);expect(await readFile(path)).toEqual(before);
 const link=path+'.link';await symlink(path,link);await expect(readCursorConversations(link)).rejects.toThrow();
 await expect(readCursorConversations(path+'.missing')).rejects.toThrow();await expect(stat(path+'.missing')).rejects.toThrow();
});

it('worker detects SQLite WAL appends and restores only hashed composer metadata from cache',async()=>{
 const dir=await root(),path=join(dir,'state.vscdb'),db=new DatabaseSync(path);db.exec('CREATE TABLE composerHeaders(composerId TEXT,createdAt INTEGER);PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0');
 db.prepare('INSERT INTO composerHeaders VALUES (?,?)').run('first-native-chat',now());
 let index=new LocalUsageIndex(dir,agentPaths(dir),()=>[],{cursor:[path]});cleanup.push(()=>index.close());cleanup.push(async()=>{db.close();});
 const ready=async()=>{index.snapshot();await vi.waitFor(()=>expect(index.snapshot().scanning).toBe(false),{timeout:5000,interval:25});return index.snapshot();};
 expect((await ready()).cursorConversations).toHaveLength(1);const stamp=(await stat(path)).mtimeMs;
 db.prepare('INSERT INTO composerHeaders VALUES (?,?)').run('second-native-chat',now());expect((await stat(path)).mtimeMs).toBe(stamp);
 index.refresh();expect((await ready()).cursorConversations).toHaveLength(2);await index.close();
 const saved=JSON.parse(await readFile(join(dir,'local-usage-index.json'),'utf8'));for(const entry of Object.values(saved.files) as Array<{target:string;cursorConversations?:unknown}>){if(entry.target==='cursor')delete entry.cursorConversations;}await writeFile(join(dir,'local-usage-index.json'),JSON.stringify(saved));
 index=new LocalUsageIndex(dir,agentPaths(dir),()=>[],{cursor:[path]});expect((await ready()).cursorConversations).toHaveLength(2);
 expect(await readFile(join(dir,'local-usage-index.json'),'utf8')).not.toMatch(/first-native-chat|second-native-chat|DO_NOT_/);
});

it('joins exact local conversations to the billed account, excluding SDK, other devices, cloud and incomplete token entries',async()=>{
 const dir=await root(),at=now(),source=reader('a@example.test',[
  event({timestamp:at}),event({timestamp:at}), // duplicate page item
  event({conversationId:'sdk-agent'}),event({conversationId:'another-device'}),
  event({timestamp:at+1,cloudAgentId:'cloud'}),event({timestamp:at+2,automationId:'automation'}),event({timestamp:at+3,isHeadless:true}),
  event({timestamp:at+4,clientType:'cli'}),event({timestamp:at+5,tokenUsage:undefined}),event({timestamp:at+6,userEmail:'other@example.test'}),
 ]),collector=await CursorNativeUsage.open(dir,()=>[source]);cleanup.push(()=>collector.close());
 await rememberCursorGatewayConversation(dir,'sdk-agent',at);
 await collector.refresh(local(['ide-chat','sdk-agent']));
 expect(collector.rows()).toHaveLength(1);expect(collector.rows()[0]).toMatchObject({target:'cursor',origin:'native',channel:'official',nativeAccountEvidence:'billing',requests:1,inputTokens:33,cachedTokens:20,cacheWriteTokens:3,outputTokens:5,cacheBaseTokens:33});
 expect(collector.snapshot(local(['ide-chat','sdk-agent'])).coverage).toMatchObject({status:'ready',skipped:1});
 const raw=await readFile(join(dir,'cursor-native-usage.json'),'utf8');expect(raw).not.toMatch(/ide-chat|sdk-agent|example.test|accessToken|apiKey|DO_NOT_/);
 expect(await cursorGatewayConversations(dir)).toEqual(new Set([cursorConversationHash('sdk-agent')]));
});

it('preserves per-account history on failed/incomplete or mismatched billing and corrects a settled sample instead of double counting',async()=>{
 const dir=await root(),at=now(),a=reader('a@example.test',[event({timestamp:at})]),b=reader('b@example.test',[event({timestamp:at+1000})]);
 const collector=await CursorNativeUsage.open(dir,()=>[a,b]);cleanup.push(()=>collector.close());await collector.refresh(local());expect(collector.rows()).toHaveLength(2);
 a.read=vi.fn(async()=>({email:a.email,events:[event({timestamp:at,tokenUsage:{inputTokens:10,cacheReadTokens:20,cacheWriteTokens:3,outputTokens:29}})],complete:true}));
 b.read=vi.fn(async()=>({email:b.email,events:[],complete:false}));await collector.refresh(local());expect(collector.rows()).toHaveLength(2);expect(collector.rows().reduce((s,r)=>s+r.outputTokens,0)).toBe(34);expect(collector.snapshot(local()).warning).toContain('未完整核对');
 a.read=vi.fn(async()=>({email:'wrong@example.test',events:[event({timestamp:at})],complete:true}));await collector.refresh(local());expect(collector.rows().reduce((s,r)=>s+r.outputTokens,0)).toBe(34);
 await collector.close();const reopened=await CursorNativeUsage.open(dir,()=>[]);cleanup.push(()=>reopened.close());expect(reopened.rows()).toEqual(collector.rows());
});

it('does not erase previously measured tokens when a delayed bill temporarily omits tokenUsage',async()=>{
 const dir=await root(),at=now(),source=reader('a@example.test',[event({timestamp:at})]),collector=await CursorNativeUsage.open(dir,()=>[source]);cleanup.push(()=>collector.close());
 await collector.refresh(local());source.read=async()=>({email:source.email,events:[event({timestamp:at,tokenUsage:undefined})],complete:true});await collector.refresh(local());
 expect(collector.rows()).toHaveLength(1);expect(collector.rows()[0].inputTokens).toBe(33);expect(collector.snapshot(local()).coverage.skipped).toBe(1);
});

it('keeps a prior settlement when the same conversation/time/model returns conflicting event counters',async()=>{
 const dir=await root(),at=now(),source=reader('a@example.test',[event({timestamp:at})]),collector=await CursorNativeUsage.open(dir,()=>[source]);cleanup.push(()=>collector.close());
 await collector.refresh(local());source.read=async()=>({email:source.email,complete:true,events:[event({timestamp:at}),event({timestamp:at,tokenUsage:{inputTokens:10,cacheReadTokens:20,cacheWriteTokens:3,outputTokens:29}})]});await collector.refresh(local());
 expect(collector.rows()).toHaveLength(1);expect(collector.rows()[0].outputTokens).toBe(5);expect(collector.snapshot(local()).coverage.skipped).toBe(1);
});

it('returns cached snapshots while querying, coalesces scans, and cancels a pending query on close',async()=>{
 const dir=await root();let signal:AbortSignal|undefined;
 const source=reader('a@example.test',[]);source.read=vi.fn(async(_s,_e,s)=>{signal=s;await new Promise<void>(resolve=>s.addEventListener('abort',()=>resolve(),{once:true}));return {email:source.email,events:[],complete:true};});
 const collector=await CursorNativeUsage.open(dir,()=>[source]);const snapshot=collector.snapshot(local());expect(snapshot.scanning).toBe(true);expect(snapshot.rows).toEqual([]);
 await vi.waitFor(()=>expect(source.read).toHaveBeenCalledOnce());collector.snapshot(local());expect(source.read).toHaveBeenCalledOnce();await collector.close();expect(signal?.aborted).toBe(true);
});

it('does not contact saved authorizations without local conversation proof and stops showing counters when gateway exclusions are unreadable',async()=>{
 const dir=await root(),source=reader('a@example.test',[event()]),collector=await CursorNativeUsage.open(dir,()=>[source]);cleanup.push(()=>collector.close());
 await collector.refresh({...local(),coverage:[{target:'cursor',files:0,indexed:0,skipped:0,status:'unavailable'}]});expect(source.read).not.toHaveBeenCalled();
 await collector.refresh(local());expect(collector.rows()).toHaveLength(1);const cache=await readFile(join(dir,'cursor-native-usage.json'));
 await writeFile(join(dir,'cursor-gateway-conversations.jsonl'),'broken append');await collector.refresh(local());expect(collector.rows()).toEqual([]);expect(collector.snapshot(local()).warning).toContain('排重记录暂不可读');expect(await readFile(join(dir,'cursor-native-usage.json'))).toEqual(cache);
});
