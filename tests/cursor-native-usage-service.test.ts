import {expect,it,vi} from 'vitest';
import {mkdtemp,realpath,rm,readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopService} from '../packages/core/src/service.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import {cursorGatewayConversations,cursorConversationHash} from '../packages/core/src/cursor-conversations.js';
const sdk=vi.hoisted(()=>({create:vi.fn()}));
vi.mock('@cursor/sdk',()=>({Cursor:{models:{list:async()=>[{id:'fixture-model',displayName:'Fixture'}]}},Agent:{create:sdk.create},JsonlLocalAgentStore:class{}}));

it('exposes billed IDE usage by authorization in overview, account snapshot and activity while counting the SDK request only in the gateway ledger',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'cursor-native-service-')),path=join(root,'state.vscdb'),db=new DatabaseSync(path),at=Date.now()-10000;
 db.exec('CREATE TABLE composerHeaders(composerId TEXT,createdAt INTEGER);CREATE TABLE ItemTable(key TEXT,value TEXT)');
 for(const id of ['ide-chat','sdk-agent'])db.prepare('INSERT INTO composerHeaders VALUES (?,?)').run(id,at-10000);
 db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('cursorAuth/accessToken','DO_NOT_READ_NATIVE_CREDENTIAL');db.close();const nativeBefore=await readFile(path);
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const originalFetch=globalThis.fetch;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{
  if(String(url).startsWith('http://127.0.0.1:'))return originalFetch(url,init);
  const method=String(url).split('/').pop(),auth=new Headers(init?.headers).get('Authorization')??'',who=auth.endsWith('-b')?'b':'a';
  if(method==='exchange_user_api_key')return Response.json({accessToken:`session-${who}`});
  if(method==='GetMe')return Response.json({email:`${who}@example.test`});
  if(method==='GetPlanInfo')return Response.json({planInfo:{planName:'Pro'}});
  if(method==='GetCurrentPeriodUsage')return Response.json({planUsage:{totalPercentUsed:1}});
  if(method==='GetFilteredUsageEvents')return Response.json({totalUsageEventsCount:3,usageEventsDisplay:[
   {timestamp:String(at+(who==='b'?1000:0)),model:'fixture-model',conversationId:'ide-chat',isHeadless:false,tokenUsage:{inputTokens:10,cacheReadTokens:20,cacheWriteTokens:3,outputTokens:5}},
   {timestamp:String(at+2000),model:'fixture-model',conversationId:'sdk-agent',isHeadless:false,tokenUsage:{inputTokens:7,cacheReadTokens:2,cacheWriteTokens:1,outputTokens:3}},
   {timestamp:String(at+3000),model:'fixture-model',conversationId:'another-device',tokenUsage:{inputTokens:999,outputTokens:999}},
  ]});
  throw Error('Unexpected outbound request');
 });
 const vault=new Map<string,string>();
 // SDK grants may omit email. GetMe must establish B's identity, never borrow
 // the IDE's current login or require writing the authorization back to disk.
 const credentials=JSON.stringify({version:1,accounts:['a','b'].map(who=>({...(who==='a'?{email:`${who}@example.test`}:{}),apiKey:`fixture-${who}`}))});
 const options={root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'internal',cursorLocalPath:path,agentPaths:agentPaths(root),agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'absent-ag.db'),desktopAccounts:{paths:{workbuddy:join(root,'absent-wb'),'workbuddy-ai':join(root,'absent-ai'),qoder:join(root,'absent-qoder')}},secrets:{get:async(name:string)=>name==='cursor-account'?credentials:vault.get(name)??'',set:async(name:string,value:string)=>{if(name==='cursor-account')throw Error('Must not change authorizations');vault.set(name,value);}}};
 let service=await createDesktopService(options);const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const overview=async()=>{let data:any;await expect.poll(async()=>{data=(await service.app.inject({url:'/api/usage/overview?days=0',headers})).json();return data.scanning?-1:data.nativeRows.filter((r:any)=>r.target==='cursor').length;},{timeout:5000}).toBe(2);return data;};
 try{
  sdk.create.mockResolvedValue({agentId:'sdk-agent',close:async()=>{},send:async()=>{
   expect(await cursorGatewayConversations(root)).toContain(cursorConversationHash('sdk-agent'));
   return {cancel:async()=>{},wait:async()=>({status:'finished',result:'OK',usage:{inputTokens:7,outputTokens:3,cacheReadTokens:2,cacheWriteTokens:1,totalTokens:13}})};
  }});
  await service.proxy.start();await service.proxy.cursor.refresh();const accounts=service.proxy.cursor.snapshot().accounts;
  const key=await service.app.inject({url:'/api/gateway-keys',method:'POST',headers,payload:{name:'fixture',sourceId:accounts[0].id,models:['cursor/fixture-model']}});expect(key.statusCode,key.body).toBe(200);
  const response=await service.app.inject({url:'/v1/responses',method:'POST',headers:{...headers,authorization:`Bearer ${key.json().apiKey}`},payload:{model:'cursor/fixture-model',input:'Fixture only'}});expect(response.statusCode,response.body).toBe(200);
  const result=await overview();expect(result.rows).toHaveLength(1);expect(result.rows[0]).toMatchObject({requests:1,inputTokens:10,outputTokens:3});
  for(const [index,account]of accounts.entries())expect(result.nativeRows.find((r:any)=>r.sourceId===account.id)).toMatchObject({target:'cursor',nativeAccountLabel:`${index===0?'a':'b'}@example.test`,nativeAccountEvidence:'billing',inputTokens:33,outputTokens:5,requests:1});
  const activity=(await service.app.inject({url:'/api/activity/traces?days=0',headers})).json().records;
  expect(activity.filter((r:any)=>r.origin==='native')).toHaveLength(2);expect(activity.filter((r:any)=>r.origin==='native').every((r:any)=>r.accountEvidence==='billing')).toBe(true);
  const detail=await service.app.inject({url:`/api/activity/traces/${activity.find((r:any)=>r.origin==='native').id}`,headers});expect(detail.statusCode).toBe(200);expect(detail.body).toContain('billing');
  expect(result.coverage.find((c:any)=>c.target==='cursor')).toMatchObject({status:'ready',indexed:1});
  await service.app.close();service=await createDesktopService(options);await service.proxy.cursor.load();const restarted=await overview();expect(restarted.nativeRows).toEqual(result.nativeRows);expect(restarted.rows).toEqual(result.rows);
  expect(await readFile(path)).toEqual(nativeBefore);expect(fetcher.mock.calls.some(([url])=>String(url).endsWith('/CreateUserApiKey'))).toBe(false);
  for(const name of ['cursor-native-usage.json','cursor-gateway-conversations.jsonl','local-usage-index.json'])expect(await readFile(join(root,name),'utf8')).not.toMatch(/DO_NOT_|fixture-a|session-a|example\.test|ide-chat|sdk-agent/);
 }finally{await service.app.close();vi.restoreAllMocks();await rm(root,{recursive:true,force:true});}
},15000);
