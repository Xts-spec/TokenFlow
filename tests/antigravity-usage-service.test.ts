import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';
import {createDesktopService} from '../packages/core/src/service.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import {NativeUsageLogins} from '../packages/core/src/native-usage-logins.js';
import {agDatabase,agGeneration} from './fixtures/antigravity-usage.js';

it('exposes direct Antigravity usage by observed account in overview and activity, including inactive saved accounts after restart',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-service-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const paths=agentPaths(root),dir=join(root,'.gemini/antigravity-ide/conversations');await mkdir(dir,{recursive:true});await mkdir(join(root,'cliproxy/auth'),{recursive:true});
 const now=Math.floor((Date.now()-60000)/1000)*1000,logins=await NativeUsageLogins.open(root);
 for(const [i,name]of ['a','b'].entries()){const email=`${name}@example.test`,login={provider:'antigravity' as const,accountId:email,email};await logins.observe({antigravity:login},now+i*10000);await logins.observe({antigravity:login},now+i*10000+5000);await writeFile(join(root,'cliproxy/auth',name+'.json'),JSON.stringify({email,access_token:'fixture-access',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));}
 agDatabase(join(dir,'native.db'),agGeneration('a',now+1000));const db=new DatabaseSync(join(dir,'native.db'));for(const [idx,at]of [[1,now+12000],[2,now-10000]]){const data=agGeneration(`response-${idx}`,at);db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(idx,data,data.length);}db.close();
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(['a','b'].map(name=>({name:name+'.json',email:name+'@example.test',provider:'antigravity',status:'active',models:['gemini-fixture']}))));
 const options={root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),agentPaths:paths,agentProcesses:async()=>[],nativeProcesses:async()=>[],claudeCredentialStore:null,antigravityPath:join(root,'no-login.db'),desktopAccounts:{paths:{qoder:join(root,'no-qoder'),workbuddy:join(root,'no-workbuddy'),'workbuddy-ai':join(root,'no-ai')}},token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}}};
 let service=await createDesktopService(options);const headers={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const overview=async()=>{let data:any;await expect.poll(async()=>{data=(await service.app.inject({url:'/api/usage/overview?days=0',headers})).json();return data.scanning?0:data.nativeRows.length;},{timeout:5000}).toBe(3);return data;};
 try{
  await service.proxy.start();const snapshot=await overview(),accounts=service.proxy.snapshot().accounts;
  expect(snapshot.rows).toEqual([]);for(const account of accounts){expect(snapshot.nativeRows.find((r:any)=>r.sourceId===account.id)).toMatchObject({origin:'native',target:'antigravity',provider:'antigravity',channel:'official',requests:1,inputTokens:100,outputTokens:30,nativeAccountEvidence:'login-snapshot',nativeAccountLabel:account.label});}
  expect(snapshot.nativeRows.filter((r:any)=>!r.sourceId)).toHaveLength(1);
  const activity=(await service.app.inject({url:'/api/activity/traces?days=0',headers})).json().records;expect(activity.filter((r:any)=>r.sourceId).map((r:any)=>r.sourceId).sort()).toEqual(accounts.map(a=>a.id).sort());
  expect(snapshot.coverage.find((c:any)=>c.target==='antigravity')).toMatchObject({status:'ready',indexed:1});expect(snapshot.coverage.find((c:any)=>c.target==='cursor')).toMatchObject({status:'unavailable',files:0});
  await service.proxy.setAccountEnabled(accounts[0].id,false);await service.app.close();service=await createDesktopService(options);await service.proxy.start();const restarted=await overview();expect(restarted.nativeRows).toEqual(snapshot.nativeRows);
  expect(await readFile(join(root,'local-usage-index.json'),'utf8')).not.toMatch(/DO_NOT_STORE|fixture-access|example\.test/);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
},15000);
