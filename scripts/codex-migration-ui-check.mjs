import assert from 'node:assert/strict';
export async function verifyCodexMigrationUI(page){
 let attempts=0,connection=null,releaseFailure;
 const failureReady=new Promise(resolve=>{releaseFailure=resolve;});
 await page.route('**/api/a2a/codex-migration',route=>route.fulfill({json:{backups:1,remaining:2,restorable:2,phase:'backup',done:1,total:2}}));
 const state=await page.evaluate(()=>fetch('/api/a2a').then(r=>r.json()));const template=state.targets.find(t=>t.id==='claude').connection;
 await page.route('**/api/a2a',async route=>{const response=await route.fetch();const data=await response.json();data.targets=data.targets.map(target=>target.id==='codex'?{...target,installation:{...target.installation,installed:true},restartSupported:true,connection,threadMigration:{backups:connection?1:0,remaining:0,restorable:connection?1:0,phase:'idle',done:0,total:0}}:target);await route.fulfill({json:data});});
 await page.route('**/api/a2a/connect',async route=>{attempts++;assert.equal(route.request().postDataJSON().restartCodex,true);if(attempts===1){await failureReady;return route.fulfill({status:409,json:{code:'codex_migration_failed',error:'迁移测试失败，备份保留。'}});}const input=route.request().postDataJSON();connection={...template,...input,target:'codex'};return route.fulfill({json:connection});});
 await page.reload();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'本地 Agent',exact:true}).click();await page.getByRole('tab',{name:/^Codex/}).click();
 const panel=page.getByRole('region',{name:'Codex',exact:true});await panel.getByRole('button',{name:'选择模型',exact:true}).click();
 const picker=page.getByRole('dialog',{name:'Codex 使用的模型',exact:true});await picker.getByRole('tab',{name:/personal@example.test/}).click();await picker.getByRole('button',{name:'codex/model-1',exact:true}).click();await picker.getByRole('button',{name:'应用所选模型',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'重启 Codex 并应用更改',exact:true});await dialog.waitFor();await dialog.getByText(/切换后的首次回复可能较慢/).waitFor();await dialog.getByText(/已有备份会保留/).waitFor();assert.equal(attempts,0);const box=await dialog.boundingBox();assert.ok(box.width<600&&box.height<500);assert.equal(await panel.getByRole('button',{name:'还原旧对话',exact:true}).count(),0);
 await dialog.getByRole('button',{name:'确认并自动重启',exact:true}).click();
 await dialog.getByRole('status').filter({hasText:'正在备份旧对话 1 / 2'}).waitFor();
 assert.equal(await dialog.getByRole('button',{name:'正在处理…',exact:true}).isDisabled(),true);
 releaseFailure();
 await dialog.waitFor({state:'hidden'});
 await panel.getByRole('button',{name:'重启…',exact:true}).click();
 const restart=page.getByRole('dialog',{name:'重启 Codex',exact:true});await restart.waitFor();await restart.getByRole('button',{name:'稍后再说',exact:true}).click();
 await panel.getByRole('switch',{name:'启用网关模型',exact:true}).click();
 await dialog.waitFor();assert.equal(attempts,1);await dialog.getByRole('button',{name:'确认并自动重启',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(attempts,2);assert.equal(connection.model,'codex/model-1');await panel.getByRole('button',{name:'还原旧对话',exact:true}).waitFor();
 assert.equal(await page.locator('dialog[open]').count(),0);
 await page.unroute('**/api/a2a/codex-migration');await page.unroute('**/api/a2a');await page.unroute('**/api/a2a/connect');console.log(JSON.stringify({migrationUI:'passed',singleRestartConfirmation:true,retryPreservesSelection:true,restoreEntry:true,compactDialog:true,visibleBackupProgress:true,firstReplyHint:true,restartAccessibleAfterFailure:true}));
}
