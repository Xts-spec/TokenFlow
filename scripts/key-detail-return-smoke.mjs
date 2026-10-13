import {_electron as electron} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {verifyOtherDetailReturns} from './detail-return-ui-check.mjs';

// Isolated app profile and loopback fixtures; never touches installed keys or accounts.
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-key-return-'));
const output=resolve('artifacts/key-detail-return');
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
 app=await electron.launch({args:[bootstrap],env:{...env,HOME:root,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),PI_CODING_AGENT_DIR:join(root,'pi'),DSH_HOME:join(root,'dsh'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
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
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'API 代理',exact:true}).click();
 await page.getByRole('article',{name:'Key 8',exact:true}).waitFor();
 const geometry=()=>page.evaluate(()=>{const main=document.querySelector('.tfMain'),shell=document.querySelector('.tf'),side=document.querySelector('.tfSide');return {rootScroll:document.scrollingElement.scrollTop,rootScrollHeight:document.scrollingElement.scrollHeight,shellY:shell.getBoundingClientRect().y,sideY:side.getBoundingClientRect().y,mainY:main.getBoundingClientRect().y,mainScroll:main.scrollTop,mainHeight:main.clientHeight,mainScrollHeight:main.scrollHeight,viewportHeight:innerHeight};});
 const previews=()=>page.locator('.tfKeyCard').evaluateAll(cards=>cards.map(c=>({name:c.getAttribute('aria-label'),models:[...c.querySelectorAll('.tfKeyPreview li')].map(m=>m.textContent)})));
 const initialPreviews=await previews();
 if(!process.argv.includes('--other-pages-only'))for(const width of [1024,1320,480]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,900),width);
  await page.setViewportSize({width,height:800});
  for(const keyName of ['Key 1','Key 8']){
   const card=page.getByRole('article',{name:keyName,exact:true});
   await card.getByRole('button',{name:`查看 ${keyName}`,exact:true}).scrollIntoViewIfNeeded();
   const before=await geometry();
   await card.getByRole('button',{name:`查看 ${keyName}`,exact:true}).click();
   const detail=page.getByRole('dialog',{name:`Key 详情 · ${keyName}`,exact:true});
   await detail.getByRole('tab',{name:'接入信息',exact:true}).click();
   await detail.hover();
   await page.mouse.wheel(0,1200);
   await page.waitForTimeout(250);
   const open=await geometry();
   console.log(JSON.stringify({width,keyName,before,open}));
   await page.screenshot({path:join(output,`${width}-${keyName.replace(' ','-')}-open.png`)});
   assert.equal(open.rootScroll,before.rootScroll,'opening Key details must not scroll the entire application');
   assert.equal(open.sideY,before.sideY,'opening details must leave the sidebar in place');
   await detail.getByRole('button',{name:'管理模型',exact:true}).click();
   const picker=page.getByRole('dialog',{name:'管理 Key 支持的模型',exact:true});
   await picker.getByRole('searchbox').fill('Return API');
   await picker.getByRole('button',{name:'取消',exact:true}).click();
   await detail.waitFor();
   if(width>=700){const box=await detail.boundingBox();await page.mouse.click(box.x+2,box.y+Math.min(60,box.height-2));assert.equal(await detail.isVisible(),true,'blank space inside a dialog stays open');await page.mouse.move(box.x+50,box.y+100);await page.mouse.down();await page.mouse.move(box.x-12,box.y+100);await page.mouse.up();assert.equal(await detail.isVisible(),true,'dragging outside stays open');await page.mouse.click(box.x-12,box.y+100);}else await detail.getByRole('button',{name:'关闭',exact:true}).click();
   await detail.waitFor({state:'hidden'});
   const after=await geometry();
   await page.screenshot({path:join(output,`${width}-${keyName.replace(' ','-')}-returned.png`)});
   console.log(JSON.stringify({width,keyName,after}));
   assert.equal(after.rootScroll,before.rootScroll,'returning from Key details must not shift the entire application');
   assert.equal(after.sideY,before.sideY,'returning must keep the sidebar fixed to the viewport');
   assert.equal(after.mainScroll,before.mainScroll,'returning must keep the Key list at its original scroll position');
   assert.deepEqual(await previews(),initialPreviews,'returning must preserve each Key’s own model preview');
   assert.equal(await page.locator('dialog[open]').count(),0,'returning must remove every dialog overlay');
   assert.equal(await card.getByRole('button',{name:`查看 ${keyName}`,exact:true}).evaluate(node=>document.activeElement===node),true,'returning must restore focus to the original Key without scrolling');
  }
 }
 await verifyOtherDetailReturns({page,api,models,source,output});
 console.log(JSON.stringify({keyDetailReturn:'passed',modelPreviewsUnchanged:true,desktopAndNarrow:true}));
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
