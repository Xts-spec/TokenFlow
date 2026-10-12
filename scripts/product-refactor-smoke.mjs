import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';

if(process.argv.includes('--packaged'))throw new Error('P0 smoke verifies an isolated development build. Packaged verification is not supported by this script.');

// Use the real service and fake upstream in a fully isolated profile.
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-p0-'));
const empty=process.argv.includes('--empty');
const output=resolve('artifacts/product-p0');
const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
const original='{"env":{"KEEP":"original"},"permissions":{"allow":[]}}';
let app;
try{
  await mkdir(output,{recursive:true});await mkdir(join(root,'cliproxy'));await mkdir(join(root,'claude'));await mkdir(join(root,'codex'));
  await writeFile(join(root,'claude','settings.json'),original);
  if(!empty){
    await mkdir(join(root,'cliproxy','auth'));
    const fixtures=[['codex.json','source@example.test','fixture-one'],['codex-team.json','team@example.test','fixture-two']];
    await writeFile(join(root,'cliproxy','fixture-accounts.json'),JSON.stringify(fixtures.map(([name,email])=>({name,provider:'codex',email,status:'active',models:['model-a','model-b']}))));
    for(const [name,email,account_id] of fixtures)await writeFile(join(root,'cliproxy','auth',name),JSON.stringify({account_id,access_token:'fixture-access-only',refresh_token:'fixture-refresh-only',id_token:`fixture.${Buffer.from(JSON.stringify({email})).toString('base64url')}.fixture`}));
  }
  // Prevent discovery of real local accounts and processes. Only this test process is patched.
  const bootstrap=join(root,'bootstrap.cjs');
  await writeFile(bootstrap,`const cp=require('node:child_process');const os=require('node:os');os.homedir=()=>${JSON.stringify(root)};const original=cp.execFile;cp.execFile=function(file,args,...rest){if(file==='ps'){rest.at(-1)(null,'','');return {on(){},kill(){}};}return original.call(this,file,args,...rest);};cp.execFile[require('node:util').promisify.custom]=async(file,args,options)=>file==='ps'?{stdout:'',stderr:''}:require('node:util').promisify(original)(file,args,options);require('node:module').syncBuiltinESMExports();import(${JSON.stringify(new URL('../dist/main.js',import.meta.url).href)});`);
  app=await electron.launch({args:[bootstrap],env:{...process.env,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
  const page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.locator('.agentCardGrid article').first().waitFor();await page.evaluate(()=>document.fonts.ready);
  const nav=page.getByRole('navigation',{name:'主导航'});
  assert.deepEqual(await nav.getByRole('button').allTextContents(),['工作台','模型来源','活动']);
  assert.equal(await page.locator('.repairWelcome').count(),0);
  assert.equal(await page.locator('.workbenchAgent').count(),4);
  assert.equal(await page.getByText('未配置 · 安装未验证',{exact:true}).count(),4);
  const settings=page.getByRole('navigation',{name:'设置导航'}).getByRole('button',{name:'设置',exact:true});
  const getState=()=>page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));
  const claudeCard=page.locator('.workbenchAgent').filter({has:page.getByRole('heading',{name:'Claude Code',exact:true})});
  if(!empty){
    await nav.getByRole('button',{name:'模型来源',exact:true}).click();
    await page.getByRole('tab',{name:'本机账号切换',exact:true}).click();
    const native=page.locator('#sources-native');
    const account=native.locator('.nativeAccountCard').filter({has:page.getByRole('heading',{name:'source@example.test',exact:true})});
    await account.getByRole('button',{name:'切换到此账号',exact:true}).click();
    await account.getByRole('button',{name:'取消',exact:true}).click();
    assert.equal(await readFile(join(root,'codex/auth.json'),'utf8').catch(()=>null),null);
    await account.getByRole('button',{name:'切换到此账号',exact:true}).click();
    await account.getByRole('combobox',{name:'默认模型',exact:true}).selectOption('codex/model-b');
    await account.getByRole('button',{name:'确认切换',exact:true}).evaluate(el=>{el.click();el.click();});
    await native.getByRole('status').filter({hasText:'账号与默认模型已切换'}).waitFor();
    assert.equal(JSON.parse(await readFile(join(root,'codex/auth.json'),'utf8')).tokens.account_id,'fixture-one');
    assert.match(await readFile(join(root,'codex/config.toml'),'utf8'),/model = "model-b"/);
    assert.equal(await native.locator('.nativeAccountCard').count(),2);
    await page.screenshot({path:join(output,'native-accounts.png')});
    await native.getByRole('button',{name:'还原原登录',exact:true}).click();
    await native.getByRole('status').filter({hasText:'原登录与配置已还原'}).waitFor();
    assert.equal(await readFile(join(root,'codex/auth.json'),'utf8').catch(()=>null),null);
    await nav.getByRole('button',{name:'工作台',exact:true}).click();
  }
  if(!empty){
    const source=page.locator('.connectionWizard .a2aSource').filter({hasText:'source@example.test'});
    await source.click();await page.getByRole('dialog').getByRole('button',{name:'codex/model-a',exact:true}).click();
    await page.getByRole('button',{name:'接入 Claude Code',exact:true}).click();
    await claudeCard.getByText('codex/model-a',{exact:true}).waitFor();
    assert.equal(await claudeCard.getByText('已写入配置 · 待客户端验证',{exact:true}).count(),1);
    let config=JSON.parse(await readFile(join(root,'claude','settings.json'),'utf8'));assert.equal(config.env.KEEP,'original');assert.match(config.env.ANTHROPIC_AUTH_TOKEN,/^tfl_/);
    const result=await page.evaluate(async credential=>{const response=await fetch('/v1/messages',{method:'POST',headers:{Authorization:`Bearer ${credential}`,'Content-Type':'application/json'},body:JSON.stringify({model:'codex/model-a',messages:[{role:'user',content:'Reply OK'}],max_tokens:32})});await response.arrayBuffer();return response.status;},config.env.ANTHROPIC_AUTH_TOKEN);assert.equal(result,200);
    await claudeCard.getByText(/此 Key 网关请求返回 200/).waitFor();
    assert.equal(await claudeCard.getByText('已写入配置 · 待客户端验证',{exact:true}).count(),1);
    // Agent native-login detail retains the existing gateway lock.
    await claudeCard.getByRole('button',{name:'原生登录',exact:true}).click();
    await page.locator('.agentNativeDetail').getByText(/Claude Code 当前使用 A2A 网关/).waitFor();
    await page.getByRole('button',{name:'先还原接口',exact:true}).click();
    assert.equal(await page.locator('.connectionArchive').getAttribute('open'),'');
    // Model switch reuses backups and preserves unrelated settings.
    await source.click();await page.getByRole('dialog').getByRole('button',{name:'codex/model-b',exact:true}).click();
    page.once('dialog',d=>d.accept());await page.getByRole('button',{name:'还原并接入所选模型',exact:true}).click();
    await claudeCard.getByText('codex/model-b',{exact:true}).waitFor();
    config=JSON.parse(await readFile(join(root,'claude','settings.json'),'utf8'));assert.equal(config.env.KEEP,'original');
    await page.locator('.connectionWizard').getByRole('button',{name:'收起',exact:true}).click();
    await page.locator('main').evaluate(el=>el.scrollTo(0,0));await page.screenshot({path:join(output,'workbench-connected.png')});
    // Opening a connection repair does not start a paid model run.
    await claudeCard.getByRole('button',{name:'检查连接',exact:true}).click();
    const drawer=page.getByRole('dialog',{name:'维修师傅',exact:true});await drawer.waitFor();
    await drawer.getByText(/此次入口：Claude Code · codex\/model-b/).waitFor();
    assert.equal((await page.evaluate(()=>fetch('/api/maintenance').then(r=>r.json()))).status,'idle');
    await drawer.getByRole('button',{name:'更换维修模型',exact:true}).click();
    await page.getByRole('dialog',{name:'选择维修模型',exact:true}).locator('section').filter({has:page.getByRole('heading',{name:'Codex · source@example.test',exact:true})}).getByRole('button',{name:'codex/model-a',exact:true}).click();
    await page.waitForFunction(()=>fetch('/api/maintenance').then(r=>r.json()).then(s=>s.readiness.status==='ready'));
    await drawer.getByRole('textbox',{name:'维修任务',exact:true}).fill('保留这段输入，检查当前 Claude 连接。');
    await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();
    await nav.getByRole('button',{name:'活动',exact:true}).click();await page.locator('.activityPage').waitFor();
    await page.getByRole('tab',{name:'配置记录',exact:true}).click();assert.equal(await page.locator('.activityRecord').count(),2);
    await page.locator('.topActions').getByRole('button',{name:'维修师傅',exact:true}).click();
    assert.equal(await drawer.getByRole('textbox',{name:'维修任务',exact:true}).inputValue(),'保留这段输入，检查当前 Claude 连接。');
    await drawer.getByRole('button',{name:'开始维修',exact:true}).click();
    await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();
    await page.waitForFunction(()=>fetch('/api/maintenance').then(r=>r.json()).then(s=>s.status==='completed'));
    // Main-process tray shortcut opens the same conversation through the preload bridge.
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.send('repair:open'));
    await drawer.waitFor();await drawer.getByText('保留这段输入，检查当前 Claude 连接。',{exact:true}).waitFor();
    assert.equal((await page.evaluate(()=>fetch('/api/maintenance').then(r=>r.json()))).chain.target,'claude');
    await page.screenshot({path:join(output,'repair-drawer.png')});
    await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();
    await nav.getByRole('button',{name:'工作台',exact:true}).click();
    // Refuse to restore over external changes, then restore the original fixture exactly.
    const managed=await readFile(join(root,'claude','settings.json'),'utf8');
    await writeFile(join(root,'claude','settings.json'),JSON.stringify({...JSON.parse(managed),env:{...JSON.parse(managed).env,ANTHROPIC_MODEL:'external-model'}}));
    await page.getByRole('button',{name:'还原原接口',exact:true}).click();await page.locator('.a2aPage .banner.error').waitFor();
    assert.equal(JSON.parse(await readFile(join(root,'claude','settings.json'),'utf8')).env.ANTHROPIC_MODEL,'external-model');
    await writeFile(join(root,'claude','settings.json'),managed);
    await page.getByRole('button',{name:'还原原接口',exact:true}).click();await page.locator('.a2aPage .banner.notice').filter({hasText:'原接口已还原'}).waitFor();
    assert.equal(await readFile(join(root,'claude','settings.json'),'utf8'),original);
    assert.equal((await getState()).targets.find(t=>t.id==='claude').connection,null);
  }
  // The native account manager is reachable without opening an A2A detail.
  await nav.getByRole('button',{name:'模型来源',exact:true}).click();
  await page.getByRole('tab',{name:'本机账号切换',exact:true}).click();
  await page.getByRole('tab',{name:'Codex',exact:true}).waitFor();
  await page.getByRole('tab',{name:'Claude Code',exact:true}).click();
  await page.locator('#sources-native').getByRole('heading',{name:'多个账号，随时切换。',exact:true}).waitFor();
  await page.getByRole('tab',{name:'账号与额度',exact:true}).click();
  await page.locator('.directoryToolbar').waitFor();
  if(!empty){
    const card=page.locator('[data-provider="codex"]');
    const trigger=card.getByRole('button',{name:'查看详情',exact:true});
    const bounds=()=>page.locator('.providerCard').evaluateAll(cards=>cards.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
    const before=await bounds();
    assert.ok(before.every(r=>r.height===before[0].height),'summary cards have equal heights');
    await page.screenshot({path:join(output,'sources-summary.png')});
    await trigger.evaluate(el=>{el.click();el.click();});
    const details=page.getByRole('dialog',{name:'Codex',exact:true});
    await details.waitFor();
    assert.equal(await page.locator('.providerDrawer[open]').count(),1);
    assert.equal(await details.locator('.providerAccounts .accountRow').count(),2);
    assert.deepEqual(await bounds(),before,'opening details keeps every summary in place');
    const scrollBefore=await page.locator('main').evaluate(el=>el.scrollTop);
    await details.locator('.providerDrawerBody').evaluate(el=>el.scrollTop=el.scrollHeight);
    assert.equal(await page.locator('main').evaluate(el=>el.scrollTop),scrollBefore);
    await page.screenshot({path:join(output,'source-account-drawer.png')});
    await page.keyboard.press('Escape');
    await details.waitFor({state:'hidden'});
    assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Escape restores focus without scrolling');
    assert.deepEqual(await bounds(),before);
    await trigger.click();
    await details.waitFor();
    await page.mouse.click(220,180);
    await details.waitFor({state:'hidden'});
    // Polling changes quota state without expanding cards or moving the grid.
    const snapshot=await page.evaluate(()=>fetch('/api/local-agent').then(r=>r.json()));
    let quotaBusy=true;
    const quotaRoute=async route=>route.fulfill({json:{...snapshot,quotaBusy,quotas:Object.fromEntries(snapshot.accounts.map(a=>[a.id,{accountId:a.id,provider:a.provider,status:'error',observedAt:new Date().toISOString(),windows:[],error:'fixture quota offline'}]))}});
    await page.route('**/api/local-agent',quotaRoute);
    await card.getByText('额度查询中…',{exact:true}).waitFor();
    assert.deepEqual(await bounds(),before,'quota loading preserves card geometry');
    quotaBusy=false;
    await card.getByText('额度查询失败 · 可重试',{exact:true}).waitFor();
    assert.deepEqual(await bounds(),before,'quota errors preserve card geometry');
    assert.equal(await card.getByText('剩余 0%',{exact:true}).count(),0);
    await page.unroute('**/api/local-agent',quotaRoute);
    await page.getByRole('searchbox').fill('model-b');
    assert.equal(await page.locator('.providerDrawer[open]').count(),0,'search does not auto-expand details');
    await page.getByRole('searchbox').fill('');
    await trigger.click();
    await details.getByRole('button',{name:'使用 codex/model-b 接入 Agent',exact:true}).click();
    await page.locator('.connectionRoute').getByText('codex/model-b',{exact:true}).waitFor();
    await page.getByText('该模型由多个账号提供，请选择来源账号。',{exact:true}).waitFor();
    assert.equal(await page.locator('.connectionWizard .a2aSource[aria-pressed=true]').count(),0,'shared model does not silently choose an account');
    assert.equal(await page.locator('.providerDrawer[open]').count(),0,'model handoff closes details');
  }
  await nav.getByRole('button',{name:'工作台',exact:true}).click();
  // Both setup branches, all destinations, and hidden bubble fallback remain reachable.
  await page.getByRole('tab',{name:'手动配置',exact:true}).click();await page.locator('.agentConnections').waitFor();
  if(!empty){
    const credential=await page.evaluate(async()=>{
      const result=await fetch('/api/gateway-keys',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Manual fixture',models:['codex/model-a'],agents:['codex']})});
      if(!result.ok)throw Error('Fixture key creation failed');return (await result.json()).apiKey;
    });
    await page.locator('.agentChoices button').filter({hasText:'Codex'}).click();
    await page.waitForFunction(()=>document.querySelector('.agentSetup select')?.textContent?.includes('Manual fixture'));
    await page.getByRole('combobox',{name:'Agent 访问 Key',exact:true}).selectOption({label:'Manual fixture · 1 个授权模型'});
    await page.getByText('验证连接（可选）',{exact:true}).click();
    await page.getByRole('textbox',{name:'粘贴该 Key 的完整值',exact:true}).fill(credential);
    let calls=0;let modelStarted;const started=new Promise(r=>{modelStarted=r;});
    await page.route('**/v1/responses',async route=>{calls++;modelStarted();await new Promise(r=>setTimeout(r,500));try{await route.abort();}catch{/* Request was cancelled by the verification controller. */}});
    // Two synchronous clicks must issue only one verification.
    await page.getByRole('button',{name:'发送测试请求',exact:true}).evaluate(el=>{el.click();el.click();});
    await started;
    await page.getByRole('button',{name:'取消验证',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.agentAuthCheck button:disabled'));
    await page.getByRole('button',{name:'取消验证',exact:true}).click();
    await page.getByRole('status').filter({hasText:'已取消验证'}).waitFor();
    assert.equal(calls,1,'duplicate verification must issue only one model request');
    await new Promise(r=>setTimeout(r,600));
    await page.unroute('**/v1/responses');
    await page.getByRole('button',{name:'验证 Key',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Key 认证通过'}).waitFor();
  }
  await page.getByRole('button',{name:'客户端访问密钥（高级）',exact:true}).click();await page.locator('.keyCenter').waitFor();
  await nav.getByRole('button',{name:'工作台',exact:true}).click();await page.locator('.agentConnections').waitFor();
  await page.locator('.agentChoices button').filter({hasText:'Cursor'}).click();
  await page.getByRole('textbox',{name:/^外网 HTTPS 网关地址/}).fill('https://fixture.example.test');
  await page.getByRole('tab',{name:'我的 Agent',exact:true}).click();
  await page.getByRole('tab',{name:'手动配置',exact:true}).click();
  assert.equal(await page.getByRole('textbox',{name:/^外网 HTTPS 网关地址/}).inputValue(),'https://fixture.example.test');
  await page.getByRole('tab',{name:'我的 Agent',exact:true}).click();
  await page.getByRole('button',{name:'隐藏维修气泡',exact:true}).click();assert.equal(await page.locator('.repairBubble').count(),0);
  await page.locator('.topActions').getByRole('button',{name:'维修师傅',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'维修师傅',exact:true});await drawer.waitFor();await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();
  for(const width of [390,768,1320]){
    await page.setViewportSize({width,height:900});
    for(const name of ['工作台','模型来源','活动']){
      await nav.getByRole('button',{name,exact:true}).click();
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1),false,`${name} overflow at ${width}`);
      if(name==='工作台')await page.screenshot({path:join(output,`${empty?'empty':'workbench'}-${width}.png`)});
      if(name==='模型来源'&&!empty){
        await page.locator('[data-provider="codex"]').getByRole('button',{name:'查看详情',exact:true}).click();
        const accountDrawer=page.getByRole('dialog',{name:'Codex',exact:true});await accountDrawer.waitFor();
        assert.equal(await accountDrawer.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`account drawer overflow at ${width}`);
        assert.equal(await accountDrawer.evaluate(el=>el.getBoundingClientRect().right>innerWidth+1),false);
        await page.screenshot({path:join(output,`account-drawer-${width}.png`)});
        await page.keyboard.press('Escape');await accountDrawer.waitFor({state:'hidden'});
      }
    }
    await settings.click();await page.getByRole('tab',{name:'关于与反馈',exact:true}).click();await page.getByRole('link',{name:'在 GitHub 提交反馈 ↗',exact:true}).waitFor();
    await page.getByRole('tab',{name:'实验功能',exact:true}).click();await page.getByRole('heading',{name:'旧任务运行时',exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1),false,`settings overflow at ${width}`);
    await page.locator('.topActions').getByRole('button',{name:'维修师傅',exact:true}).click();await drawer.waitFor();
    assert.equal(await drawer.evaluate(el=>el.scrollWidth>el.clientWidth+1),false,`drawer overflow at ${width}`);
    await drawer.getByRole('textbox',{name:'维修任务',exact:true}).fill(`保存输入 ${width}`);
    await page.keyboard.press('Escape');assert.equal(await drawer.isVisible(),false);
  }
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({productP0:'passed',mode:empty?'empty states':'connect, switch, native lock, gateway evidence, repair persistence, external drift refusal, restore',widths:[390,768,1320],screenshots:output}));
}catch(error){if(app){const page=app.windows()[0];await page?.screenshot({path:join(output,'failure.png')});console.error((await page?.locator('body').innerText())?.slice(-5000));}throw error;}
finally{await app?.close();await rm(root,{recursive:true,force:true});}
