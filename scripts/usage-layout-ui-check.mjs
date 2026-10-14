import assert from 'node:assert/strict';
import {verifyAgentSwitching} from './agent-switch-ui-check.mjs';
import {join} from 'node:path';

export async function verifyUsageLayout({page,output}){
 await page.setViewportSize({width:1320,height:900});
 const nav=page.getByRole('navigation',{name:'主导航'});
 await nav.getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/Pi Agent/}).click();
 const pi=page.getByRole('region',{name:'Pi Agent',exact:true});
 assert.equal(await pi.locator('.tfPanelHead .tfUsageFold').count(),1,'Agent total replaces the redundant header state');
 assert.equal(await pi.locator('.tfUsageFold').count(),1,'Agent usage must appear only once');
 assert.equal(await pi.locator('.tfPanelHead p').count(),0);
 assert.equal(await pi.getByRole('region',{name:'官方登录账号',exact:true}).count(),0);
 assert.equal(await pi.locator('.tfAgentTitle .tfAgentVersion').count(),1);const modelRows=pi.locator('ul.tfLines').last().locator(':scope>li');const existingCount=await modelRows.count();if(existingCount>1){const original=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));await modelRows.last().getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(modelRows.first());assert.equal(await page.locator('dialog[open]').count(),0);const afterDrag=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));assert.deepEqual(afterDrag.targets.find(t=>t.id==='pi').connection.selections,original.targets.find(t=>t.id==='pi').connection.selections);await modelRows.filter({has:page.getByText('aaa-model',{exact:true})}).getByRole('button',{name:'移除',exact:true}).click();assert.equal(await modelRows.count(),existingCount-1);assert.equal(await page.locator('dialog[open]').count(),0);const beforeApply=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));assert.equal(beforeApply.targets.find(t=>t.id==='pi').connection.selections.length,existingCount);await pi.getByRole('switch',{name:'启用网关模型',exact:true}).check();await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(await pi.getByRole('button',{name:/^重启/}).count(),0);await page.waitForFunction(async expected=>{const state=await fetch('/api/a2a').then(r=>r.json());return state.targets.find(t=>t.id==='pi').connection?.selections?.length===expected;},existingCount-1);const afterApply=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));assert.equal(afterApply.targets.find(t=>t.id==='pi').connection.selections.length,existingCount-1);}

 assert.equal(await pi.locator('.tfModelCardMain button').count(),0);const gatewaySwitch=pi.getByRole('switch',{name:'启用网关模型',exact:true});assert.equal(await gatewaySwitch.isChecked(),true);await gatewaySwitch.uncheck();await gatewaySwitch.waitFor();await page.waitForFunction(async()=>{const state=await fetch('/api/a2a').then(r=>r.json());return !state.targets.find(t=>t.id==='pi').connection;});assert.equal(await gatewaySwitch.isChecked(),false);await gatewaySwitch.check();await page.waitForFunction(async()=>{const state=await fetch('/api/a2a').then(r=>r.json());return !!state.targets.find(t=>t.id==='pi').connection;});await page.waitForFunction(()=>!document.querySelector('dialog[open]'));assert.equal(await pi.getByRole('button',{name:/^重启/}).count(),0);

 const compactRows=pi.locator('.tfGatewaySection .tfLines > li');const layout=await compactRows.evaluateAll(nodes=>nodes.map(n=>{const box=n.getBoundingClientRect(),detail=n.querySelector('.tfActions button:first-child').getBoundingClientRect(),remove=n.querySelector('.tfActions button:last-child').getBoundingClientRect(),name=n.querySelector('.tfModelCardMain').getBoundingClientRect();return {height:box.height,y:box.y,bottom:box.bottom,gap:remove.x-detail.right,overlap:name.right>detail.x};}));assert.ok(layout.every(row=>row.height<=64&&row.gap>=12&&!row.overlap),'compact cards keep distinct actions beside the name');for(let i=1;i<layout.length;i++)assert.ok(Math.abs(layout[i].y-layout[i-1].bottom-8)<1);const columns=pi.locator('.tfAgentColumns'),section=pi.getByRole('region',{name:'网关模型',exact:true});assert.ok(Math.abs((await columns.boundingBox()).height-(await section.boundingBox()).height)<1,'few models must not retain an old container height');assert.equal(await columns.evaluate(n=>n.style.minHeight),'');
 const originalHeight=(await columns.boundingBox()).height;await compactRows.first().getByRole('button',{name:'详情',exact:true}).click();await compactRows.first().getByRole('button',{name:'收起',exact:true}).click();assert.equal((await columns.boundingBox()).height,originalHeight,'closing details restores compact content height');await page.screenshot({path:join(output,'agent-compact-cards.png')});

 await verifyAgentSwitching({page});
 await page.setViewportSize({width:1320,height:900});
 await page.getByRole('tab',{name:/^Codex/}).click();const codex=page.getByRole('region',{name:'Codex',exact:true});
 assert.equal(await codex.getByRole('region',{name:'官方登录账号',exact:true}).count(),0);assert.equal(await codex.locator('.tfAgentColumns.hasLogin').count(),0);await page.screenshot({path:join(output,'agent-no-accounts.png')});
 await nav.getByRole('button',{name:'账号授权',exact:true}).click();
 assert.equal(await page.locator('.tfProviderPanel .tfUsageFold').count(),1,'authorization shows only the provider total');
 await page.getByRole('button',{name:'活动',exact:true}).click();assert.equal(await page.locator('.tfUsageSummary,.tfBreakTabs').count(),0);
 await page.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await page.locator('.tfUsageOverview').count(),0);
 await page.getByRole('button',{name:'用量总览',exact:true}).click();const tabs=page.getByRole('tablist',{name:'用量分类',exact:true});assert.equal(await tabs.getByRole('tab').count(),3);assert.equal(await page.locator('.tfCoverage,.tfTokenActivity footer').count(),0);assert.deepEqual(await page.locator('.tfUsageOverview h3').allTextContents().then(t=>t.slice(0,3)),['Token 活动']);
 for(const title of ['使用方式','来源','模型']){await tabs.getByRole('tab',{name:title,exact:true}).click();assert.equal(await page.locator('[role=tabpanel] .tfBreakdown').count(),1);}
 const overview=page.getByRole('region',{name:'用量总览',exact:true});
 assert.equal(await overview.getByRole('region',{name:'官方账号与 API Key',exact:true}).count(),0);
 assert.equal(await overview.getByRole('region',{name:'本地 Agent 与 CLI 代理',exact:true}).count(),0);
 assert.equal(await overview.locator('.tfTokenTrend,.tfOverviewCharts').count(),0);
 for(const width of [1320,480]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:join(output,`settings-charts-${width}.png`)});}
 await page.setViewportSize({width:1320,height:900});
 console.log(JSON.stringify({usageLayout:'passed',agentHeaderTotal:true,providerTotalOnly:true,persistentBreakdownTabs:true,stackedTokenComparison:true,channelDistribution:true,zeroBaselineTrend:true}));
}
