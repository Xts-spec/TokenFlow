import assert from 'node:assert/strict';
import {join} from 'node:path';

export async function verifyManualOrdering({page,api,source,created,output}){
 const before=(await api('/api/gateway-keys')).keys.find(key=>key.id===created.key.id);
 const extra=await api('/api/gateway-keys',{name:'A Drag Key',purpose:'Manual sorting fixture',enabled:false,models:before.models,sourceId:source.id,agents:['openai'],tokenLimit:null});
 const nav=page.getByRole('navigation',{name:'主导航'});
 const proxy=async()=>{await nav.getByRole('button',{name:'API 代理',exact:true}).click();};
 await proxy();await page.setViewportSize({width:1320,height:900});await page.reload();await proxy();
 const card=page.getByRole('article',{name:'Z Key',exact:true}),other=page.getByRole('article',{name:'A Drag Key',exact:true});
 await page.getByRole('combobox',{name:'Key 排序',exact:true}).selectOption('name');
 assert.equal(await page.locator('.tfKeyCard h3').first().innerText(),'A Drag Key');
 await card.getByRole('button',{name:'调整 Key 顺序',exact:true}).dragTo(other);
 assert.equal(await page.getByRole('combobox',{name:'Key 排序',exact:true}).inputValue(),'manual');
 assert.equal(await page.locator('.tfKeyCard h3').first().innerText(),'Z Key');
 await card.getByRole('button',{name:'\u8c03\u6574 Key \u987a\u5e8f',exact:true}).dragTo(other);assert.equal(await page.locator('.tfKeyCard h3').first().innerText(),'A Drag Key');await card.getByRole('button',{name:'\u8c03\u6574 Key \u987a\u5e8f',exact:true}).dragTo(other);assert.equal(await page.locator('.tfKeyCard h3').first().innerText(),'Z Key');
 await page.reload();await proxy();
 assert.equal(await page.getByRole('combobox',{name:'Key 排序',exact:true}).inputValue(),'manual');
 assert.equal(await page.locator('.tfKeyCard h3').first().innerText(),'Z Key');

 const details=page.getByRole('dialog',{name:'Key 详情 · Z Key',exact:true});
 const openModels=async()=>{await card.getByRole('button',{name:'查看 Z Key',exact:true}).click();await details.getByRole('tab',{name:'接入信息',exact:true}).click();};
 await openModels();await details.getByRole('combobox',{name:'模型排序',exact:true}).selectOption('name');
 const row=name=>details.locator('.tfKeyModels li').filter({has:page.getByText(name,{exact:true})});
 await row('tool-model').getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(row('aaa-model'));
 assert.deepEqual(await details.locator('.tfKeyModels strong').allTextContents(),['tool-model','aaa-model','model-2','model-10']);
 assert.equal(await details.getByRole('combobox',{name:'模型排序',exact:true}).inputValue(),'manual');
 await row('tool-model').getByRole('button',{name:'调整模型顺序',exact:true}).focus();await page.keyboard.press('ArrowDown');
 assert.deepEqual(await details.locator('.tfKeyModels strong').allTextContents(),['aaa-model','tool-model','model-2','model-10']);
 await page.reload();await proxy();await openModels();
 assert.equal(await details.getByRole('combobox',{name:'模型排序',exact:true}).inputValue(),'manual');
 assert.deepEqual(await details.locator('.tfKeyModels strong').allTextContents(),['aaa-model','tool-model','model-2','model-10']);

 await details.getByRole('button',{name:'管理模型',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'管理 Key 支持的模型',exact:true});
 await picker.getByRole('searchbox').fill('model-');
 const group=picker.locator('.tfPickSource').first();
 const filtered=name=>group.locator('.tfPickDraggableRow').filter({has:page.getByRole('button',{name,exact:true})});
 await filtered('model-10').getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(filtered('model-2'));
 await picker.getByRole('searchbox').fill('轨迹测试 API');
 assert.deepEqual(await group.locator('.tfPickModel strong').allTextContents(),['aaa-model','tool-model','model-10','model-2']);
 await picker.getByRole('button',{name:'取消',exact:true}).click();
 assert.deepEqual(await details.locator('.tfKeyModels strong').allTextContents(),['aaa-model','tool-model','model-10','model-2']);
 const after=(await api('/api/gateway-keys')).keys.find(key=>key.id===created.key.id);
 assert.deepEqual(after.models,before.models);assert.deepEqual(after.modelSources,before.modelSources);assert.equal(after.enabled,before.enabled);
 await page.screenshot({path:join(output,'manual-model-order.png')});
 await details.getByRole('button',{name:'关闭',exact:true}).click();
 assert.deepEqual(await card.locator('.tfKeyPreview li').allTextContents(),['aaa-model','tool-model','model-10']);
 await page.screenshot({path:join(output,'manual-key-order.png')});

 await nav.getByRole('button',{name:'API 接口',exact:true}).click();
 const apiCard=page.getByRole('article',{name:'轨迹测试 API',exact:true});await apiCard.getByRole('button',{name:'支持模型（4）',exact:true}).click();
 assert.deepEqual(await apiCard.locator('.tfApiSourceModels li code').allTextContents(),['aaa-model','tool-model','model-10','model-2']);
 const apiRow=name=>apiCard.locator('.tfApiSourceModels li').filter({has:page.getByText(name,{exact:true})});
 await apiRow('model-2').getByRole('button',{name:'调整模型顺序',exact:true}).dragTo(apiRow('aaa-model'));
 assert.deepEqual(await apiCard.locator('.tfApiSourceModels li code').allTextContents(),['model-2','aaa-model','tool-model','model-10']);

 await nav.getByRole('button',{name:'账号授权',exact:true}).click();
 const head=page.locator('.tfProviderHead');await head.locator('.tfUsageFoldHead').waitFor();
 assert.equal(await head.locator('h2').count(),0);assert.equal(await head.getByText('使用 ChatGPT / OpenAI 账号授权',{exact:true}).count(),0);
 assert.equal(await head.locator('.tfUsageFoldHead .uiIcon').count(),1);
 assert.equal(await head.locator('.tfUsageFoldHead').getByText('Codex 用量',{exact:true}).count(),0);
 await head.locator('.tfUsageFoldHead').click();await page.getByRole('dialog',{name:'Codex 用量',exact:true}).getByText('140 tok',{exact:true}).waitFor();await page.getByRole('button',{name:'关闭用量',exact:true}).click();
 await page.screenshot({path:join(output,'compact-account-header.png')});
 await page.evaluate(async id=>{const response=await fetch(`/api/gateway-keys/${id}`,{method:'DELETE'});if(!response.ok)throw Error('Fixture cleanup failed');},extra.key.id);
 console.log(JSON.stringify({manualKeyDrag:true,manualModelDrag:true,keyboardMovement:true,filteredOrderPreserved:true,modelOrderSharedWithAPI:true,manualReload:true,permissionsUnchanged:true,compactAccountUsage:true}));
}
