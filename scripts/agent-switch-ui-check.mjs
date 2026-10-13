import assert from 'node:assert/strict';

// All writes are staged in an isolated profile; application configs are never touched.
export async function verifyAgentSwitching({page}){
 const state=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));
 const template=state.targets.find(t=>t.id==='pi').connection;
 const local=await page.evaluate(()=>fetch('/api/local-agent').then(r=>r.json()));
 const models=local.models.filter(m=>m.id.startsWith(`api-${template.sourceId}/`)).map(m=>m.id).slice(0,4);
 assert.equal(models.length,4);
 const ids=['codex','deepseek','claude','pi'];let writes=0;
 await page.route('**/api/a2a',async route=>{const response=await route.fetch();const data=await response.json();data.targets=data.targets.map(t=>ids.includes(t.id)?{...t,restartSupported:true,installation:{...t.installation,installed:true},configurationState:'configured',connection:{...template,target:t.id,model:models[0],selections:models.map(model=>({sourceId:template.sourceId,model}))}}:t);await route.fulfill({json:data});});
 for(const endpoint of ['connect','restore','restart'])await page.route(`**/api/a2a/${endpoint}`,async route=>{writes++;await route.fulfill({status:409,json:{error:'Unexpected write during draft-layout check'}});});
 try{
  await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'本地 Agent',exact:true}).click();
  for(const width of [1320,480]){
   await page.setViewportSize({width,height:900});
   for(const id of ids){
    await page.evaluate(id=>{localStorage.removeItem(`token-flow.agent.models.${id}`);localStorage.removeItem(`token-flow.agent.models.pending.${id}`);},id);
    const names={codex:'Codex',deepseek:'DeepSeek Harness',claude:'Claude Code',pi:'Pi Agent'};
    const choose=async target=>{await page.getByRole('tab',{name:new RegExp(`^${names[target]}`)}).click();};
    // Remount after clearing the draft, then exercise switching away and back after each edit.
    await choose(id==='codex'?'deepseek':'codex');await choose(id);
    const panel=page.getByRole('region',{name:names[id],exact:true}),cards=panel.locator('.tfGatewaySection .tfLines > li');await cards.nth(3).waitFor();
    const before=await cards.locator('strong').allTextContents();await cards.last().getByRole('button',{name:'调整模型顺序',exact:true}).focus();await page.keyboard.press('ArrowUp');
    const dragged=await cards.locator('strong').allTextContents();assert.notDeepEqual(dragged,before);
    await choose(id==='codex'?'deepseek':'codex');await choose(id);assert.deepEqual(await cards.locator('strong').allTextContents(),dragged);
    const first=cards.first();await first.getByRole('button',{name:'详情',exact:true}).click();await first.getByRole('button',{name:'移除',exact:true}).click();assert.equal(await cards.count(),3);assert.equal(await panel.locator('.tfUsage').count(),0,'removing an expanded card clears its detail');
    const remaining=await cards.locator('strong').allTextContents();await choose(id==='codex'?'deepseek':'codex');await choose(id);assert.deepEqual(await cards.locator('strong').allTextContents(),remaining);
    const columns=panel.locator('.tfAgentColumns'),original=(await columns.boundingBox()).height;await cards.last().getByRole('button',{name:'详情',exact:true}).click();await cards.last().getByRole('button',{name:'收起',exact:true}).click();assert.equal((await columns.boundingBox()).height,original);
    const boxes=await cards.evaluateAll(nodes=>nodes.map(n=>{const b=n.getBoundingClientRect();const actions=[...n.querySelectorAll('.tfActions button')].map(x=>x.getBoundingClientRect());return {top:b.top,bottom:b.bottom,height:b.height,actionGap:actions[1].left-actions[0].right};}));
    assert.ok(boxes.every(b=>b.height<110&&b.actionGap>=12));for(let i=1;i<boxes.length;i++)assert.ok(Math.abs(boxes[i].top-boxes[i-1].bottom-8)<1);
    assert.equal(await page.locator('dialog[open]').count(),0);if(id==='claude'||id==='pi')assert.equal(await panel.getByRole('button',{name:/^重启/}).count(),0);
   }
  }
  assert.equal(writes,0);console.log(JSON.stringify({agentSwitching:'passed',targets:ids,desktopAndNarrow:true,draftOrderRetained:true,removeExpandedCard:true,collapseClearsSpace:true,noConfigWritesDuringDragOrRemove:true}));
 }finally{
  await page.unroute('**/api/a2a');for(const endpoint of ['connect','restore','restart'])await page.unroute(`**/api/a2a/${endpoint}`);
  await page.evaluate(ids=>{for(const id of ids){localStorage.removeItem(`token-flow.agent.models.${id}`);localStorage.removeItem(`token-flow.agent.models.pending.${id}`);}},ids);
 }
}
