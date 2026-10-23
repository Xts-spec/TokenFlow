// Isolated UI fixtures; never uses saved profiles or provider credentials.
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,writeFile,mkdir,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');
(async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-key-create-'));app.setPath('userData',root);app.on('window-all-closed',()=>{});await app.whenReady();app.dock?.hide();
 const sourceId='a'.repeat(24),model='codex/fixture-model';let keys=[],payload,removals=0,accountRefreshes=[];
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[{id:sourceId,provider:'codex',label:'fixture@example.test',status:'active',disabled:false,unavailable:false,models:[model],credentialCount:2}],models:[{id:model,provider:'codex'}],quotas:{[sourceId]:{accountId:sourceId,provider:'codex',status:'error',observedAt:new Date().toISOString(),windows:[],error:'HTTP 401'}},quotaBusy:false,providers:[{id:'codex',label:'Codex',flow:'callback'}]};
 local.accounts.push({...local.accounts[0],id:'b'.repeat(24),label:'second@example.test'});
 const today=new Date(),day=d=>[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
 const dailyRow={day:day(today),target:'codex',sourceId,model,keyId:'fixture',requests:1,failed:0,unmeasured:0,inputTokens:100000000,outputTokens:0,cachedTokens:97000000,cacheBaseTokens:100000000,durationMs:1,last:today.toISOString()};
 const yesterday=new Date(today);yesterday.setDate(today.getDate()-1);const usageRows=[dailyRow,{...dailyRow,day:day(yesterday),inputTokens:900000000}];
 usageRows.push({...dailyRow,sourceId:'c'.repeat(24),model:'claude/other',target:'claude',inputTokens:500000000});
 let access={enabled:false,running:false,port:9555,allowedIPs:[],addresses:[],lastError:null};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('content-type','application/json');
   if(path==='/api/gateway-keys'&&req.method==='POST'){
    let body='';for await(const c of req)body+=c;payload=JSON.parse(body);
    keys=[{...payload,id:'fixture-key',prefix:'fixture',createdAt:new Date().toISOString(),exported:true,usedTokens:0,unmeteredRequests:0,pendingRequests:0}];
    access={...access,enabled:true,running:true,addresses:['http://192.168.1.10:9555']};res.end(JSON.stringify({key:keys[0],apiKey:'fixture-secret',keyStored:true,gatewayAccess:access}));return;
   }
   if(/\/accounts\/[^/]+\/refresh$/.test(path)&&req.method==='POST'){accountRefreshes.push(path);res.end(JSON.stringify(local));return;}
   if(path.endsWith('/expired')&&req.method==='DELETE'){removals++;local.accounts=[];res.end(JSON.stringify(local));return;}
   const value=path==='/api/local-agent'||path==='/api/local-agent/providers/codex/refresh'?local:path==='/api/gateway/access'?access:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/a2a'?{targets:[{id:'codex',name:'Codex',installation:{installed:true,version:'1.0'},exists:true,revision:'fixture',pids:[],connection:null,configurationState:'unmanaged',backups:[]}]}:path.startsWith('/api/native-accounts/')||path==='/api/codex-accounts'?{revision:'fixture',accounts:[],pids:[],backup:null}:path==='/api/usage/overview'?{rows:usageRows,combinedRows:usageRows,allRows:usageRows,nativeRows:[],coverage:[],scanning:false}:path==='/api/gateway-keys'?{keys}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/activity/traces'?{records:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const win=new BrowserWindow({show:false,width:1280,height:900,webPreferences:{sandbox:true,backgroundThrottling:false}});
 const rendererErrors=[];win.webContents.on('console-message',details=>{if(details.level==='error')rendererErrors.push(details.message);});
 const evaluate=code=>win.webContents.executeJavaScript(code),pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async code=>{for(let n=0;n<150;n++){if(await evaluate(code))return;await pause(40);}throw Error('UI timeout: '+code);};
 const click=text=>evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled).click()`);
 const centered=async(label,maxWidth=800)=>{const r=await evaluate(`(()=>{const e=document.querySelector('dialog[open]'),r=e.getBoundingClientRect(),s=getComputedStyle(e);return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,left:r.left,top:r.top,viewportWidth:innerWidth,viewportHeight:innerHeight,transform:s.transform,margin:s.margin,inset:s.inset,animation:s.animationName};})()`);assert.ok(Math.abs(r.x-r.viewportWidth/2)<2,label+' horizontally centered: '+JSON.stringify(r));assert.ok(Math.abs(r.y-r.viewportHeight/2)<2,label+' vertically centered: '+JSON.stringify(r));assert.ok(r.width<=maxWidth+1,label+' compact width');assert.ok(r.left>=8&&r.top>=8,label+' viewport margins');};
 const input=(selector,value)=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const screenshot=async name=>{const directory=resolve('release/key-creation-test');await mkdir(directory,{recursive:true});await pause(100);await writeFile(join(directory,name),(await win.webContents.capturePage()).toPNG());};
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await wait(`[...document.querySelectorAll('button')].some(e=>e.textContent==='API 代理')`);await click('API 代理');await wait(`!!document.querySelector('.tfKeysHead button[aria-label="创建 Key"]:not(:disabled)')`);
  assert.equal(await evaluate(`!!document.querySelector('.tfGatewayAccess')`),false);
  assert.equal(await evaluate(`!!document.querySelector('dialog[open]')`),false,'quota HTTP 401 alone is not expired login');
  await evaluate(`void(window.desktop={platform:'darwin',copyText:async value=>{window.__copied=value;}})`);await evaluate(`document.querySelector('button[aria-label="创建 Key"]').click()`);await wait(`!!document.querySelector('dialog[open] .tfCompactPicker')`);
  await centered('create',720);await screenshot('create-key-initial.png');
  assert.equal(await evaluate(`document.querySelector('.tfAccessChoices input:checked').value`),'local');
  assert.equal(await evaluate(`document.querySelectorAll('.tfCompactPicker .tfPickModel').length`),0,'models start collapsed');
  assert.equal(await evaluate(`document.querySelector('.tfCompactPicker .tfAgentPickerCatalog')`),null,'only source icons appear before choosing one');
  assert.equal(await evaluate(`document.querySelector('.tfAgentPickerSources button').tabIndex`),0,'collapsed source choice remains keyboard reachable');
  assert.equal(await evaluate(`document.querySelectorAll('.tfAgentPickerSources button').length`),1,'accounts share one provider icon');
  const layout=await evaluate(`(()=>{const h=document.querySelector('.tfPickerToolbar h3').getBoundingClientRect(),s=document.querySelector('.tfPickerToolbar .tfSearch').getBoundingClientRect();return {distance:Math.abs((h.top+h.bottom-s.top-s.bottom)/2),overlap:s.left<h.right};})()`);assert.ok(layout.distance<5);assert.equal(layout.overlap,false);
  assert.notEqual(await evaluate(`getComputedStyle(document.querySelector('.tfAgentPickerSources .tfProviderIcon')).display`),'none');
  await evaluate(`document.querySelector('.tfAgentPickerSources button').click()`);await wait(`document.querySelectorAll('.tfPickerAccounts input').length===2`);assert.equal(await evaluate(`document.querySelectorAll('.tfCompactPicker .tfPickModel').length`),0,'choose account before showing models');await evaluate(`document.querySelector('.tfPickerAccounts input').click()`);await wait(`!!document.querySelector('.tfCompactPicker .tfPickModel')`);await evaluate(`document.querySelector('.tfCompactPicker .tfPickModel').click()`);
  await evaluate(`document.querySelector('input[type=radio][value=lan]').click()`);await input('input[aria-label="来源 IP 限定"]','192.168.1.23');
  await wait(`!!document.querySelector('.tfKeyIPField input')`);await screenshot('create-key.png');
  win.setSize(620,760);await pause(100);assert.equal(await evaluate(`document.querySelector('dialog[open] form').scrollWidth<=document.querySelector('dialog[open] form').clientWidth+1`),true);await screenshot('create-key-narrow.png');win.setSize(1280,900);await pause(100);await click('生成 Key');await wait(`!!document.querySelector('dialog[open][aria-label="Key 已创建"]')`);
  assert.equal(payload.access,'lan');assert.deepEqual(payload.allowedIPs,['192.168.1.23']);assert.deepEqual(payload.models,[model]);
  assert.equal(await evaluate(`document.querySelector('dialog[open]').textContent.includes('使用情况')`),false);
  assert.equal(await evaluate(`document.querySelector('dialog[open]').getBoundingClientRect().width<=560`),true);
  const popup=await evaluate(`(()=>{const r=document.querySelector('dialog[open]').getBoundingClientRect();return {height:r.height,x:r.left+r.width/2,y:r.top+r.height/2,w:innerWidth,h:innerHeight};})()`);assert.ok(popup.height<650);assert.ok(Math.abs(popup.x-popup.w/2)<2);assert.ok(Math.abs(popup.y-popup.h/2)<2);
  await evaluate(`void(window.desktop={platform:'darwin',copyText:async value=>{window.__copied=value;}})`);await click('复制完整信息');await wait(`!!window.__copied`);const copied=await evaluate('window.__copied');assert.match(copied,/192.168.1.10:9555\/v1/);assert.match(copied,/fixture-secret/);assert.match(copied,/codex\/fixture-model/);
  access={...access,addresses:['http://10.2.6.48:9555','http://192.168.50.10:9555']};
  await evaluate(`window.dispatchEvent(new Event('online'))`);await wait(`document.querySelector('.tfCreatedInfo').textContent.includes('10.2.6.48:9555/v1')`);
  await click('复制完整信息');await wait(`window.__copied.includes('10.2.6.48:9555/v1')`);assert.equal((await evaluate('window.__copied')).includes('192.168.1.10'),false);
  await screenshot('key-created.png');await click('完成');await wait(`!document.querySelector('dialog[open]')`);
  await evaluate(`document.querySelector('.tfKeyCardMain').click()`);await wait(`!!document.querySelector('dialog[open] .tfDetailTabs')`);await centered('details',680);
  access={...access,addresses:['http://10.15.11.5:9555']};await evaluate(`window.dispatchEvent(new Event('focus'))`);await wait(`document.querySelector('input[aria-label="OpenAI 格式 Base URL"]').value==='http://10.15.11.5:9555/v1'`);
  await screenshot('key-details.png');assert.equal(await evaluate(`document.querySelector('dialog[open]').textContent.includes('使用情况')`),true);await evaluate(`document.querySelector('dialog[open] button[aria-label=关闭]').click()`);
  await evaluate(`document.querySelector('button[aria-label="管理 应用 Key 1"]').click()`);await click('重命名');await wait(`!!document.querySelector('dialog[open] form[aria-label="重命名 Key"]')`);await centered('rename',400);await click('取消');
  await click('API 接口');await wait(`!!document.querySelector('button[aria-label="添加 API"]')`);await evaluate(`document.querySelector('button[aria-label="添加 API"]').click()`);await wait(`!!document.querySelector('dialog[open] .tfApiEditor')`);await centered('API editor',640);await screenshot('api-editor.png');await evaluate(`document.querySelector('dialog[open] button[aria-label=关闭]').click()`);
  await evaluate(`document.querySelector('button[aria-label="打开维修师傅"]').click()`);await wait(`!!document.querySelector('dialog[open]#tf-repair-panel')`);await centered('repair',640);await evaluate(`document.querySelector('button[aria-label="选择维修模型"]').click()`);await wait(`!!document.querySelector('.tfRepairModelMenu')`);assert.equal(await evaluate(`document.querySelector('.tfRepairModelMenu').closest('dialog').id`),'tf-repair-panel');await screenshot('repair-dialog.png');await evaluate(`document.querySelector('button[aria-label="选择维修模型"]').click();document.querySelector('button[aria-label="收起"]').click()`);await wait(`!document.querySelector('dialog[open]')`);
  await click('本地 Agent');await wait(`!!document.querySelector('.tfUsageDetails')`);await evaluate(`document.querySelector('.tfUsageDetails summary').click()`);assert.equal(await evaluate(`document.querySelector('.tfUsageDetails .tfUsageTotal strong').textContent`),'1亿');assert.equal(await evaluate(`!!document.querySelector('.tfUsageDetails .tfRange')`),false);await wait(`!!document.querySelector('.tfAgentsPage button[aria-label="选择模型"]')`);await evaluate(`document.querySelector('.tfAgentsPage button[aria-label="选择模型"]').click()`);await wait(`!!document.querySelector('dialog[open].tfAgentPicker')`);await centered('model picker',800);assert.ok(await evaluate(`document.querySelector('dialog.tfAgentPicker').getBoundingClientRect().height>700`),'taller model picker');assert.equal(await evaluate(`getComputedStyle(document.querySelector('dialog.tfAgentPicker')).outlineStyle`),'none');await screenshot('model-picker.png');await evaluate(`document.querySelector('dialog[open] button[aria-label=关闭]').click()`);
  await click('账号授权');await wait(`!!document.querySelector('.tfAccountDetail')`);
  assert.equal(await evaluate(`document.querySelectorAll('.tfAccountsPage .tfUsageFold').length`),1);assert.match(await evaluate(`document.querySelector('.tfAccountsPage .tfUsageFold').textContent`),/今日用量.*1亿.*97%/);assert.equal(await evaluate(`document.querySelector('.tfProviderPanel').firstElementChild.classList.contains('tfUsageFold')`),true);await evaluate(`document.querySelector('.tfProviderRefresh').click()`);await wait(`!document.querySelector('.tfProviderRefresh').disabled`);assert.deepEqual(accountRefreshes,[`/api/local-agent/accounts/${sourceId}/refresh`]);assert.equal(await evaluate(`document.querySelector('.tfAccountsPage').textContent.includes('已保存 2 份授权')`),false);assert.equal(await evaluate(`document.querySelector('.tfAccountsPage').textContent.includes('登录状态已失效')`),false);
  local.accounts[0].authenticationRequired=true;local.accounts[0].unavailable=true;
  await evaluate(`document.querySelector('.tfProviderRefresh').click()`);await wait(`!!document.querySelector('dialog[open][aria-label="登录授权已失效"]')`);assert.equal(removals,0);await click('确定移除');await wait(`!document.querySelector('dialog[open]')`);assert.equal(removals,1);
  console.log('PASS: centered creation/details/rename/API/model/repair dialogs, icon entries, local/LAN choice, source IP field, success popup, complete copy, separate details, one daily account usage total, and confirmed expired-grant removal');
 }catch(error){await screenshot('failure.png');error.message+='\n'+JSON.stringify(rendererErrors.slice(-3))+'\n'+await evaluate(`JSON.stringify({text:document.querySelector('.tfAgentsPage')?.innerText,buttons:[...document.querySelectorAll('main button')].map(e=>({label:e.getAttribute('aria-label'),text:e.textContent}))})`);throw error;}
 finally{win.destroy();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:50});app.quit();}
})().catch(error=>{console.error(error);app.exit(1);});
