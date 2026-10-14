import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function verifyOtherDetailReturns({page,api,models,source,output}){
 const nav=page.getByRole('navigation',{name:'主导航'});
 const main=page.locator('.tfMain');
 const location=()=>page.evaluate(()=>({root:document.scrollingElement.scrollTop,side:document.querySelector('.tfSide').getBoundingClientRect().y,main:document.querySelector('.tfMain').scrollTop}));
 const ranks=()=>page.evaluate(()=>({models:localStorage.getItem('token-flow.sort.models.manual'),keys:localStorage.getItem('token-flow.sort.keys.manual')}));
 const results=[];
 // Sparse catalogues must pack rows at the top rather than distribute them in a fixed-height grid.
 for(const width of [1320,1024,480]){
  await page.setViewportSize({width,height:800});await nav.getByRole('button',{name:'账号授权',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
  const rows=page.locator('.tfAccountModels li');await rows.nth(15).waitFor();
  const orderedNames=await rows.locator('strong').allTextContents();
  await page.route('**/api/local-agent',async route=>{const response=await route.fetch();const data=await response.json();data.accounts=data.accounts.map(account=>account.provider==='codex'?{...account,models:(account.models??[]).slice(0,3)}:account);await route.fulfill({json:data});});
  await page.waitForFunction(()=>document.querySelectorAll('.tfAccountModels li').length===3);
  const list=page.locator('.tfAccountModels ul'),boxes=await rows.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,height:r.height,bottom:r.bottom};}));
  assert.equal(boxes[0].height,56);const nextRow=boxes.find(box=>box.y>boxes[0].y+1);assert.ok(nextRow);assert.ok(Math.abs(nextRow.y-boxes[0].bottom-8)<1,'model rows must have an 8px gap');
  const listBox=await list.boundingBox();assert.ok(listBox.height<=196,'three models must not reserve a 520px panel');assert.ok(Math.abs(boxes[0].y-listBox.y-2)<1,'model rows start at the top');
  assert.deepEqual(await rows.locator('strong').allTextContents(),orderedNames.slice(0,3),'compacting must retain the original model order');
  await page.screenshot({path:join(output,`account-compact-${width}.png`)});await page.unroute('**/api/local-agent');await rows.nth(15).waitFor();
  const denseHeight=await list.evaluate(n=>n.clientHeight);assert.ok(denseHeight<=520);if(width<1100)assert.ok(await list.evaluate(n=>n.scrollHeight>n.clientHeight),'large catalogues retain internal scrolling');
 }

 const modal=async(name,opener,{escape=false,drag=false,outside=false,setup}={})=>{
  await opener.scrollIntoViewIfNeeded();const before=await location(),oldRanks=await ranks();
  const outer=page.locator('dialog[open]').last();const outerScroll=await outer.count()?await outer.evaluate(n=>n.scrollTop):null;
  await opener.click();const dialog=page.getByRole('dialog',{name,exact:true});await dialog.waitFor();
  if(setup)await setup(dialog);
  if(name.startsWith('重启 ')){const box=await dialog.boundingBox();assert.ok(box.width<=440&&box.height<400&&box.y>0,'restart must be a compact popup');}
  if(drag){
   await dialog.getByRole('searchbox').fill(source.name);
   const rows=dialog.locator('.tfPickSource .tfPickDraggableRow');await rows.first().waitFor();
   const first=await rows.first().locator('.tfPickModel strong').innerText(),last=await rows.nth(2).locator('.tfPickModel strong').innerText();
   const firstRow=rows.filter({has:page.getByText(first,{exact:true})}),lastRow=rows.filter({has:page.getByText(last,{exact:true})});
   await lastRow.getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(firstRow);
   if(await dialog.locator('.tfAgentPickerSources').count())assert.equal(await page.evaluate(()=>localStorage.getItem('token-flow.sort.models')),'manual');else assert.equal(await dialog.getByRole('combobox',{name:'模型排序',exact:true}).inputValue(),'manual');
   assert.equal(await rows.first().locator('.tfPickModel strong').innerText(),last);assert.notEqual(first,last);
  }
  const savedRanks=await ranks();
  const scroller=await dialog.locator('.tfPickBody').count()?dialog.locator('.tfPickBody'):dialog;
  await scroller.hover();await page.mouse.wheel(0,2000);await page.waitForTimeout(100);
  assert.deepEqual(await location(),before,`${name}: foreground scrolling must not move the original list or sidebar`);
  if(escape)await page.keyboard.press('Escape');else if(outside){const box=await dialog.boundingBox();assert.ok(box.x>20);await page.mouse.click(box.x-12,box.y+100);}else await dialog.getByRole('button',{name:'关闭',exact:true}).first().click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(await location(),before,`${name}: returning must preserve the original list position`);
  assert.deepEqual(await ranks(),drag?savedRanks:oldRanks,`${name}: returning must preserve drag ordering`);
  if(outerScroll!==null)assert.equal(await outer.evaluate(n=>n.scrollTop),outerScroll,`${name}: returning must preserve the outer detail position`);
  assert.equal(await opener.evaluate(n=>document.activeElement===n),true,`${name}: focus must return to the original control`);
  results.push({name,close:escape?'Escape':'button',drag});
  console.log(JSON.stringify({detailReturnChecked:name,escape,drag}));
 };
 for(const width of [1024,480]){
  await page.setViewportSize({width,height:800});
  await nav.getByRole('button',{name:'CLI 代理',exact:true}).click();
  const cards=page.locator('.tfKeyCard');
  await page.getByRole('combobox',{name:'Key 排序',exact:true}).selectOption('name');
  await cards.last().getByRole('button',{name:'调整 Key 顺序',exact:true}).dragTo(cards.first());
  const keyOrder=await cards.locator('h3').allTextContents(),keyRanks=await ranks();
  await page.getByRole('button',{name:'创建 Key',exact:true}).click();
  const create=page.getByRole('form',{name:'创建 API Key',exact:true});
  await modal('选择导出模型',create.getByRole('button',{name:'选择导出模型（0）',exact:true}),{drag:width>=700,escape:true});
  await create.getByRole('button',{name:'取消',exact:true}).click();
  assert.deepEqual(await cards.locator('h3').allTextContents(),keyOrder);assert.equal((await ranks()).keys,keyRanks.keys);

  const key=(await api('/api/gateway-keys')).keys.find(k=>k.name==='Key 8');
  const record={id:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000002',keyId:key.id,agent:'fixture-agent',target:'key',sourceId:source.id,model:models[0],protocol:'chat',startedAt:new Date().toISOString(),durationMs:1200,status:200,inputTokens:100,cachedTokens:20,cacheWriteTokens:0,outputTokens:10,reasoningTokens:0,inputs:{system:1,user:1,assistant:0,tool:1},tools:[],results:[{id:'result-1',name:'read_file',status:'returned',result:Array.from({length:200},(_,i)=>`Fixture tool result ${i}`).join('\n')}]};
  await page.route('**/api/gateway/traces**',route=>{const detail=new URL(route.request().url()).pathname.endsWith(record.id);return route.fulfill({json:detail?{record}:{records:[{...record,toolCalls:0,toolResults:1,toolNames:['read_file']}]}});});
  await page.getByRole('article',{name:'Key 8',exact:true}).getByRole('button',{name:'查看 Key 8',exact:true}).click();
  const keyDetail=page.getByRole('dialog',{name:'Key 详情 · Key 8',exact:true});await keyDetail.getByRole('tab',{name:'使用情况',exact:true}).click();
  const traceButton=keyDetail.locator('.tfTraceList button').first();await traceButton.waitFor();
  await modal('调用轨迹详情',traceButton,{setup:async dialog=>{await dialog.locator('.tfTraceTool summary').click();await dialog.locator('.tfTraceTool pre').hover();await page.mouse.wheel(0,1500);}});
  await keyDetail.getByRole('button',{name:'关闭',exact:true}).click();assert.deepEqual(await cards.locator('h3').allTextContents(),keyOrder);assert.equal((await ranks()).keys,keyRanks.keys);
  await page.unroute('**/api/gateway/traces**');

  await nav.getByRole('button',{name:'本地 Agent',exact:true}).click();
  await page.getByRole('tab',{name:/^Codex/}).click();
  const agent=page.getByRole('region',{name:'Codex',exact:true});
  const state=await api('/api/a2a');
  if(!state.targets.find(t=>t.id==='codex').connection){
   await api('/api/a2a/connect',{target:'codex',sourceId:source.id,model:models[0],selections:models.map(model=>({sourceId:source.id,model})),revision:state.targets.find(t=>t.id==='codex').revision});
   await page.reload();await nav.getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
  }
  await agent.getByRole('button',{name:'管理所选模型',exact:true}).waitFor();
  await modal('Codex 使用的模型',agent.getByRole('button',{name:'管理所选模型',exact:true}),{drag:width>=700,outside:width>=700});
  await modal('Codex 使用的模型',agent.getByRole('button',{name:'管理所选模型',exact:true}),{escape:true});
  const lines=agent.locator('ul.tfLines').last().locator(':scope > li');
  const agentOrder=await lines.locator('.tfRowText strong').allTextContents();
  const detailButton=lines.last().getByRole('button',{name:'详情',exact:true});await detailButton.scrollIntoViewIfNeeded();const agentBefore=await location();
  await detailButton.click();await main.hover();await page.mouse.wheel(0,200);await lines.last().getByRole('button',{name:'收起',exact:true}).click();
  assert.deepEqual(await location(),agentBefore,'Agent inline details: returning must preserve the list position');assert.deepEqual(await lines.locator('.tfRowText strong').allTextContents(),agentOrder);
  await modal('重启 Codex',agent.getByRole('button',{name:'重启…',exact:true}),{escape:true});
  await page.route('**/api/a2a',async route=>{const response=await route.fetch();const data=await response.json();data.targets=data.targets.map(t=>t.id==='codex'?{...t,installation:{...t.installation,installed:false,automatic:false}}:t);await route.fulfill({json:data});});
  await agent.getByRole('button',{name:'安装 Codex',exact:true}).waitFor();
  await modal('安装 Codex',agent.getByRole('button',{name:'安装 Codex',exact:true}));
  await page.unroute('**/api/a2a');

  await nav.getByRole('button',{name:'API 接口',exact:true}).click();
  const apiCard=page.getByRole('article',{name:source.name,exact:true});
  assert.equal(await apiCard.getByRole('button',{name:/支持模型/}).count(),0,'model copies live on the credential face');
  await apiCard.getByRole('button',{name:`翻面查看 ${source.name} 凭证`,exact:true}).click({position:{x:8,y:8}});
  const apiRows=apiCard.locator('.tfCredentialModels li');assert.equal(await apiRows.count(),16);
  const apiOrder=await apiRows.locator('code').allTextContents();
  await apiCard.getByRole('button',{name:`返回 ${source.name} 卡片正面`,exact:true}).click({position:{x:8,y:8}});
  const edit=apiCard.getByRole('button',{name:'编辑',exact:true});await edit.scrollIntoViewIfNeeded();const apiBefore=await location();
  await edit.click();const editor=page.locator('.tfApiEditor');await editor.waitFor();await editor.hover();await page.mouse.wheel(0,1200);
  await editor.getByRole('button',{name:'取消',exact:true}).click();await editor.waitFor({state:'hidden'});
  assert.deepEqual(await location(),apiBefore,'API editor: returning preserves the card position');
  await apiCard.getByRole('button',{name:`翻面查看 ${source.name} 凭证`,exact:true}).click({position:{x:8,y:8}});assert.deepEqual(await apiRows.locator('code').allTextContents(),apiOrder);
  await apiCard.getByRole('button',{name:`返回 ${source.name} 卡片正面`,exact:true}).click({position:{x:8,y:8}});

  await nav.getByRole('button',{name:'账号授权',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
  const account=page.locator('.tfAccountDetail');assert.equal(await account.getByRole('button',{name:/查看模型/}).count(),0);const accountRows=account.locator('.tfAccountModels li');assert.equal(await accountRows.count(),16);const quotaSide=account.getByRole('region',{name:'账号额度',exact:true}),modelSide=account.getByRole('region',{name:'账号模型',exact:true});if(width>=950){const modelWidth=(await modelSide.boundingBox()).width;assert.ok(modelWidth>(await quotaSide.boundingBox()).width);await quotaSide.hover();await page.waitForTimeout(220);assert.equal((await modelSide.boundingBox()).width,modelWidth);await modelSide.hover();await page.waitForTimeout(220);}
  if(width>=700)await accountRows.nth(2).getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(accountRows.first());
  const accountOrder=await accountRows.locator('strong').allTextContents(),accountRanks=await ranks();const modelList=account.locator('.tfAccountModels ul');await modelList.evaluate(n=>n.scrollTop=120);const mainBefore=await location(),scrollBefore=await modelList.evaluate(n=>n.scrollTop);if(width>=950)for(let i=0;i<3;i++){await quotaSide.hover();await page.waitForTimeout(220);await modelSide.hover();await page.waitForTimeout(220);}assert.deepEqual(await location(),mainBefore);assert.equal(await modelList.evaluate(n=>n.scrollTop),scrollBefore);if(width>=950){const columns=account.locator('.tfAccountColumns'),box=await columns.boundingBox();const classBefore=await columns.getAttribute('class');await page.mouse.move(box.x+box.width*.5,box.y+50);await page.waitForTimeout(400);assert.equal(await columns.getAttribute('class'),classBefore);assert.equal(await modelList.evaluate(n=>n.scrollTop),scrollBefore);}await page.screenshot({path:join(output,`account-catalog-${width}.png`)});assert.equal(await account.getByRole('searchbox').count(),0);assert.equal(await account.getByRole('combobox',{name:'模型排序',exact:true}).count(),0);assert.deepEqual(await accountRows.locator('strong').allTextContents(),accountOrder);assert.deepEqual(await ranks(),accountRanks);assert.equal((await location()).root,0);assert.equal((await location()).side,0);

  await page.getByRole('button',{name:'打开维修师傅',exact:true}).click();const repair=page.getByRole('region',{name:'维修师傅',exact:true});
  // Compact repair menu keeps the underlying page and model order untouched.
  let repairState={status:'idle',messages:[],readiness:{status:'ready'}};
  await page.route('**/api/maintenance',async route=>{if(route.request().method()==='PUT'){repairState={...repairState,selection:route.request().postDataJSON()};}await route.fulfill({json:repairState});});
  let issuePrompt='';await page.route('**/api/maintenance/run',async route=>{issuePrompt=route.request().postDataJSON().prompt;repairState={...repairState,status:'completed',messages:[{role:'user',text:issuePrompt}]};await route.fulfill({json:repairState});});
  const repairBefore=await location(),repairRanks=await ranks(),modelTrigger=repair.locator('.tfModelChip');
  await modelTrigger.click();const repairMenu=page.getByRole('dialog',{name:'维修模型',exact:true});await repairMenu.waitFor();
  const triggerBox=await modelTrigger.boundingBox(),menuBox=await repairMenu.boundingBox();assert.ok(menuBox.width<=320);assert.ok(Math.abs(menuBox.y-triggerBox.y-triggerBox.height-8)<2);assert.ok(menuBox.x>=0&&menuBox.x+menuBox.width<=width);assert.equal(await page.locator('dialog[open]').count(),0);
  await page.screenshot({path:join(output,`repair-model-menu-${width}.png`)});await repairMenu.getByRole('searchbox').fill(source.name);await repairMenu.getByRole('button',{name:'model-1',exact:true}).waitFor();await repairMenu.locator('.tfRepairModelOptions').hover();await page.mouse.wheel(0,1000);await page.waitForTimeout(150);assert.deepEqual(await location(),repairBefore);assert.deepEqual(await ranks(),repairRanks);
  await page.keyboard.press('Escape');await repairMenu.waitFor({state:'hidden'});assert.equal(await repair.isVisible(),true);assert.equal(await modelTrigger.evaluate(n=>document.activeElement===n),true);
  await modelTrigger.click();await repairMenu.getByRole('searchbox').fill(source.name);await repairMenu.getByRole('button',{name:'model-1',exact:true}).click();await repairMenu.waitFor({state:'hidden'});assert.equal(repairState.selection.sourceId,source.id);assert.equal(repairState.selection.model,models[0]);
  await repair.getByRole('button',{name:'Codex 自动重连 1/5',exact:true}).click();assert.match(issuePrompt,/Reconnecting 1\/5/);
  await modelTrigger.click();await repair.getByRole('textbox').click();await repairMenu.waitFor({state:'hidden'});assert.equal(await repair.isVisible(),true);
  // Opening a child dialog does not collapse its parent chat.

  assert.equal(await repair.getByRole('button',{name:'修改 Agent 配置',exact:true}).count(),0);
  const repairTarget=repair.getByRole('combobox',{name:'维修目标 Agent',exact:true});await repairTarget.selectOption('pi');assert.equal(await repairTarget.inputValue(),'pi');
  await repair.getByRole('button',{name:'收起',exact:true}).click();await page.getByRole('button',{name:'打开维修师傅',exact:true}).click();assert.equal(await repairTarget.inputValue(),'pi');
  await repair.getByRole('button',{name:'收起',exact:true}).click();await page.unroute('**/api/maintenance');await page.unroute('**/api/maintenance/run');

  await page.screenshot({path:join(output,`other-pages-${width}.png`)});
 }
 console.log(JSON.stringify({otherDetailReturns:'passed',checked:results,credentialModels:true,listPositionsAndDragOrderPreserved:true}));
}
