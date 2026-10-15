import {DatabaseSync} from 'node:sqlite';
import {chromium} from 'playwright';
import {extractFile} from '@electron/asar';
import {execFileSync,spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtemp,readFile,rm,writeFile,mkdir,realpath} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {tmpdir} from 'node:os';
import assert from 'node:assert/strict';
import {createServer} from 'node:net';
// Verify the three packages and launch both Mac architectures in isolated data directories.
const [arm,intel,windows]=process.argv.slice(2);
if(!arm)throw Error('Provide Apple Silicon .app; optional Intel .app and Windows unpacked directory');
const results=[];
for(const [path,platform,arch] of [[arm,'darwin','arm64'],[intel,'darwin','x64'],[windows,'win32','x64']].filter(([path])=>!!path)){
 console.log(JSON.stringify({checking:platform+'-'+arch}));
 const root=resolve(path),resources=join(root,platform==='darwin'?'Contents/Resources':'resources');
 const productName=platform==='darwin'?basename(root,'.app'):'TokenFlow';
 const binary=join(root,platform==='darwin'?`Contents/MacOS/${productName}`:`${productName}.exe`);
 const sidecar=join(resources,'sidecars',`${platform}-${arch}`,platform==='win32'?'cliproxyapi.exe':'cliproxyapi');
 const expected=platform==='win32'?'x86-64':arch==='arm64'?'arm64':'x86_64';
 for(const file of [binary,sidecar])assert.ok(execFileSync('file',[file],{encoding:'utf8'}).includes(expected),`wrong architecture: ${file}`);
 const asar=join(resources,'app.asar');
 for(const icon of ['pi','deepseek'])assert.deepEqual(extractFile(asar,`dist/console/provider-icons/${icon}.svg`),await readFile(`apps/console/public/provider-icons/${icon}.svg`));
 const main=extractFile(asar,'dist/main.js').toString();assert.ok(main.includes('sidecars'));
 let startup='not executed on Windows';
 if(platform==='darwin'){
  const home=await mkdtemp(join(await realpath(tmpdir()),'token-flow-package-'));let browser,child,page,startupLog='';
  try{
   await mkdir(join(home,'codex/sessions'),{recursive:true});await writeFile(join(home,'codex/sessions/native-fixture.jsonl'),[JSON.stringify({type:'session_meta',payload:{id:'fixture-thread',model_provider:'openai'}}),JSON.stringify({type:'turn_context',payload:{model:'native-package-test'}}),JSON.stringify({type:'token_usage_record',timestamp:new Date().toISOString(),payload:{response_id:'fixture-response',usage:{input_tokens:100,cached_input_tokens:50,output_tokens:20}}})].join('\n')+'\n');
   const db=new DatabaseSync(join(home,'codex/logs_2.sqlite'));db.exec('CREATE TABLE logs(id INTEGER PRIMARY KEY,ts INTEGER,thread_id TEXT,target TEXT,feedback_log_body TEXT)');db.prepare('INSERT INTO logs(ts,thread_id,target,feedback_log_body) VALUES(?,?,?,?)').run(Math.floor(Date.now()/1000),'fixture-thread','codex_http_client::client','POST https://chatgpt.com/backend-api/codex/responses');db.close();
   const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
   const env={...process.env,HOME:home,AGENT_DATA_ROOT:home,CODEX_HOME:join(home,'codex'),CLAUDE_CONFIG_DIR:join(home,'claude'),WORKBUDDY_CONFIG_DIR:join(home,'workbuddy'),QODER_CONFIG_DIR:join(home,'qoder'),PI_CODING_AGENT_DIR:join(home,'pi'),DSH_HOME:join(home,'dsh'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port)};
   child=spawn(binary,['--remote-debugging-port=0','--use-mock-keychain',...(arch==='x64'?['--disable-gpu']:[])],{env,stdio:['ignore','ignore','pipe']});
   const endpoint=await new Promise((resolve,reject)=>{let log='';const timer=setTimeout(()=>reject(Error('Packaged startup timed out: '+log.slice(-2000))),arch==='x64'?60000:30000);child.once('error',e=>{clearTimeout(timer);reject(e);});child.once('exit',code=>{clearTimeout(timer);reject(Error('Packaged process exited '+code+': '+log.slice(-2000)));});child.stderr.on('data',chunk=>{log+=String(chunk);startupLog=log.slice(-4000);const m=log.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(m){clearTimeout(timer);resolve(m[1]);}});});
   browser=await chromium.connectOverCDP(endpoint,{timeout:arch==='x64'?60000:30000});
   page=browser.contexts()[0].pages()[0]??await browser.contexts()[0].waitForEvent('page');await page.getByRole('navigation',{name:'主导航'}).waitFor();
   await page.waitForFunction(async()=>{try{return (await fetch('/api/local-agent').then(r=>r.json())).state==='running';}catch{return false;}},{},{timeout:30000});
   await page.route('**/api/a2a/program-updates',route=>route.fulfill({json:{updates:{}}}));
   await page.locator('.tfBrand .dot.ok').waitFor();
   await page.waitForFunction(async()=>{const stats=await fetch('/api/usage/overview?days=0').then(r=>r.json());if(stats.warning)throw Error(stats.warning);return !stats.scanning&&stats.nativeRows.some(r=>r.model==='native-package-test'&&r.inputTokens+r.outputTokens===120&&r.channel==='official');},undefined,{timeout:30000});
   const targets=await page.evaluate(async()=>{const response=await fetch('/api/a2a');if(!response.ok)throw Error('Agent status unavailable: '+response.status+' '+await response.text());return (await response.json()).targets;});
   assert.equal(targets.length,6);const pi=targets.find(t=>t.id==='pi');assert.ok(pi.installation.download.startsWith('https://pi.dev/'));assert.equal(pi.restartSupported,true);
   if(arch==='x64')assert.equal(targets.find(t=>t.id==='deepseek').installation.supported,false);
   await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'本地 Agent',exact:true}).click();
   const startupNotices=await page.locator('.tfToast.error .tfToastText').allTextContents();if(startupNotices.length)console.log(JSON.stringify({arch,startupNotices}));
   for(const button of await page.getByRole('button',{name:'关闭提示',exact:true}).all())if(await button.isVisible())await button.click();
   const tiles=page.getByRole('tablist',{name:'本地 Agent'});await tiles.getByRole('tab',{name:/Pi Agent/}).click();
   const dialog=page.getByRole('dialog',{name:'安装 Pi Agent',exact:true});if(await dialog.isVisible())await dialog.getByRole('button',{name:'稍后再说'}).click();
   const panel=page.getByRole('region',{name:'Pi Agent',exact:true});await panel.waitFor();
   assert.equal(await panel.getByRole('button',{name:/使用说明|重新检测/}).count(),0);assert.equal(await panel.getByRole('button',{name:'重启…',exact:true}).count(),0);
   assert.equal(await panel.locator('.tfAgentTitle h2 + button').count(),1);
   startup=arch==='x64'?'passed via Rosetta':'passed native';
  }catch(error){console.error(JSON.stringify({failed:platform+'-'+arch,startupLog}));throw error;}finally{await page?.close().catch(()=>{});await browser?.close().catch(()=>{});if(child&&child.exitCode===null){await new Promise(r=>{const timer=setTimeout(()=>{child.kill('SIGTERM');r();},5000);child.once('exit',()=>{clearTimeout(timer);r();});});}await rm(home,{recursive:true,force:true});}
 }
 results.push({path:root,platform,arch,architecture:'verified',officialIcons:'verified',asarSHA256:createHash('sha256').update(await readFile(asar)).digest('hex'),startup});
}
await mkdir('artifacts',{recursive:true});await writeFile('artifacts/agent-package-validation.json',JSON.stringify({checkedAt:new Date().toISOString(),results},null,2)+'\n');
console.log(JSON.stringify({packagedAgents:'passed',results}));
