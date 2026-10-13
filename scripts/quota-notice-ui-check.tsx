// Isolated, static rendering of the same component and production styles.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {_electron as electron} from 'playwright';
import {QuotaDetails,quotaErrorMessage} from '../apps/console/src/QuotaDetails';
const root=await mkdtemp(join(tmpdir(),'quota-notice-'));let app;
try{
 const error='额度上游连接失败（HTTP 502），网关已响应。 已尝试 5 次，请稍后重试或检查网络与代理。';
 assert.equal(quotaErrorMessage(error),'网络暂时不稳定，额度更新失败，请稍后刷新。');
 assert.match(quotaErrorMessage('HTTP 401'),/重新授权/);assert.match(quotaErrorMessage('HTTP 429'),/太频繁/);assert.equal(quotaErrorMessage('unknown internal details'),'暂时无法更新额度，请稍后刷新。');
 const quota={accountId:'fixture',provider:'codex' as const,status:'error' as const,error,observedAt:'2026-10-13T11:38:11Z',lastSuccessfulAt:'2026-10-13T11:32:43Z',windows:[{id:'week',label:'Codex · 7 天',usedPercent:45,resetsAt:'2026-10-20T04:59:07Z'}]};
 const css=(await Promise.all(['style.css','flow.css'].map(f=>readFile('apps/console/src/'+f,'utf8')))).join('\n');
 const markup=renderToStaticMarkup(createElement(QuotaDetails,{quota,label:'Fixture'}));
 const bootstrap=join(root,'main.cjs');await writeFile(bootstrap,`const {app,BrowserWindow}=require('electron');app.setPath('userData',${JSON.stringify(root)});app.whenReady().then(()=>{const w=new BrowserWindow({show:false,width:700,height:700});w.webContents.setBackgroundThrottling(false);w.loadURL('about:blank');});`);
 app=await electron.launch({args:[bootstrap]});const page=await app.firstWindow();await mkdir('artifacts/quota-notice',{recursive:true});
 for(const context of ['agent','account'])for(const width of [230,360,520]){
  await page.setContent(`<style>${css}</style><div class="tf" style="display:block;padding:24px;height:auto"><section style="width:${width}px" class="${context==='account'?'tfAccountColumns':''}"><div class="${context==='account'?'tfQuotaSide':'tfModelCardDetail'}">${markup}</div></section></div>`);
  const quotaBox=page.locator('.quota');const geometry=await quotaBox.evaluate(n=>({display:getComputedStyle(n).display,height:n.getBoundingClientRect().height,width:n.clientWidth,scroll:n.scrollWidth,rows:[...n.children].map(c=>({y:c.getBoundingClientRect().y,bottom:c.getBoundingClientRect().bottom}))}));
  assert.equal(geometry.display,'grid');assert.ok(geometry.height<310,JSON.stringify(geometry));assert.ok(geometry.scroll<=geometry.width+1);for(let i=1;i<geometry.rows.length;i++)assert.ok(geometry.rows[i].y>=geometry.rows[i-1].bottom,'quota content must stack, not squeeze sideways');
  assert.equal(await page.locator('.quota.error').count(),0);assert.ok(!(await quotaBox.innerText()).includes('HTTP'));assert.match(await page.getByRole('status').innerText(),/网络暂时不稳定/);assert.match(await page.locator('.quotaStale').innerText(),/非实时/);
  if(width===360)await page.screenshot({path:resolve(`artifacts/quota-notice/${context}.png`)});
 }
 console.log('Quota notice: network/auth/rate-limit copy and six narrow-column layouts passed.');
}finally{await app?.close();await rm(root,{recursive:true,force:true});}
