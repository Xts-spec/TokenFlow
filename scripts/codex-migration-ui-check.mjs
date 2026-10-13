import assert from 'node:assert/strict';
export async function verifyCodexMigrationUI(page){
 let attempts=0,connection=null;
 const state=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));const template=state.targets.find(t=>t.id==='claude').connection;
 await page.route('**/api/a2a',async route=>{const response=await route.fetch();const data=await response.json();data.targets=data.targets.map(target=>target.id==='codex'?{...target,installation:{...target.installation,installed:true},restartSupported:true,connection,threadMigration:{backups:connection?1:0,remaining:0,restorable:connection?1:0,phase:'idle',done:0,total:0}}:target);await route.fulfill({json:data});});
 await page.route('**/api/a2a/connect',async route=>{attempts++;if(attempts===1)return route.fulfill({status:409,json:{code:'codex_exit_required',error:'请先保存工作并完全退出 Codex，再继续迁移旧对话。'}});const input=route.request().postDataJSON();connection={...template,...input,target:'codex'};return route.fulfill({json:connection});});
 await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
 const panel=page.getByRole('region',{name:'Codex',exact:true});await panel.getByRole('button',{name:'选择模型',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'Codex 使用的模型',exact:true});await picker.getByRole('tab',{name:/personal@example.test/}).click();await picker.getByRole('button',{name:'codex/model-1',exact:true}).click();await picker.getByRole('button',{name:'应用所选模型',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'先退出 Codex，保留旧对话',exact:true});await dialog.waitFor();assert.equal(attempts,1);const box=await dialog.boundingBox();assert.ok(box.width<600&&box.height<500);assert.equal(await panel.getByRole('button',{name:'还原旧对话',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'已退出，继续',exact:true}).click();await page.getByRole('dialog',{name:'配置已保存，现在生效？',exact:true}).waitFor();assert.equal(attempts,2);assert.equal(connection.model,'codex/model-1');await panel.getByRole('button',{name:'还原旧对话',exact:true}).waitFor();
 await page.getByRole('button',{name:'稍后再说',exact:true}).click();assert.equal(await page.locator('dialog[open]').count(),0);
 await page.unroute('**/api/a2a');await page.unroute('**/api/a2a/connect');console.log(JSON.stringify({migrationUI:'passed',exitRequiredDialog:true,retryPreservesSelection:true,restoreEntry:true,compactDialog:true}));
}
