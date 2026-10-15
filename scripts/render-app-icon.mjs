// The SVG is the editable brand master; raster exports come from the same geometry.
import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1024,height:1024},deviceScaleFactor:1});
 const svg=await readFile(new URL('../apps/console/public/logo.svg',import.meta.url),'utf8');
 await page.setContent(`<style>html,body{margin:0;width:1024px;height:1024px;background:transparent}svg{display:block;width:896px;height:896px;margin:64px}</style>${svg}`);
 await page.screenshot({path:new URL('../apps/console/public/app-icon.png',import.meta.url).pathname,omitBackground:true});
 const mark=svg.replace('viewBox="0 0 100 100"','viewBox="16 16 68 68"').replace(/<rect[^>]*\/>/,'').replace(/#eeeff2|#a7adb8/g,'#202123');
 await page.setViewportSize({width:64,height:64});
 await page.setContent(`<style>html,body{margin:0;width:64px;height:64px;background:transparent}svg{display:block;width:64px;height:64px}</style>${mark}`);
 await page.screenshot({path:new URL('../apps/console/public/tray-icon.png',import.meta.url).pathname,omitBackground:true});
}finally{await browser.close();}
