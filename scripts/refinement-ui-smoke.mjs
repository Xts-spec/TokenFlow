import {_electron as electron,chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

// Isolated app profile and loopback fixtures; never touches installed keys or accounts.
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-refinement-'));
const output=resolve('output/playwright/refinement');
const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));
const port=allocator.address().port;await new Promise(r=>allocator.close(r));
let app;
try{
 await mkdir(output,{recursive:true});await mkdir(join(root,'cliproxy'),{recursive:true});
 const accountModels=Array.from({length:16},(_,i)=>`account-model-${i+1}`);
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});
 await writeFile(join(root,'cliproxy/auth/codex.json'),JSON.stringify({type:'codex',email:'return@example.test',access_token:'fixture-only',refresh_token:'fixture-only'}));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',email:'return@example.test',auth_index:'return-codex',status:'active',models:accountModels}]));
 const bootstrap=join(root,'bootstrap.cjs');
 await writeFile(bootstrap,`const os=require('node:os');os.homedir=()=>${JSON.stringify(root)};const cp=require('node:child_process');const original=cp.execFile;cp.execFile=function(file,args,...rest){if(file==='ps'){rest.at(-1)(null,'','');return {on(){},kill(){}};}return original.call(this,file,args,...rest);};cp.execFile[require('node:util').promisify.custom]=async(file,args,options)=>file==='ps'?{stdout:'',stderr:''}:require('node:util').promisify(original)(file,args,options);require('node:module').syncBuiltinESMExports();import(${JSON.stringify(new URL('../dist/main.js',import.meta.url).href)});`);
 const env=Object.fromEntries(['PATH','DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','SYSTEMROOT','WINDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
 app=await electron.launch({args:['--disable-gpu',bootstrap],env:{...env,HOME:root,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),PI_CODING_AGENT_DIR:join(root,'pi'),DSH_HOME:join(root,'dsh'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
 const page=await app.firstWindow();page.setDefaultTimeout(15000);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1320,900);w.hide();w.webContents.setBackgroundThrottling(false);});
 await page.route('**/api/a2a/program-updates',r=>r.fulfill({json:{updates:{}}}));
 await page.route('**/api/a2a/program',r=>r.fulfill({status:409,json:{error:'Installation is disabled in this UI fixture'}}));
 const api=(path,body)=>page.evaluate(async({path,body})=>{const r=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})});if(!r.ok)throw Error(`${r.status} ${path}`);return r.json();},{path,body});
 const wait=async(path,predicate)=>{for(let i=0;i<150;i++){const value=await api(path);if(predicate(value))return value;await page.waitForTimeout(100);}throw Error(`Timed out: ${path}`);};
 await wait('/api/local-agent',s=>s.state==='running');
 const modelNames=Array.from({length:16},(_,i)=>`model-${i+1}`);
 const source=await api('/api/sources',{name:'Return API',baseURL:'http://127.0.0.1:1/v1',protocol:'chat',apiKey:'fixture-only',models:modelNames});
 const models=modelNames.map(id=>`api-${source.id}/${id}`);
 await wait('/api/local-agent',s=>s.models.some(m=>m.id===models[0]));
 for(let i=0;i<8;i++)await api('/api/gateway-keys',{name:`Key ${i+1}`,purpose:`Purpose ${i+1}`,models:i===0?models:models.slice(i,i+2),sourceId:source.id,agents:['openai'],tokenLimit:null});
 await page.reload();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'CLI 代理',exact:true}).click();
 await page.getByRole('article',{name:'Key 8',exact:true}).waitFor();


 assert.equal(await page.title(),'TokenFlow');assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getTitle()),'TokenFlow');
 const nav=page.getByRole('navigation',{name:'主导航'}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const shot=name=>page.screenshot({timeout:30000,animations:'disabled',path:join(output,name)});
 assert.equal(await page.getByRole('button',{name:'切换浅色外观'}).count(),0);
 const divider=page.getByRole('separator',{name:'调整菜单宽度'});
 await divider.focus();await page.keyboard.press('ArrowRight');assert.equal(await divider.getAttribute('aria-valuenow'),'290');
 // Verify real pointer capture in Chromium; native macOS titlebar regions intercept CDP drags.
 const browser=await chromium.launch({headless:true});
 try{
  const context=await browser.newContext({viewport:{width:1320,height:900},storageState:await page.context().storageState()});const browserPage=await context.newPage();await browserPage.goto(page.url());
  const browserDivider=browserPage.getByRole('separator',{name:'调整菜单宽度'});await browserDivider.waitFor();await browserDivider.focus();await browserPage.keyboard.press('Home');await browserPage.keyboard.press('ArrowRight');
  const box=await browserDivider.boundingBox();await browserPage.mouse.move(box.x+4,box.y+60);await browserPage.mouse.down();await browserPage.mouse.move(box.x+44,box.y+60,{steps:8});await browserPage.mouse.up();await browserPage.waitForFunction(()=>document.querySelector('.tfSidebarDivider')?.getAttribute('aria-valuenow')==='290');
  await browserPage.reload();await browserPage.waitForFunction(()=>document.querySelector('.tfSidebarDivider')?.getAttribute('aria-valuenow')==='290');
 }finally{await browser.close();}
 if(process.platform==='darwin'){const geometry=await page.evaluate(()=>{const side=document.querySelector('.tfSide').getBoundingClientRect(),bar=document.querySelector('.tfTitlebar').getBoundingClientRect();return {sideRight:side.right,barLeft:bar.left};});assert.ok(Math.abs(geometry.sideRight-geometry.barLeft)<1,'sidebar and titlebar align after dragging');}

 await divider.focus();await page.keyboard.press('Home');await page.keyboard.press('ArrowLeft');assert.equal(await divider.getAttribute('aria-valuenow'),'240');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 const appearance=page.getByRole('region',{name:'外观设置',exact:true});await appearance.waitFor();
 assert.equal(await appearance.getByRole('button',{name:'深色外观',exact:true}).getAttribute('aria-pressed'),'true');await shot('appearance-dark.png');
 await appearance.getByRole('button',{name:'浅色外观',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
 assert.equal(await page.locator('.tfSettingsPage>.tfPanel').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');await shot('appearance-light.png');await appearance.getByRole('button',{name:'深色外观',exact:true}).click();
 await nav.getByRole('button',{name:'API 接口',exact:true}).click();
 const card=page.getByRole('article',{name:source.name,exact:true});
 const cardBox=await card.boundingBox();assert.equal(Math.round(cardBox.height),228);assert.equal(await card.locator('.tfFlipAction').count(),0);assert.equal(await page.locator('.tfCollectionHead h2').count(),0);
 // Adding asks first; skipping does not use the protocol-probing endpoint.
 await page.getByRole('button',{name:'添加 API',exact:true}).click();const add=page.getByRole('dialog',{name:'添加 API',exact:true});
 await add.getByRole('textbox',{name:'名称备注',exact:true}).fill('Skip fixture');await add.getByRole('textbox',{name:'URL',exact:true}).fill('https://fixture.example/v1');await add.getByRole('textbox',{name:'API Key',exact:true}).fill('fixture-only');await add.getByRole('textbox',{name:'模型名称',exact:true}).fill('fixture-model');
 let savedRequest,probes=0;await page.route('**/api/sources/quick',async route=>{probes++;savedRequest=route.request().postDataJSON();await route.fulfill({json:{...source,name:'Skip fixture'}});});await page.route('**/api/sources',async route=>{savedRequest=route.request().postDataJSON();await route.fulfill({json:{...source,name:'Skip fixture'}});});
 await add.getByRole('button',{name:'添加',exact:true}).click();const verify=page.getByRole('dialog',{name:'验证接口？',exact:true});await verify.waitFor();assert.equal(savedRequest,undefined);await shot('verify-question.png');await verify.getByRole('combobox',{name:'接口协议',exact:true}).selectOption('messages');await verify.getByRole('button',{name:'跳过验证，直接保存',exact:true}).click();await add.waitFor({state:'hidden'});assert.equal(probes,0);assert.equal(savedRequest.protocol,'messages');assert.deepEqual(savedRequest.models,['fixture-model']);
 await page.getByRole('button',{name:'添加 API',exact:true}).click();await add.getByRole('textbox',{name:'名称备注',exact:true}).fill('Verify fixture');await add.getByRole('textbox',{name:'URL',exact:true}).fill('https://fixture.example/v1');await add.getByRole('textbox',{name:'API Key',exact:true}).fill('fixture-only');await add.getByRole('textbox',{name:'模型名称',exact:true}).fill('fixture-model');await add.getByRole('button',{name:'添加',exact:true}).click();await verify.getByRole('button',{name:'验证并保存',exact:true}).click();await add.waitFor({state:'hidden'});assert.equal(probes,1);assert.equal(savedRequest.model,'fixture-model');await page.unroute('**/api/sources');await page.unroute('**/api/sources/quick');
assert.equal(await card.getByRole('button',{name:/支持模型/}).count(),0);assert.equal(await card.locator('.tfApiCardTools .tfApiCardManage button').count(),3);
 const frontFlip=await card.locator('.tfApiSourceBody .tfCardFlipSurface').boundingBox();assert.equal(await page.getByText('模型来源集中在这里',{exact:false}).count(),0);
 await shot('api-front.png');await card.getByRole('button',{name:`翻面查看 ${source.name} 凭证`}).click({position:{x:8,y:8}});assert.equal(await card.locator('.tfCredentialModels li').count(),16);assert.equal(await card.getByRole('button',{name:'复制全部',exact:true}).count(),1);await page.mouse.move(1000,100);await page.waitForTimeout(220);await shot('api-credentials.png');const backFlip=await card.locator('.tfCredentialBack .tfCardFlipSurface').boundingBox();assert.ok(Math.abs(frontFlip.x-backFlip.x)<1&&Math.abs(frontFlip.y-backFlip.y)<1,'flip controls stay in the same position');
 await card.getByRole('button',{name:`返回 ${source.name} 卡片正面`}).click({position:{x:8,y:8}});
 let loginStatus='waiting_for_browser';
 await page.route('**/api/local-agent',async route=>{const data=await (await route.fetch()).json();data.login={id:'ui-login-fixture',provider:'codex',status:loginStatus,flow:'callback',url:'https://auth.openai.com/oauth/authorize?state=fixture-only',message:loginStatus==='completed'?'账号已保存，模型列表已自动刷新。':'请在浏览器完成授权。'};await route.fulfill({json:data});});
 await nav.getByRole('button',{name:'账号授权',exact:true}).click();assert.equal(await page.locator('.tfProviderTabs>button small').count(),0);assert.equal(await page.getByRole('button',{name:'授权平台向右浏览',exact:true}).count(),0);assert.equal(await page.getByRole('tab',{name:'ZCode',exact:true}).isVisible(),true);assert.ok((await page.locator('.tfMonochromeMark[data-provider=xai]').getAttribute('style')).includes('xai-mark.svg'));await shot('accounts-compact.png');const login=page.getByRole('dialog',{name:'连接 Codex',exact:true});await login.waitFor();assert.ok(await login.getByRole('textbox',{name:'授权链接',exact:true}).isVisible());await shot('login-pending.png');
 loginStatus='completed';const complete=page.getByRole('dialog',{name:'Codex 已连接',exact:true});await complete.waitFor();await shot('login-completed.png');await complete.getByRole('button',{name:'完成',exact:true}).click();await complete.waitFor({state:'hidden'});await page.unroute('**/api/local-agent');
 await page.route('**/api/a2a',async route=>{const data=await (await route.fetch()).json();data.targets=data.targets.map(target=>({...target,installation:{...target.installation,installed:true},connection:target.id==='pi'?{id:'fixture-connection',sourceId:source.id,model:models[0],selections:[{sourceId:source.id,model:models[0]}]}:target.connection}));await route.fulfill({json:data});});
 let repairSelection,repairCheckingUntil=0;
 await page.route('**/api/maintenance',route=>{if(route.request().method()==='PUT'){repairSelection=route.request().postDataJSON();repairCheckingUntil=Date.now()+700;}return route.fulfill({json:{status:'idle',selection:repairSelection,messages:[],readiness:{status:Date.now()<repairCheckingUntil?'checking':'ready'}}});});
 await page.route('**/api/maintenance/run',route=>route.fulfill({json:{status:'completed',messages:[{role:'user',text:'检查当前连接'}],selection:{sourceId:source.id,model:models[0]},readiness:{status:'ready'}}}));
 await nav.getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/^Pi/}).click();
 await page.getByRole('button',{name:'管理所选模型',exact:true}).click();const agentPicker=page.getByRole('dialog',{name:'Pi Agent 使用的模型',exact:true});await agentPicker.waitFor();const allButton=agentPicker.getByRole('button',{name:'全选',exact:true});await allButton.waitFor();const identityBox=await agentPicker.locator('.tfAgentCatalogIdentity').boundingBox(),allBox=await allButton.boundingBox();assert.ok(allBox.x>identityBox.x+identityBox.width);await shot('agent-model-header.png');await agentPicker.getByRole('button',{name:'取消',exact:true}).click();
 await page.getByRole('button',{name:'打开维修师傅',exact:true}).click();const repair=page.getByRole('region',{name:'维修师傅',exact:true});await repair.waitFor();assert.equal(await repair.getByRole('combobox',{name:'维修目标 Agent'}).inputValue(),'pi');const targetBox=await repair.getByRole('combobox',{name:'维修目标 Agent'}).boundingBox(),titleBox=await repair.locator('h2').boundingBox();assert.ok(targetBox.x>titleBox.x+titleBox.width);await repair.getByRole('combobox',{name:'维修目标 Agent'}).focus();assert.equal(await repair.getByRole('combobox',{name:'维修目标 Agent'}).evaluate(node=>getComputedStyle(node).outlineWidth),'0px');await repair.locator('.tfModelChip').getByText('model-1',{exact:true}).waitFor();assert.equal(await repair.getByRole('button',{name:'修改 Agent 配置'}).count(),0);await shot('repair-context.png');const dispatch=page.waitForRequest('**/api/maintenance/run');await repair.getByRole('textbox').fill('检查当前连接');await repair.getByRole('button',{name:'发送',exact:true}).click();const request=(await dispatch).postDataJSON();assert.ok(Date.now()>=repairCheckingUntil,'default repair waits for asynchronous model verification');assert.equal(request.interfaceAgent,'pi');assert.equal(request.chain.target,'pi');assert.equal(request.chain.model,models[0]);await repair.getByRole('combobox',{name:'维修目标 Agent'}).selectOption('claude');assert.equal(await repair.getByRole('combobox',{name:'维修目标 Agent'}).inputValue(),'claude');await repair.getByRole('button',{name:'收起',exact:true}).click();
 const today=new Date(),day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
 const rows=Array.from({length:35},(_,i)=>{const date=new Date(today);date.setDate(date.getDate()-i);return {day:day(date),target:i%2?'codex':'key',keyId:'fixture-key',keyName:'Key 1',sourceId:source.id,model:i%2?'gpt-5.6-sol':models[0],requests:10,failed:0,unmeasured:0,inputTokens:(i+1)*10000,cachedTokens:(i+1)*8000,cacheBaseTokens:(i+1)*10000,outputTokens:(i+1)*500,durationMs:10000,last:date.toISOString()};});
 await page.route('**/api/usage/overview?**',route=>route.fulfill({json:{rows,nativeRows:[],combinedRows:rows,allRows:rows,coverage:[],scanning:false}}));
 await page.getByRole('button',{name:'用量总览',exact:true}).click();await page.getByRole('tab',{name:'模型',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.tfMonochromeMark[data-provider=codex]'));
 const grid=page.locator('.tfHeatmap');assert.equal(await page.getByRole('tab',{name:'来源',exact:true}).count(),1);
 for(const label of ['每天','七天','累计总量','累计总量']){const version=Number(await grid.getAttribute('data-animation'));await page.getByRole('button',{name:label,exact:true}).click();assert.equal(Number(await grid.getAttribute('data-animation')),version+1);}
 const gridBox=await grid.boundingBox(),activityBox=await page.locator('.tfTokenActivity').boundingBox();assert.ok(Math.abs(gridBox.width-activityBox.width)<6,`heatmap fills the activity width: grid=${gridBox.width}, activity=${activityBox.width}`);
 const paths=page.locator('.tfBreakdown>header .tfOverviewPaths');assert.equal(await paths.count(),1);assert.ok((await paths.boundingBox()).y<(await page.locator('.tfTokenLegend').boundingBox()).y);
 await page.setViewportSize({width:1800,height:900});assert.ok((await page.locator('.tfPage').boundingBox()).width<=880);await page.setViewportSize({width:1320,height:900});
 for(const width of [1320,1024,480]){await page.setViewportSize({width,height:900});await page.waitForTimeout(100);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);const layers=await page.locator('.tfTokenActivity,.tfUsageOverview .tfBreakdown').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));assert.ok(layers.every(color=>color==='rgba(0, 0, 0, 0)'));assert.equal(await page.locator('.tfStackedTokens line').count(),0);assert.equal(await page.locator('.tfStackedTokens').first().evaluate(node=>getComputedStyle(node).overflow),'hidden');await shot(`usage-${width}.png`);}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await grid.locator('button').first().evaluate(node=>getComputedStyle(node).animationName),'none');await page.emulateMedia({reducedMotion:'no-preference'});
 await page.setViewportSize({width:1320,height:900});await nav.getByRole('button',{name:'CLI 代理',exact:true}).click();assert.equal(await page.locator('.tfKeysHead .tfUsageFold').count(),1);assert.equal(await page.locator('.tfProxyUsage').count(),0);await shot('proxy-overview.png');
 const keyCard=page.locator('.tfKeyCard').first(),keyButton=keyCard.locator('.tfKeyCardMain');await keyButton.focus();assert.notEqual(await keyButton.evaluate(node=>getComputedStyle(node).outlineColor),'rgb(37, 99, 235)');
 const navText=nav.getByRole('button',{name:'CLI 代理',exact:true});await navText.hover();assert.equal(await navText.evaluate(node=>getComputedStyle(node).transform),'none');const beforeHover=await keyCard.evaluate(node=>getComputedStyle(node).backgroundColor);await keyCard.hover();assert.equal(await keyCard.evaluate(node=>getComputedStyle(node).backgroundColor),beforeHover);assert.notEqual(await keyCard.evaluate(node=>getComputedStyle(node).transform),'none');
 const fixtureTrace={id:'fixture-trace',runId:'fixture-run',keyId:'fixture-key',agent:'Pi',target:'pi',sourceId:source.id,model:models[0],protocol:'responses',startedAt:new Date().toISOString(),durationMs:1200,status:200,inputTokens:12,cachedTokens:0,cacheWriteTokens:0,outputTokens:8,reasoningTokens:0,inputs:{system:1,user:1,assistant:0,tool:0},tools:[],results:[],toolCalls:1,toolResults:1,toolNames:['inspect_gateway']};
 const nativeTrace={...fixtureTrace,id:'native-'+ 'a'.repeat(64),origin:'native',channel:'official',model:'native-model',timingKnown:false,statusKnown:false,toolTraceKnown:false,durationMs:0,status:0,toolCalls:0,toolResults:0};
 await page.route('**/api/activity/traces?**',route=>{const origin=new URL(route.request().url()).searchParams.get('origin');return route.fulfill({json:{records:origin==='native'?[nativeTrace]:origin==='gateway'?[fixtureTrace]:[fixtureTrace,nativeTrace]}});});
 await page.route('**/api/activity/traces/native-*',route=>route.fulfill({json:{record:nativeTrace}}));
 await page.route('**/api/activity/traces/fixture-trace',route=>route.fulfill({json:{record:fixtureTrace}}));
 await page.getByRole('button',{name:'活动',exact:true}).click();const trace=page.getByRole('region',{name:'调用轨迹',exact:true});await trace.locator('.tfTraceList button').first().waitFor();
 assert.equal(await trace.locator('.tfTraceList button').first().evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');
 const colors=await trace.locator('.tfTraceLane button').evaluateAll(nodes=>nodes.map(node=>getComputedStyle(node).backgroundColor));assert.equal(new Set(colors).size,3);
 await trace.locator('.tfTraceList button').first().click();const inspector=trace.getByRole('complementary',{name:'调用轨迹详情',exact:true});await inspector.getByText('总 Token',{exact:true}).waitFor();assert.equal(await page.getByRole('dialog',{name:'调用轨迹详情'}).count(),0);assert.equal(await inspector.locator('.tfTraceDetail').evaluate(node=>getComputedStyle(node).backgroundColor),'rgba(0, 0, 0, 0)');assert.ok((await inspector.boundingBox()).x>(await trace.locator('.tfTraceList').boundingBox()).x);await shot('trace-inline-detail.png');
 await page.setViewportSize({width:480,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await shot('trace-narrow.png');await trace.getByRole('button',{name:'关闭轨迹详情'}).click();assert.equal(await inspector.count(),0);await page.setViewportSize({width:1320,height:900});await trace.getByRole('button',{name:'本机直连',exact:true}).click();await trace.locator('.tfTraceIdentity strong').filter({hasText:'native-model'}).waitFor();await trace.locator('.tfTraceList button').first().click();await inspector.getByText('HTTP 状态未记录',{exact:false}).waitFor();assert.ok(await page.getByRole('region',{name:'最近请求',exact:true}).getByText('native-model',{exact:false}).isVisible());await shot('native-activity.png');await trace.getByRole('button',{name:'关闭轨迹详情'}).click();
 if(process.platform==='darwin'){
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].close());
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),false);
  assert.equal(await app.evaluate(({app})=>app.dock.isVisible()),false);
  assert.equal(await page.evaluate(()=>fetch('/api/local-agent').then(response=>response.ok)),true,'service keeps running after closing the window');
  await app.evaluate(async({app,BrowserWindow})=>{app.emit('activate');const deadline=Date.now()+3000;while(!BrowserWindow.getAllWindows()[0].isVisible()&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));});assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);assert.equal(await app.evaluate(({app})=>app.dock.isVisible()),true);
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify({appearance:'passed',cards:'passed',loginDialog:'passed',repairContext:'passed',usageThemesAndOverflow:'passed',proxySummary:'passed',screenshots:output}));
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
