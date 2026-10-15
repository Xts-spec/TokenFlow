import {_electron as electron,chromium} from 'playwright';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';

// Isolated app profile and loopback fixtures; never touches installed keys or accounts.
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-refinement-'));
const output=resolve('output/playwright/cli-hover-scroll');
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



 const apiCard=page.locator('.tfApiSourceCard').first(),keyCard=page.locator('.tfKeyCard').first();
 const checks=[];
 const nav=page.getByRole('navigation',{name:'主导航'});
 await nav.getByRole('button',{name:'API 接口',exact:true}).click();
 await apiCard.hover();await page.waitForTimeout(300);
 const apiTransform=await apiCard.evaluate(n=>getComputedStyle(n).transform);
 await nav.getByRole('button',{name:'CLI 代理',exact:true}).click();
 await keyCard.hover();await page.waitForTimeout(300);
 const cliTransform=await keyCard.evaluate(n=>getComputedStyle(n).transform);
 const innerTransform=await keyCard.locator('.tfKeyCardMain').evaluate(n=>getComputedStyle(n).transform);
 checks.push({name:'CLI hover matches API without extra button scaling',pass:apiTransform===cliTransform&&innerTransform==='none',apiTransform,cliTransform,innerTransform});
 await keyCard.locator('.tfKeyCardMain').click();
 const dialog=page.locator('.tfKeyDetail');
 await dialog.getByRole('tab',{name:'使用情况',exact:true}).click();
 for(const theme of ['dark','light'])for(const width of [1320,480]){
  await page.setViewportSize({width,height:800});
  await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await dialog.evaluate(n=>n.scrollTop=300);
  await page.waitForTimeout(80);
  const geometry=await dialog.evaluate(n=>{const h=n.querySelector('.tfDialogContent>header'),b=n.getBoundingClientRect(),r=h.getBoundingClientRect();return {scroll:n.scrollTop,dialogTop:b.top,headerTop:r.top,headerBottom:r.bottom,top:getComputedStyle(h).top};});
  checks.push({name:`title covers scroll top ${theme} ${width}`,pass:geometry.scroll>0&&geometry.headerTop>=geometry.dialogTop&&geometry.headerTop<=geometry.dialogTop+2,...geometry});
  await page.screenshot({path:join(output,`key-scroll-${theme}-${width}.png`)});
 }
 console.log(JSON.stringify(checks,null,2));
 assert.ok(checks.every(c=>c.pass),'CLI hover and sticky title regression');
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
