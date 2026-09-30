import { _electron as electron } from 'playwright';
import { mkdtemp, mkdir, writeFile, readFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';

const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-api-ui-'));
const output=resolve('artifacts/product-p1');let app;
const calls=[];
const upstream=createServer(async(req,res)=>{
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
 await mkdir(output,{recursive:true});await mkdir(join(root,'cliproxy'));await mkdir(join(root,'claude'));await mkdir(join(root,'codex'));
 const bootstrap=join(root,'bootstrap.cjs');
 await writeFile(bootstrap,`const cp=require('node:child_process');const os=require('node:os');os.homedir=()=>${JSON.stringify(root)};const original=cp.execFile;cp.execFile=function(file,args,...rest){if(file==='ps'){rest.at(-1)(null,'','');return {on(){},kill(){}};}return original.call(this,file,args,...rest);};cp.execFile[require('node:util').promisify.custom]=async(file,args,options)=>file==='ps'?{stdout:'',stderr:''}:require('node:util').promisify(original)(file,args,options);require('node:module').syncBuiltinESMExports();import(${JSON.stringify(new URL('../dist/main.js',import.meta.url).href)});`);
 const launch=()=>electron.launch({args:[bootstrap],env:{...process.env,AGENT_DATA_ROOT:root,CODEX_HOME:join(root,'codex'),CLAUDE_CONFIG_DIR:join(root,'claude'),CLAUDE_SECURESTORAGE_CONFIG_DIR:join(root,'claude'),WORKBUDDY_CONFIG_DIR:join(root,'workbuddy'),QODER_CONFIG_DIR:join(root,'qoder'),ANTIGRAVITY_USER_DATA_DIR:join(root,'antigravity'),AGENT_PORT:'0',AGENT_PROXY_PORT:String(port),CLIPROXY_BINARY:resolve('tests/fixtures/fake-cliproxy.mjs')}});
 app=await launch();let page=await app.firstWindow();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.locator('.agentCardGrid article').first().waitFor();await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'模型来源',exact:true}).click();
 for(const name of ['Alpha API','Beta API']){
  const pane=page.getByRole('region',{name:'API 模型来源'});await pane.getByRole('button',{name:'添加 API 来源',exact:true}).click();
  await pane.getByRole('textbox',{name:'来源名称',exact:true}).fill(name);await pane.getByRole('textbox',{name:'API Base URL',exact:true}).fill(baseURL);await pane.locator('input[type="password"]').fill(`fixture-${name}`);
  await pane.getByRole('button',{name:'保存并读取模型列表',exact:true}).click();await pane.getByText('读取到 2 个模型，请确认后再保存来源。',{exact:true}).waitFor();
  assert.equal(await pane.locator('input[type="password"]').inputValue(),'');
  await pane.getByRole('button',{name:'保存来源',exact:true}).click();await pane.locator('.apiModelRow').filter({hasText:'shared'}).waitFor();
  await pane.locator('.apiModelRow').filter({hasText:'shared'}).getByRole('button',{name:'最小验证',exact:true}).click();await pane.locator('.apiModelRow').filter({hasText:'shared'}).getByText(/最小文本调用通过/).waitFor();
 }
 await page.locator('.apiModelRow').filter({hasText:'forbidden'}).getByRole('button',{name:'最小验证',exact:true}).click();await page.locator('.apiModelRow').filter({hasText:'forbidden'}).getByText(/最小调用未通过/).waitFor();
 assert.equal(await page.getByText('fixture-private-error',{exact:true}).count(),0);
 const stored=await readFile(join(root,'api-sources.json'),'utf8');assert.equal(stored.includes('fixture-Alpha API'),false);assert.equal((await readFile(join(root,'cliproxy/config.yaml'),'utf8')).includes('fixture-Beta API'),false);
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'工作台',exact:true}).click();
 await page.locator('.a2aSource').filter({hasText:'Alpha API'}).click();await page.getByRole('dialog').getByRole('button',{name:'shared',exact:true}).click();
 await page.getByRole('button',{name:'接入 Claude Code',exact:true}).click();await page.locator('.workbenchAgent').filter({hasText:'Claude Code'}).getByText('Alpha API',{exact:true}).waitFor();
 await page.locator('.topActions').getByRole('button',{name:'维修师傅',exact:true}).click();let drawer=page.getByRole('dialog',{name:'维修师傅',exact:true});await drawer.getByRole('button',{name:'更换维修模型',exact:true}).click();
 await page.getByRole('dialog',{name:'选择维修模型',exact:true}).locator('section').filter({has:page.getByRole('heading',{name:'API 接入 · Beta API',exact:true})}).getByRole('button',{name:'shared',exact:true}).click();
 await page.waitForFunction(()=>fetch('/api/maintenance').then(r=>r.json()).then(s=>s.readiness.status==='ready'));await drawer.getByRole('button',{name:'开始维修',exact:true}).click();
 await page.waitForFunction(()=>fetch('/api/maintenance').then(r=>r.json()).then(s=>s.status==='completed'));await drawer.getByRole('button',{name:'关闭维修抽屉',exact:true}).click();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'模型来源',exact:true}).click();await page.locator('.apiSourceList article').filter({hasText:'Alpha API'}).getByRole('button',{name:'编辑与模型',exact:true}).click();
 await page.getByText('此来源正在使用',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'删除来源',exact:true}).isDisabled(),true);
 await page.getByRole('checkbox',{name:'启用此来源',exact:true}).uncheck();await page.getByRole('checkbox',{name:'已查看影响，确认保存本次修改',exact:true}).check();await page.getByRole('button',{name:'保存来源',exact:true}).click();await page.locator('.apiSourceList article').filter({hasText:'Alpha API'}).getByText(/已停用/).waitFor();
 for(const width of [390,768,1320]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth||document.querySelector('main').scrollWidth>document.querySelector('main').clientWidth+1),false,`API source editor overflow ${width}`);await page.screenshot({path:join(output,`sources-${width}.png`)});}
 await app.close();app=await launch();page=await app.firstWindow();page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));await page.locator('.agentCardGrid article').first().waitFor();
 await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'模型来源',exact:true}).click();await page.locator('.apiSourceList article').filter({hasText:'Beta API'}).waitFor();assert.equal(await page.locator('.apiSourceList article').count(),2);
 await page.locator('.apiSourceList article').filter({hasText:'Beta API'}).getByRole('button',{name:'编辑与模型',exact:true}).click();await page.locator('.apiModelRow').filter({hasText:'shared'}).getByRole('button',{name:'最小验证',exact:true}).click();await page.locator('.apiModelRow').filter({hasText:'shared'}).getByText(/最小文本调用通过/).waitFor();
 assert.ok(calls.some(c=>c.key==='Bearer fixture-Alpha API'));assert.ok(calls.some(c=>c.key==='Bearer fixture-Beta API'));assert.deepEqual(errors,[]);
 console.log(JSON.stringify({productP1:'passed',cases:'two independent API sources, model listing, per-model evidence, A2A, repair, affected connections, disable, restart, encrypted credentials',screenshots:output}));
}catch(error){if(app){const page=app.windows()[0];await page?.screenshot({path:join(output,'failure.png')});console.error((await page?.locator('body').innerText())?.slice(-5000));}throw error;}
finally{await app?.close();upstream.closeAllConnections();await new Promise(r=>upstream.close(r));await rm(root,{recursive:true,force:true});}
