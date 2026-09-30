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
  if(!empty)await writeFile(join(root,'cliproxy','fixture-accounts.json'),JSON.stringify([{name:'codex.json',provider:'codex',email:'source@example.test',status:'active',models:['model-a','model-b']}]));
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
    await page.getByRole('dialog',{name:'选择维修模型',exact:true}).getByRole('button',{name:'codex/model-a',exact:true}).click();
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
  // Both setup branches, all destinations, and hidden bubble fallback remain reachable.
  await page.getByRole('tab',{name:'手动配置',exact:true}).click();await page.locator('.agentConnections').waitFor();
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
