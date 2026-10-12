import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-local-repair-ui-'));
const output=resolve('output/playwright/product-p2');let app;
const calls=[];let holdNetwork=false;
const upstream=createServer(async(req,res)=>{
 if(req.method==='HEAD'&&holdNetwork){const timer=setTimeout(()=>res.end(),20000);res.on('close',()=>clearTimeout(timer));return;}
 let raw='';for await(const chunk of req)raw+=chunk;const input=raw?JSON.parse(raw):{};calls.push({key:req.headers.authorization,model:input.model});
 res.setHeader('content-type','application/json');
 if(req.url==='/v1/models'){res.end(JSON.stringify({data:[{id:'shared'},{id:'forbidden'}]}));return;}
 if(input.model==='forbidden'){res.writeHead(403);res.end(JSON.stringify({error:{message:'fixture-private-error'}}));return;}
 const response={id:'fixture-api-response',object:'response',status:'completed',model:input.model,usage:{input_tokens:7,output_tokens:3},output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text:'OK',annotations:[]}]}]};
 if(input.stream){res.setHeader('content-type','text/event-stream');res.end([{type:'response.created',response:{...response,status:'in_progress',output:[],usage:null}},{type:'response.output_item.added',output_index:0,item:{...response.output[0],status:'in_progress',content:[]}},{type:'response.content_part.added',output_index:0,content_index:0,part:{type:'output_text',text:''}},{type:'response.output_text.delta',output_index:0,content_index:0,delta:'OK'},{type:'response.output_item.done',output_index:0,item:response.output[0]},{type:'response.completed',response}].map(e=>`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''));}else res.end(JSON.stringify(response));
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${upstream.address().port}/v1`;
const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const port=allocator.address().port;await new Promise(r=>allocator.close(r));
try{
 await mkdir(output,{recursive:true});await mkdir(join(root,'cliproxy'));await mkdir(join(root,'claude'));await mkdir(join(root,'codex'));await mkdir(join(root,'bin'));
 // A fixture CLI is intentionally outside an npm-global package. Never inspect or upgrade the host CLI.
 const node=await realpath(process.execPath);await writeFile(join(root,'bin/codex'),`#!${node}\nconsole.log('codex-cli 1.0.0');\n`,{mode:0o755});
 const bootstrap=join(root,'bootstrap.cjs');
 await writeFile(bootstrap,`const cp=require('node:child_process');const os=require('node:os');os.homedir=()=>${JSON.stringify(root)};const original=cp.execFile;cp.execFile=function(file,args,...rest){if(file==='ps'){rest.at(-1)(null,'','');return {on(){},kill(){}};}return original.call(this,file,args,...rest);};cp.execFile[require('node:util').promisify.custom]=async(file,args,options)=>file==='ps'?{stdout:'',stderr:''}:require('node:util').promisify(original)(file,args,options);require('node:module').syncBuiltinESMExports();import(${JSON.stringify(new URL('../dist/main.js',import.meta.url).href)});`);
 const launch=()=>electron.launch({args:[bootstrap],env:{...process.env,PATH:`${join(root,'bin')}:${process.env.PATH}`,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
 app=await launch();let page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.locator('.agentCardGrid article').first().waitFor();
 const api=(path,body,method=body===undefined?'GET':'POST')=>page.evaluate(async({path,body,method})=>{const response=await fetch(path,{method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})});const data=await response.json();if(!response.ok)throw Error(JSON.stringify(data));return data;},{path,body,method});
 // waitForFunction treats an unresolved Promise as truthy; poll the resolved API value.
 const waitForAPI=async(path,predicate)=>{const deadline=Date.now()+30000;do{const value=await api(path);if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<deadline);throw Error(`Timed out waiting for ${path}`);};
 await waitForAPI('/api/local-agent',s=>s.state==='running');
 const source=await api('/api/sources',{name:'备用维修来源',baseURL,apiKey:'fixture-repair-only',protocol:'responses',models:['shared']});const model=`api-${source.id}/shared`;
 // Connect only after the saved source is confirmed in the running gateway's catalog.
 await waitForAPI('/api/local-agent',s=>s.state==='running'&&s.models.some(m=>m.id===model));
 const target=(await api('/api/a2a')).targets.find(t=>t.id==='codex');const connection=await api('/api/a2a/connect',{target:'codex',sourceId:source.id,model,revision:target.revision});
 await page.locator('.topActions').getByRole('button',{name:'维修师傅',exact:true}).click();let drawer=page.getByRole('dialog',{name:'维修师傅',exact:true});let tools=drawer.getByRole('region',{name:'本地诊断与升级'});
 await tools.getByRole('button',{name:'运行本地诊断',exact:true}).click();await waitForAPI('/api/maintenance/local',s=>s.runs[0]?.status==='completed');
 assert.equal((await api('/api/maintenance')).selection,undefined);assert.equal(calls.filter(c=>c.model).length,0);
 await tools.getByRole('button',{name:'检查 Codex 升级',exact:true}).click();await tools.getByRole('alert').filter({hasText:'无法确认匹配的 npm 全局安装来源'}).waitFor();assert.equal((await api('/api/maintenance/local')).plan,undefined);
 await api('/api/local-agent/stop',{});await tools.locator('.directRepairChoice > summary').click();await tools.getByRole('combobox',{name:'备用 API 模型',exact:true}).selectOption(model);await tools.getByRole('button',{name:'使用此备用模型',exact:true}).click();await waitForAPI('/api/maintenance',s=>s.readiness.status==='ready');
 await drawer.getByRole('button',{name:'开始维修',exact:true}).click();await waitForAPI('/api/maintenance',s=>s.status==='completed');assert.equal((await api('/api/local-agent')).state,'stopped');assert.equal(calls.filter(c=>c.model).length,2);
 // Hold a credential-free HEAD to exercise cancellation and hide/reopen behavior.
 holdNetwork=true;await tools.getByRole('combobox',{name:'可选网络检查',exact:true}).selectOption(source.id);await tools.getByRole('button',{name:'运行本地诊断',exact:true}).click();await waitForAPI('/api/maintenance/local',s=>s.runs[0]?.steps.some(t=>t.name==='installation')&&!!s.active);
 await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();assert.ok((await api('/api/maintenance/local')).active);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'活动',exact:true}).click();await page.getByRole('tab',{name:'维修会话',exact:true}).click();await page.getByRole('button',{name:'打开维修师傅',exact:true}).click();
 drawer=page.getByRole('dialog',{name:'维修师傅',exact:true});tools=drawer.getByRole('region',{name:'本地诊断与升级'});await tools.getByRole('button',{name:'停止本地任务',exact:true}).click();await waitForAPI('/api/maintenance/local',s=>s.runs[0]?.status==='stopped');holdNetwork=false;
 // Existing offline recovery preserves original bytes without a maintenance model.
 const current=(await api('/api/a2a')).targets.find(t=>t.id==='codex');await api('/api/a2a/restore',{id:connection.id,revision:current.revision,allowRunning:false});assert.equal((await api('/api/a2a')).targets.find(t=>t.id==='codex').connection,null);
 for(const width of [390,768,1320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('.repairDrawer').scrollWidth>document.querySelector('.repairDrawer').clientWidth+1),false,`repair drawer overflow ${width}`);await page.screenshot({path:join(output,`repair-${width}.png`)});}
 assert.equal((await readFile(join(root,'local-maintenance.json'),'utf8')).includes('fixture-repair-only'),false);
 await app.close();app=await launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.agentCardGrid article').first().waitFor();const restored=await api('/api/maintenance/local');assert.equal(restored.runs.length,2);assert.equal(restored.runs[0].status,'stopped');assert.equal((await api('/api/maintenance')).selection.channel,'direct');assert.deepEqual(errors,[]);
 console.log(JSON.stringify({productP2:'passed',cases:'model-free diagnosis, offline bounded fallback, unsupported installation refusal, hide/reopen and stop, offline restore, persisted facts, responsive drawer',screenshots:output}));
}catch(error){if(app){const page=app.windows()[0];await page?.screenshot({path:join(output,'failure.png')});console.error((await page?.locator('body').innerText())?.slice(-4000));}throw error;}
finally{await app?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(root,{recursive:true,force:true});}
