import {_electron as electron} from 'playwright';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

const root=await mkdtemp(join(tmpdir(),'token-flow-background-'));
const allocator=createServer();
await new Promise(r=>allocator.listen(0,'127.0.0.1',r));
const port=allocator.address().port;
await new Promise(r=>allocator.close(r));
let desktop;
try{
  const executablePath=process.argv[2];
  desktop=await electron.launch({args:[...(executablePath?[]:['.']),'--use-mock-keychain'],...(executablePath?{executablePath:resolve(executablePath)}:{}),env:{...process.env,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
  const page=await desktop.firstWindow();
  await page.waitForFunction(()=>fetch('/api/local-agent').then(r=>r.json()).then(s=>s.state==='running'));
  await page.evaluate(()=>localStorage.setItem('background-smoke','preserved'));
  const hidden=await desktop.evaluate(({BrowserWindow})=>{
    const window=BrowserWindow.getAllWindows()[0];
    window.close();
    return {visible:window.isVisible(),destroyed:window.isDestroyed()};
  });
  assert.deepEqual(hidden,{visible:false,destroyed:false});
  // Startup discovery can briefly restart the gateway while the window is hidden.
  await page.waitForFunction(()=>fetch('/api/local-agent').then(r=>r.json()).then(s=>s.state==='running'));
  assert.equal(await page.evaluate(()=>fetch('/api/local-agent').then(r=>r.json()).then(s=>s.state)),'running');
  assert.equal((await fetch(`http://127.0.0.1:${port}/fixture`)).ok,true);
  await desktop.evaluate(({app})=>app.emit('activate'));
  assert.equal(await desktop.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isVisible()),true);
  assert.equal(await page.evaluate(()=>localStorage.getItem('background-smoke')),'preserved');
  // Playwright calls app.quit() and detaches its debugger so Electron can exit.
  await desktop.close();
  desktop=undefined;
  await assert.rejects(fetch(`http://127.0.0.1:${port}/fixture`));
  console.log('PASS: close hides window, gateway stays available, activate restores state, quit stops service');
}finally{
  await desktop?.close();
  await rm(root,{recursive:true,force:true});
}
