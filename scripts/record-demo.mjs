import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { createServer as createHTTP } from 'node:http';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';

// Local fixtures only: no real accounts, OAuth or paid model calls.
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-flow-'));
const output=resolve('output/playwright/product-demo');
const media=resolve('docs/media');
if(spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status!==0)throw Error('Install FFmpeg before recording.');
await mkdir(media,{recursive:true});
const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
// A relay that only speaks Chat Completions: the UI must find that out without being told.
const upstreamCalls=[];
const upstream=createHTTP(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;upstreamCalls.push({path:req.url,auth:req.headers.authorization,model:raw?JSON.parse(raw).model:undefined});
  res.setHeader('content-type','application/json');
  if(req.url==='/v1/chat/completions'&&req.headers.authorization==='Bearer sk-fixture-chat'){res.end(JSON.stringify({id:'c1',object:'chat.completion',choices:[{index:0,message:{role:'assistant',content:'OK'},finish_reason:'stop'}]}));return;}
  res.writeHead(req.headers.authorization==='Bearer sk-fixture-chat'?404:401);res.end(JSON.stringify({error:{message:'nope'}}));
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const upstreamURL=`http://127.0.0.1:${upstream.address().port}/v1`;
let app;let video;let start;let finished=false;
const scenes=[];
try{
  await mkdir(output,{recursive:true});await mkdir(join(root,'cliproxy','auth'),{recursive:true});
  const accounts=[{name:'codex.json',provider:'codex',email:'me@example.test',models:['model-a','model-b']},{name:'codex-work.json',provider:'codex',email:'work@example.test',models:['work-model','model-a']},{name:'claude.json',provider:'claude',email:'dev@example.test',models:['only-model']}];
  await writeFile(join(root,'cliproxy','fixture-accounts.json'),'[]');
  for(const a of accounts)await writeFile(join(root,'cliproxy','auth',a.name),JSON.stringify({type:a.provider,email:a.email,account_id:a.name,access_token:'fixture-only',refresh_token:'fixture-only',id_token:`x.${Buffer.from(JSON.stringify({email:a.email})).toString('base64url')}.x`}));
  const bootstrap=join(root,'bootstrap.cjs');
  await writeFile(bootstrap,`const cp=require('node:child_process');const os=require('node:os');os.homedir=()=>${JSON.stringify(root)};const original=cp.execFile;cp.execFile=function(file,args,...rest){if(file==='ps'){rest.at(-1)(null,'','');return {on(){},kill(){}};}return original.call(this,file,args,...rest);};cp.execFile[require('node:util').promisify.custom]=async(file,args,options)=>file==='ps'?{stdout:'',stderr:''}:require('node:util').promisify(original)(file,args,options);require('node:module').syncBuiltinESMExports();import(${JSON.stringify(new URL('../dist/main.js',import.meta.url).href)});`);
  const env=Object.fromEntries(['PATH','DISPLAY','XAUTHORITY','DBUS_SESSION_BUS_ADDRESS','SYSTEMROOT','WINDIR','LANG'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
  const codexHome=join(root,'codex');
  app=await electron.launch({args:[bootstrap],viewport:{width:1320,height:900},deviceScaleFactor:1,recordVideo:{dir:join(output,'raw'),size:{width:1320,height:900}},env:{...env,HOME:root,AGENT_DATA_ROOT:root,CODEX_HOME:codexHome,CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
  const page=await app.firstWindow();video=page.video();page.setDefaultTimeout(20000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});if(!response.ok)throw Error(`API ${response.status} ${path}`);return response.json();},{path,body,method});
  const deferRestart=async()=>{await page.getByRole('dialog',{name:'配置已保存，现在生效？',exact:true}).getByRole('button',{name:'稍后再说'}).click();};
  const waitForAPI=async(path,predicate)=>{const deadline=Date.now()+30000;do{const value=await api(path);if(predicate(value))return value;await new Promise(r=>setTimeout(r,100));}while(Date.now()<deadline);throw Error(`Timed out waiting for ${path}`);};
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1320,900));
  await waitForAPI('/api/local-agent',s=>s.state==='running');
  await fetch(`http://127.0.0.1:${port}/fixture`,{method:'POST',body:JSON.stringify({accounts:accounts.map(a=>({...a,status:'active',auth_index:`idx-${a.name}`}))})});
  await api('/api/local-agent/refresh',{});await waitForAPI('/api/local-agent',s=>s.models.length===4);
  await api('/api/local-agent/providers/codex/refresh',{});
  assert.equal((await api('/api/local-agent')).providers.find(p=>p.id==='qoder').label,'Qoder IDE');

  const nav=page.getByRole('navigation',{name:'主导航'});
  await page.evaluate(()=>{
    const style=document.createElement('style');style.textContent='input[aria-label="导出的 API Key"]{-webkit-text-security:disc}';document.head.append(style);
    const caption=document.createElement('div');caption.id='demo-caption';caption.setAttribute('popover','manual');
    Object.assign(caption.style,{position:'fixed',inset:'auto 24px 18px 24px',width:'auto',margin:'0',padding:'14px 20px',border:'0',borderRadius:'12px',background:'#14243aee',color:'#fff',fontFamily:'system-ui,sans-serif',fontSize:'20px',lineHeight:'1.4',pointerEvents:'none',boxShadow:'0 4px 18px #0002'});
    document.body.append(caption);caption.showPopover();
  });
  start=Date.now();
  const caption=async(text)=>{
    scenes.push({at:(Date.now()-start)/1000,text});
    await page.evaluate(text=>{const el=document.getElementById('demo-caption');el.textContent=text;if(!el.matches(':popover-open'))el.showPopover();},text);
    await page.waitForTimeout(500);
  };
  const hold=()=>page.waitForTimeout(2200);
  const click=async(locator)=>{
    const notices=page.locator('.tfNotifications').getByRole('button',{name:'关闭提示',exact:true});
    // A newer native dialog can cover an older notice; activate only its existing dismiss control.
    while(await notices.count())await notices.first().evaluate(button=>button.click());
    const box=await locator.boundingBox();if(box)await page.mouse.move(box.x+box.width/2,box.y+box.height/2,{steps:12});
    await locator.click();await page.waitForTimeout(400);
  };
  const shot=async(name)=>{
    await page.evaluate(()=>document.getElementById('demo-caption').hidePopover());
    await page.screenshot({path:join(media,name)});
    await page.evaluate(()=>document.getElementById('demo-caption').showPopover());
  };
  const openSource=async(dialog,account)=>{const card=dialog.locator('.tfPickSource').filter({hasText:account});if(await card.getAttribute('open')===null)await click(card.locator(':scope > summary'));return card;};
  await caption('token-flow · 让你的模型，流向每个 Agent。演示使用虚构账号和本机模拟接口。');
  await click(nav.getByRole('button',{name:'账号授权',exact:true}));
  await page.locator('#provider-panel-codex').getByRole('tab',{name:'me@example.test',exact:true}).waitFor();await hold();
  await caption('01 / 账号授权：按平台管理多个账号，查看模型与共享额度，单独刷新当前平台。');
  await click(page.locator('#provider-panel-codex').getByRole('button',{name:'查看模型（2）'}));await hold();await shot('accounts.png');
  await click(nav.getByRole('button',{name:'API 接口',exact:true}));
  const apis=page.getByRole('region',{name:'API 接口'});
  await click(apis.getByRole('button',{name:'添加 API',exact:true}));
  await caption('02 / 添加 API：填写名称、地址和上游 Key；可以逐项添加多个模型。');
  const form=apis.getByRole('form');
  await form.getByLabel('名称备注').fill('演示 API · 工作项目');await form.getByLabel('URL', {exact:true}).fill(upstreamURL);
  await form.getByLabel('API Key',{exact:true}).fill('sk-fixture-chat');await form.getByLabel('模型名称',{exact:true}).fill('relay-model');
  await click(form.getByRole('button',{name:'添加模型',exact:true}));await form.getByLabel('模型名称 2',{exact:true}).fill('relay-second');await hold();
  await caption('验证并添加：用第一个模型识别协议。只验证最小文本请求，其他能力需另行测试。');
  await click(form.getByRole('button',{name:'验证并添加',exact:true}));
  await apis.getByText('Chat Completions',{exact:false}).waitFor();
  const source=(await api('/api/sources')).sources[0];assert.deepEqual(source.models,['relay-model','relay-second']);
  await waitForAPI('/api/local-agent',s=>s.models.some(m=>m.id===`api-${source.id}/relay-model`));
  await click(apis.getByRole('button',{name:'支持模型（2）',exact:true}));await hold();await shot('api.png');
  await click(nav.getByRole('button',{name:'本地 Agent',exact:true}));
  await click(page.getByRole('tablist',{name:'本地 Agent'}).getByRole('tab',{name:/Codex/}));
  const codex=page.getByRole('region',{name:'Codex',exact:true});
  await caption('03 / 本地 Agent：选择 Codex，展开来源账号，跨来源勾选多个模型。');
  await click(codex.getByRole('button',{name:'选择模型',exact:true}));
  const picker=page.getByRole('dialog',{name:'Codex 使用的模型'});
  const personal=await openSource(picker,'me@example.test');await click(personal.getByRole('button',{name:/^(codex\/)?model-a$/}));
  const apiGroup=await openSource(picker,'演示 API · 工作项目');await click(apiGroup.getByRole('button',{name:'relay-model',exact:true}));
  await picker.getByText('已选择 2 个模型',{exact:true}).waitFor();await hold();await shot('model-picker.png');
  await caption('应用所选模型：自动备份原配置，并生成独立 Key。保存工作后重启 Agent 加载模型菜单。');
  await click(picker.getByRole('button',{name:'应用所选模型',exact:true}));
  await page.getByRole('dialog',{name:'配置已保存，现在生效？',exact:true}).waitFor();await hold();await click(page.getByRole('dialog',{name:'配置已保存，现在生效？',exact:true}).getByRole('button',{name:'稍后再说'}));
  let connection=(await api('/api/a2a')).targets.find(t=>t.id==='codex').connection;assert.equal(connection.selections.length,2);
  await caption('点击已选模型设为默认，其他模型继续保留。这里验证配置，实际调用还需到客户端测试。');
  const rows=codex.getByRole('list',{name:'Codex 网关模型'}).getByRole('listitem');
  await click(rows.filter({hasText:'relay-model'}).getByRole('button',{name:/relay-model/}));
  await waitForAPI('/api/a2a',s=>s.targets.find(t=>t.id==='codex').connection?.model===`api-${source.id}/relay-model`);
  await deferRestart();await hold();await shot('agents.png');
  await click(nav.getByRole('button',{name:'API 代理',exact:true}));
  await caption('04 / API 代理：为其他应用创建单独 Key，填写用途，只授权勾选的模型。');
  const keys=page.getByRole('region',{name:'本地 API Key'});await click(keys.getByRole('button',{name:'创建 Key',exact:true}));
  await keys.getByLabel('名称',{exact:true}).fill('演示应用');await keys.getByLabel('用途',{exact:true}).fill('开发工具接入');
  await click(keys.getByRole('button',{name:'选择导出模型（0）'}));
  const exportPicker=page.getByRole('dialog',{name:'选择导出模型',exact:true});
  const exportGroup=await openSource(exportPicker,'演示 API · 工作项目');await click(exportGroup.getByRole('button',{name:'relay-model',exact:true}));await click(exportPicker.getByRole('button',{name:'应用所选模型'}));await hold();
  await click(keys.getByRole('button',{name:'生成 Key',exact:true}));
  const details=page.getByRole('dialog',{name:'Key 详情 · 演示应用',exact:true});await details.waitFor();
  // Reopen with the default mask: even disposable generated keys stay hidden in published media.
  await click(details.getByRole('button',{name:'关闭',exact:true}));await click(keys.getByRole('button',{name:'查看 演示应用',exact:true}));
  assert.equal(await details.getByLabel('导出的 API Key').inputValue(),'********');
  await caption('复制地址、Key 与精确模型 ID 到目标应用；来源 Key 和本地 Key 分开管理。');await hold();await shot('key-details.png');
  await click(details.getByRole('button',{name:'关闭',exact:true}));await shot('keys.png');
  await caption('05 / 活动：查看请求状态与配置切换记录。演示只显示当前隔离环境的数据。');
  await click(page.getByRole('button',{name:'活动',exact:true}));await page.getByRole('heading',{name:'活动'}).waitFor();await hold();
  await caption('06 / 维修师傅：配置修改无需维修模型。先生成方案，预览后再确认写入。');
  await click(page.getByRole('button',{name:'打开维修师傅'}));const repair=page.getByRole('region',{name:'维修师傅'});
  await click(repair.getByRole('button',{name:'修改 Agent 配置',exact:true}));
  const editor=repair.getByRole('region',{name:'修改 Agent 配置',exact:true});await editor.getByLabel('配置目标 Agent').selectOption('qoder');
  await click(editor.getByRole('button',{name:'选择来源和模型'}));
  const routing=page.getByRole('dialog',{name:'Agent 的来源和模型'});const routingGroup=await openSource(routing,'me@example.test');await click(routingGroup.getByRole('button',{name:'codex/model-a',exact:true}));
  await click(editor.getByRole('button',{name:'生成修改方案'}));
  const proposal=repair.getByRole('article',{name:'修复方案'});await proposal.getByRole('button',{name:'同意并执行'}).waitFor();await hold();await shot('repair.png');
  assert.equal((await api('/api/a2a')).targets.find(t=>t.id==='qoder').connection,null,'preview must not write configuration');
  await caption('确认后才备份并写入，配置发生外部变化会停止。收起维修保留对话，停止使用独立按钮。');
  await click(proposal.getByRole('button',{name:'同意并执行'}));await waitForAPI('/api/a2a',s=>s.targets.find(t=>t.id==='qoder').configurationState==='configured');await hold();
  await click(repair.getByRole('button',{name:'收起',exact:true}));await click(nav.getByRole('button',{name:'本地 Agent',exact:true}));
  await caption('需要撤回接入？在 Agent 页面恢复原配置。详细功能与兼容范围见仓库产品说明和使用指南。');await hold();
  assert.deepEqual(errors,[]);finished=true;
  await writeFile(join(output,'scenes.json'),JSON.stringify(scenes,null,2));
}catch(error){
  const page=app?.windows()[0];if(page){await page.screenshot({path:join(output,'failure.png')}).catch(()=>{});console.error((await page.locator('body').innerText()).slice(-2500));}
  throw error;
}finally{
  await app?.close();await new Promise(r=>upstream.close(r));await rm(root,{recursive:true,force:true});
}
if(!finished)throw Error('Demo recording did not complete.');
const raw=await video.path();
const run=(args)=>{const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});if(result.status!==0)throw Error('FFmpeg conversion failed.');};
run(['-i',raw,'-an','-c:v','libx264','-crf','24','-preset','medium','-pix_fmt','yuv420p','-movflags','+faststart',join(media,'quickstart.mp4')]);
// Sample the actual recording at 4x speed for the README; full-speed subtitles remain in MP4.
run(['-i',join(media,'quickstart.mp4'),'-vf','setpts=PTS/4,fps=6,scale=880:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer','-loop','0',join(media,'quickstart.gif')]);
console.log(JSON.stringify({demo:'passed',media,scenes:scenes.length}));
