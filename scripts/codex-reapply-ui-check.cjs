// Run after npm run build: npx electron scripts/codex-reapply-ui-check.cjs
// All configuration and lifecycle endpoints are fixtures; no real Codex is stopped.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,mkdir,writeFile,rm}=require('node:fs/promises');
const {resolve,join,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-codex-reapply-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 let mode='busy',attempts=0,restarts=0,payload;
 const choice={sourceId:'fixture-source',model:'codex/gpt-6-astra'};
 const connection={id:'fixture-connection',keyId:'fixture-key',...choice,selections:[choice],state:'applied'};
 const target={id:'codex',name:'Codex',installation:{installed:true,version:'0.154.0'},restartSupported:true,exists:true,revision:'fixture-revision',pids:[],connection,configurationState:'changed',backups:[]};
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[{id:choice.sourceId,provider:'codex',label:'fixture@example.test',status:'active',disabled:false,unavailable:false,models:[choice.model]}],models:[{id:choice.model,provider:'codex'}],quotas:{},quotaBusy:false,providers:[]};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path.startsWith('/api/a2a/restore-preview/')){res.end(JSON.stringify({id:connection.id,target:'codex',revision:target.revision,canRestore:mode!=='restore-invalid',reason:mode==='restore-invalid'?'当前配置格式无法解析，尚未修改。':'',destination:{kind:'official',provider:'openai'}}));return;}
   if(path==='/api/a2a/restart'){restarts++;res.end(JSON.stringify({message:'Codex 已重新打开，已加载保存的配置。'}));return;}
   if(path==='/api/a2a/restore'){
    let body='';for await(const chunk of req)body+=chunk;payload=JSON.parse(body);attempts++;
    if(mode==='restore-stale'||mode==='restore-migration'){res.statusCode=409;res.end(JSON.stringify({code:mode==='restore-stale'?'configuration_conflict':'codex_migration_failed',error:mode==='restore-stale'?'配置已变化，请重新检查':'对话来源处理失败'}));return;}
    if(target.id!=='codex')target.connection=null;
    res.end(JSON.stringify(connection));return;
   }
   if(path==='/api/a2a/connect'){
    await new Promise(r=>setTimeout(r,500));
    let body='';for await(const chunk of req)body+=chunk;payload=JSON.parse(body);attempts++;
    if(mode==='busy'&&attempts===1){res.statusCode=409;res.end(JSON.stringify({code:'configuration_busy',error:'尚未应用，等待配置操作'}));return;}
    if(mode==='stale'||mode==='migration'){res.statusCode=409;res.end(JSON.stringify({code:mode==='stale'?'invalid_request':'codex_migration_failed',error:mode==='stale'?'配置已变化':'旧对话来源迁移失败'}));return;}
    target.configurationState='configured';res.end(JSON.stringify(connection));return;
   }
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets:[target]}:path==='/api/a2a/program-updates'?{updates:{}}:path.startsWith('/api/native-accounts/')||path==='/api/codex-accounts'?{revision:'fixture',accounts:[],pids:[],backup:null}:path==='/api/usage/overview'?{rows:[],combinedRows:[],allRows:[],nativeRows:[],coverage:[],scanning:false}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:1000,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<160;n++){if(await evaluate(code))return;await pause(50);}throw Error('UI timeout: '+code);};
 const reapply='[...document.querySelectorAll("button")].find(e=>e.textContent.trim()==="重新应用"&&!e.disabled)';
 const history='[...document.querySelectorAll("dialog[open]")].some(e=>e.textContent.includes("旧对话可能需要恢复")||e.textContent.includes("对话来源处理未完成"))';
 const click=async text=>evaluate(`[...document.querySelectorAll("button")].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled).click()`);
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);
  await wait(`!!(${reapply})`);await evaluate(`document.querySelector('input[aria-label="启用网关模型"]').click()`);
  await wait('!!document.querySelector("dialog[open] .tfMigrationProgress")');
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),1);
  assert.equal(await evaluate('!!document.querySelector("dialog[open] button[aria-label=关闭]:disabled")'),true);
  await wait('document.body.textContent.includes("旧对话已迁移并自动重新打开")');
  assert.equal(attempts,2);assert.deepEqual(payload,{allowRunning:true,restartCodex:true,target:'codex',selections:[choice],...choice,revision:target.revision,replaceId:connection.id,rewrite:true,tokenLimit:null});
  assert.equal(await evaluate(history),false);
  assert.equal(await evaluate('!!document.querySelector("dialog[open]")'),false);
  for(const next of ['stale','migration']){
   mode=next;attempts=0;target.configurationState='changed';await win.reload();
   await wait(`!!(${reapply})`);await evaluate(`${reapply}.click()`);
   await wait(`document.body.textContent.includes(${JSON.stringify(next==='stale'?'配置已变化':'旧对话来源迁移失败')})`);
   assert.equal(attempts,1);assert.equal(await evaluate(history),next==='migration');
  }
  for(const next of ['restore-invalid','restore-stale','restore-migration','restore-success']){
   mode=next;attempts=0;target.configurationState='changed';await win.reload();await wait(`!!(${reapply})`);await click('切回官方');
   await wait('!!document.querySelector("dialog[open]")');
   assert.ok(await evaluate('document.querySelector("dialog[open]").getBoundingClientRect().width<=560'),'restore should be a compact dialog');
   await wait('[...document.querySelectorAll("dialog[open] button")].some(e=>!e.disabled&&(e.textContent.trim()==="切回官方并重启"||e.textContent.trim()==="重新检查"))');
   assert.equal(await evaluate('document.querySelectorAll("dialog[open] input[type=checkbox]").length'),0);
   if(next==='restore-invalid'){
    assert.equal(await evaluate('[...document.querySelectorAll("dialog[open] button")].some(e=>e.textContent.trim()==="切回官方并重启"&&!e.disabled)'),false);
    assert.equal(await evaluate('document.querySelector("dialog[open]").textContent.includes("确认后会退出并重新打开 Codex")'),false,'blocked restore must not promise restart');
    assert.equal(await evaluate('document.querySelector("dialog[open]").textContent.includes("对话会同步到官方来源")'),false,'blocked restore must not promise history changes');
    await click('使用当前配置重启…');
    await wait('document.querySelector("dialog[open]").textContent.includes("立即重启")');
    assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),1);
    assert.equal(await evaluate('document.querySelector("dialog[open]").textContent.includes("恢复旧对话")'),false);
    await click('立即重启');await wait('!document.querySelector("dialog[open]")');
    assert.equal(restarts,1);assert.equal(attempts,0);continue;
   }
   await click('切回官方并重启');
   if(next==='restore-success')await wait('!document.querySelector("dialog[open]")');
   else{
    await wait('!!document.querySelector("dialog[open] [role=alert]")');
    assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),1);
    assert.equal(await evaluate('document.querySelector("dialog[open]").textContent.includes("确认后会退出并重新打开 Codex")'),false);
    if(next==='restore-stale')assert.equal(await evaluate('[...document.querySelectorAll("dialog[open] button")].some(e=>e.textContent.trim()==="使用当前配置重启…"&&!e.disabled)'),true);
    assert.equal(await evaluate('[...document.querySelectorAll("dialog[open] button")].some(e=>e.textContent.trim()==="检查对话来源")'),next==='restore-migration');
   }
   assert.equal(attempts,1);assert.equal(payload.restoreHistory,true);assert.equal(payload.revision,'fixture-revision');
  }
  for(const [id,name] of [['workbuddy','WorkBuddy'],['workbuddy-ai','WorkBuddyAI'],['qoder','Qoder'],['deepseek','DeepSeek Harness'],['pi','Pi Agent']]){
   target.id=id;target.name=name;target.connection=connection;target.configurationState='configured';mode='restore-success';attempts=0;
   await win.reload();await wait(`document.querySelector('input[aria-label="启用网关模型"]')?.checked===true`);
   assert.equal(await evaluate('[...document.querySelectorAll(".tfPanelHead button")].some(e=>["切回官方","恢复原配置","停用网关"].includes(e.textContent.trim()))'),false,`${name} should use only the gateway toggle`);
   await evaluate(`document.querySelector('input[aria-label="启用网关模型"]').click()`);
   await wait('document.body.textContent.includes("已移除 TokenFlow 网关模型")');
   assert.equal(attempts,1);assert.equal(payload.restartCodex,false);assert.equal(payload.restoreHistory,false);
   assert.equal(await evaluate('!!document.querySelector("dialog[open]")'),false);
  }
  target.id='codex';target.name='Codex';target.connection=connection;
  for(const screenshotMode of ['restore-success','restore-invalid']){
  mode=screenshotMode;target.configurationState='changed';await win.reload();await wait(`!!(${reapply})`);
  await evaluate('window.desktop={platform:"darwin"}');await click('切回官方');await wait('[...document.querySelectorAll("dialog[open] button")].some(e=>!e.disabled&&(e.textContent.trim()==="切回官方并重启"||e.textContent.trim()==="重新检查"))');
  for(const [name,width,height] of [['desktop',1320,1000],['narrow',580,740]]){
   win.setSize(width,height);await pause(150);
   assert.ok(await evaluate('(()=>{const d=document.querySelector("dialog[open]"),r=d.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight&&d.scrollWidth<=d.clientWidth+1;})()'),'restore fits the viewport');
   if(process.env.TOKENFLOW_UI_ARTIFACTS){await mkdir(process.env.TOKENFLOW_UI_ARTIFACTS,{recursive:true});await writeFile(join(process.env.TOKENFLOW_UI_ARTIFACTS,`${screenshotMode}-${name}.png`),(await win.webContents.capturePage()).toPNG());}
  }
  }
  console.log('PASS: direct reapply, official default destination, malformed config blocking, inline errors, migration-only recovery and official switch success.');
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
})().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
