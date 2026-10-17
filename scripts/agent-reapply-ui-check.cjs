/** Built-renderer regression; all endpoints are fixtures, no local Agent files are read. */
const {app,BrowserWindow}=require('electron');
const {createServer}=require('node:http');
const {readFile,mkdtemp,rm}=require('node:fs/promises');
const {resolve,join,extname}=require('node:path');
const {tmpdir}=require('node:os');
const assert=require('node:assert/strict');

async function main(){
 app.on('window-all-closed',()=>{});
 const root=await mkdtemp(join(tmpdir(),'tokenflow-reapply-ui-'));app.setPath('userData',root);
 await app.whenReady();app.dock?.hide();
 const sourceId='a'.repeat(24),model='codex/test';const posts=[];
 const targets=['codex','claude'].map(id=>({id,name:id==='codex'?'Codex':'Claude Code',installation:{installed:true,version:'fixture'},restartSupported:true,exists:true,revision:'1'.repeat(64),pids:[],configurationState:'changed',backups:[],connection:{id:'11111111-1111-4111-8111-111111111111',target:id,model,sourceId,selections:[{model,sourceId}],state:'applied'}}));
 const local={state:'running',loginState:'idle',port:8317,logs:[],accounts:[{id:sourceId,label:'Fixture',provider:'codex',status:'active',models:[model]}],models:[{id:model,provider:'codex'}],quotas:{},quotaBusy:false,providers:[]};
 const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path.startsWith('/api/')){
   res.setHeader('Content-Type','application/json');
   if(path==='/api/a2a/connect'){
    let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);posts.push(input);
    const target=targets.find(t=>t.id===input.target);
    if(input.revision!==target.revision){res.statusCode=409;res.end(JSON.stringify({error:'配置已变更，请刷新接入预览。'}));return;}
    target.configurationState='configured';res.end('{}');return;
   }
   const value=path==='/api/local-agent'?local:path==='/api/a2a'?{targets}:path==='/api/a2a/program-updates'?{updates:{}}:path==='/api/codex-accounts'||path.startsWith('/api/native-accounts/')?{revision:'fixture',accounts:[],pids:[],backup:null,gatewayConnected:false}:path==='/api/usage/overview'?{rows:[],nativeRows:[],combinedRows:[],allRows:[],coverage:[],scanning:false}:path==='/api/activity/traces'?{records:[]}:path==='/api/gateway/activity'?{recent:[]}:path==='/api/gateway-keys'?{keys:[]}:path==='/api/maintenance'?{status:'idle',messages:[]}:{};
   res.end(JSON.stringify(value));return;
  }
  try{const file=resolve('dist/console','.'+(path==='/'?'/index.html':path));res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[extname(file)]??'application/octet-stream');res.end(await readFile(file));}catch{res.statusCode=404;res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{sandbox:true}});
 const evaluate=code=>win.webContents.executeJavaScript(code);
 const pause=()=>new Promise(r=>setTimeout(r,70));
 const wait=async code=>{for(let i=0;i<100;i++){if(await evaluate(code))return;await pause();}throw Error('UI timeout: '+code);};
 const click=async(label,scope='document')=>{await evaluate(`[...${scope}.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)})?.click()`);await pause();};
 const dialog='document.querySelector("dialog[open]")';
 try{
  await win.loadURL(`http://127.0.0.1:${server.address().port}`);await wait('!!document.querySelector(".tfProblem button")');
  assert.equal(posts.length,0,'detecting drift must not write');
  await click('重新应用');await wait('!!document.querySelector("dialog[open]")');
  assert.match(await evaluate(`${dialog}.textContent`),/先备份当前配置/);
  await click('取消',dialog);assert.equal(posts.length,0,'cancel must not write');
  await click('重新应用');targets[0].revision='2'.repeat(64);
  await click('备份、应用并重启',dialog);await wait('!!document.querySelector(".tfToast.error")');
  assert.equal(posts.length,1);assert.equal(posts[0].revision,'1'.repeat(64),'confirmation must pin the displayed revision');
  assert.equal(posts[0].rewrite,true);assert.equal(posts[0].restartCodex,true);
  await click('取消',dialog);await click('重新应用');await click('备份、应用并重启',dialog);
  await wait('!document.querySelector(".tfProblem")');assert.equal(posts.length,2);assert.equal(posts[1].revision,'2'.repeat(64));
  assert.equal(await evaluate('document.querySelectorAll("dialog[open]").length'),0,'Codex must not require a second confirmation');
  console.log('PASS Codex: no automatic write, cancellation, stale revision, reapply and one restart confirmation');
  await evaluate('document.querySelectorAll(".tfTile")[1].click()');await wait('!!document.querySelector(".tfProblem button")');
  await evaluate('document.querySelector("input[role=switch]").click()');await wait('!!document.querySelector("dialog[open]")');
  await click('备份并应用',dialog);await wait('!document.querySelector(".tfProblem")');
  assert.equal(posts.length,3);assert.equal(posts[2].target,'claude');assert.equal(posts[2].rewrite,true);assert.equal(posts[2].restartCodex,false);
  console.log('PASS Claude: enable switch confirms replacement and applies without Codex restart');
 }finally{win.destroy();server.close();server.closeAllConnections();await rm(root,{recursive:true,force:true});}
}
main().then(()=>app.exit(0),error=>{console.error(error);app.exit(1);});
