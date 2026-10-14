import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {chromium} from 'playwright';
import {createDesktopService} from '../packages/core/src/service.js';

// Real configuration restoration behind the built UI, with isolated paths and
// a fake upstream. The restart request is intercepted so no user app is stopped.
const root=await mkdtemp(join(await realpath(tmpdir()),'config-restore-ui-'));
const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));
const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
const config=join(root,'codex/config.toml'),original='model="native-model"';
await mkdir(join(root,'codex'));await writeFile(config,original);await mkdir(join(root,'cliproxy'));
await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'fixture.json',provider:'codex',status:'active',models:['model-a']}]));
const service=await createDesktopService({root,token:'fixture-admin',localKey:'fixture-key',proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),uiRoot:resolve('dist/console'),secrets:{get:async()=>'',set:async()=>{}},agentProcesses:async()=>[],agentPaths:{codex:config,claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json'),qoder:join(root,'qoder/settings.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/settings.yml')}});
let browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
 await service.proxy.start();const address=await service.app.listen({host:'127.0.0.1',port:0});
 const headers={host:new URL(address).host,authorization:'Bearer fixture-admin'};
 const state=async()=>(await service.app.inject({url:'/api/a2a',headers})).json().targets.find((t:{id:string})=>t.id==='codex');
 const target=await state();
 const connected=await service.app.inject({method:'POST',url:'/api/a2a/connect',headers,payload:{target:'codex',sourceId:service.proxy.snapshot().accounts[0].id,model:'codex/model-a',revision:target.revision}});
 assert.equal(connected.statusCode,200,connected.body);
 browser=await chromium.launch({channel:'chrome',headless:true});const context=await browser.newContext({viewport:{width:1320,height:900}});
 await context.addCookies([{url:address,name:'agent_session',value:'fixture-admin',httpOnly:true,sameSite:'Strict'}]);
 const page=await context.newPage();page.setDefaultTimeout(15000);const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
 await page.route('**/api/a2a/program-updates',route=>route.fulfill({json:{updates:{}}}));
 await page.route('**/api/a2a',async route=>{const response=await route.fetch();const data=await response.json();data.targets=data.targets.map((t:{id:string;installation:object})=>t.id==='codex'?{...t,restartSupported:true,installation:{...t.installation,installed:true}}:t);await route.fulfill({json:data});});
 let submitted=0;
 await page.route('**/api/a2a/restore',async route=>{
  const input=route.request().postDataJSON();assert.equal(input.restoreHistory,false);assert.equal(input.restartCodex,true);submitted++;
  const response=await route.fetch({postData:JSON.stringify({...input,restartCodex:false})});await route.fulfill({response});
 });
 await page.goto(address);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
 const panel=page.getByRole('region',{name:'Codex',exact:true});assert.equal(await panel.getByRole('button',{name:'还原旧对话',exact:true}).count(),0);
 await panel.getByRole('button',{name:'恢复原配置',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'恢复 Codex 原配置',exact:true});await dialog.waitFor();
 const checkbox=dialog.getByRole('checkbox');assert.equal(await checkbox.isChecked(),false);
 await checkbox.check();await dialog.getByText(/处理失败可能中止恢复/).waitFor();await checkbox.uncheck();
 await dialog.getByRole('button',{name:'只恢复原配置',exact:true}).click();await dialog.waitFor({state:'hidden'});
 assert.equal(submitted,1);assert.equal(await readFile(config,'utf8'),original);assert.equal((await state()).connection,null);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({restoreUI:'passed',historyOptIn:true,singleConfirmation:true,configurationRestored:true,userAppRestarted:false}));
}finally{await browser?.close();await service.app.close();await rm(root,{recursive:true,force:true});}
