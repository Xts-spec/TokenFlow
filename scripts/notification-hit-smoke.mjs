import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
// Exercise the actual notification CSS and native popover hit testing, without any accounts or server.
const browser=await chromium.launch({channel:'chrome'});
try{
 const page=await browser.newPage({viewport:{width:1320,height:900}});
 const css=await readFile('apps/console/src/flow.css','utf8');
 await page.setContent(`<style>${css}</style><div class="tf nativeMac"><button id="under" style="position:fixed;inset:0" onclick="window.clicked=true">Underlying action</button><div class="tfNotifications" popover="manual"><section class="tfToast ok"><span class="tfToastIcon">✓</span><div class="tfToastText"><strong>操作完成</strong><p>配置已保存</p></div><button class="tfToastClose">关闭提示</button></section></div></div>`);
 await page.locator('.tfNotifications').evaluate(el=>el.showPopover());
 const point=await page.locator('.tfNotifications').evaluate(el=>{const r=el.getBoundingClientRect();return {x:r.x+4,y:r.y+4};});
 assert.equal(await page.evaluate(p=>document.elementFromPoint(p.x,p.y)?.id,point),'under','transparent notification edge must pass clicks through');
 await page.mouse.click(point.x,point.y);assert.equal(await page.evaluate(()=>window.clicked),true);
 await page.getByRole('button',{name:'关闭提示',exact:true}).click();
 console.log(JSON.stringify({notificationHitTesting:'passed',transparentEdge:'clicks through',closeButton:'clickable'}));
}finally{await browser.close();}
