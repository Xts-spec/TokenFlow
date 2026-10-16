/** Isolated Electron UI smoke: fixture credentials and lifecycle, never the user's apps. */
import {app,BrowserWindow,session} from 'electron';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.js';
void main();
async function main(){
const root=await mkdtemp(join(await realpath(tmpdir()),'claude-integration-ui-'));
app.setPath('userData',join(root,'electron'));await app.whenReady();app.dock?.hide();
const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
await mkdir(join(root,'cliproxy/auth'),{recursive:true});
const entries=['claude'].map(provider=>({name:`${provider}.json`,provider,status:'active',email:`${provider}@example.test`,models:['claude-sonnet-4-6','claude-opus-4-6']}));
await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(entries));
for(const a of entries)await writeFile(join(root,'cliproxy/auth',a.name),JSON.stringify({type:a.provider,uid:'fixture-user',account_uuid:'fixture-account',organization_uuid:'fixture-org',email:a.email,access_token:'fixture-token',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
const vault=new Map<string,string>();let changes=0;
const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'fixture-admin',localKey:'fixture-key',uiRoot:resolve('dist/console'),agentPaths:{qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/cordis.patch.yml')},agentProcesses:async()=>[],desktopProcesses:async()=>[],nativeProcesses:async()=>[],antigravityPath:join(root,'antigravity.db'),claudeCredentialStore:null,qoderIde:{path:join(root,'native/ide.vscdb')},claudeTerminalChange:async work=>{await work();changes++;return {message:'测试终端已打开'};},claudeDesktop:{directory:join(root,'Claude-3p'),processes:async()=>[],policy:async()=>{}},claudeDesktopChange:async work=>{await work();changes++;},secrets:{get:async n=>vault.get(n)??'',set:async(n,v)=>{vault.set(n,v);}},desktopAccountChange:async(_target,work)=>{await work();changes++;},desktopAccounts:{platform:'darwin',paths:{qoder:join(root,'qoder/auth.v1.dat'),workbuddy:join(root,'workbuddy/auth.info'),'workbuddy-ai':join(root,'workbuddy-ai/auth.info')},crypto:async(op,value)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString(),fetch:async()=>new Response(JSON.stringify({id:'fixture-user',email:'qoder@example.test',data:{accounts:[{uid:'fixture-user',type:'personal',pluginEnabled:true,nickname:'WorkBuddy Test'}]}}))}});
let win:BrowserWindow|undefined;
try{
 await service.proxy.start();const address=await service.app.listen({host:'127.0.0.1',port:0});await session.defaultSession.cookies.set({url:address,name:'agent_session',value:'fixture-admin',httpOnly:true,sameSite:'strict'});
 win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await win.loadURL(address);
 const evaluate=(code:string)=>win!.webContents.executeJavaScript(code);
 const wait=async(code:string)=>{for(let n=0;n<100;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,100));}throw Error(`UI condition timeout: ${code}`);};
 const click=async(selector:string,text:string)=>{const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`;await wait(`!!(${expression})`);await evaluate(`(${expression}).click()`);await new Promise(r=>setTimeout(r,150));};
 const screenshot=async(name:string)=>{await new Promise(r=>setTimeout(r,350));await mkdir(resolve('release/account-products-test/ui-check'),{recursive:true});await writeFile(resolve('release/account-products-test/ui-check',name),(await win!.webContents.capturePage()).toPNG());};
 await click('nav button','账号授权');await click('[role=tab]','Claude');
 if(await evaluate('document.body.innerText.includes("Claude 独立桌面版")'))throw Error("Unsupported desktop login visible");
 await click('button','切换到此账号');await click('dialog[open] button','取消');if(changes)throw Error('Cancel changed login');
 await click('button','切换到此账号');await click('dialog[open] button','切换并重新打开');await wait('!!document.querySelector(".tfAccountTabs .tfUsing")');await screenshot('claude-accounts.png');
 await click('nav button','本地 Agent');await wait('[...document.querySelectorAll(".tfTile")].some(e=>e.querySelector("strong")?.textContent==="Claude Code")');await evaluate('[...document.querySelectorAll(".tfTile")].find(e=>e.querySelector("strong")?.textContent==="Claude Code").click()');
 await wait('!!document.querySelector("section[aria-label=官方登录账号] .tfUsing")');await screenshot('claude-terminal.png');
 await click('button','恢复原登录');await click('dialog[open] button','恢复并重新打开');await wait('!document.body.innerText.includes("恢复原登录")');
 await click('button','独立桌面版');await wait(`document.querySelector('select[aria-label="Claude 桌面默认模型"]')?.options.length>1`);
 await evaluate(`(()=>{const e=document.querySelector('select[aria-label="Claude 桌面默认模型"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(e,e.options[1].value);e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 await click('button','接入桌面版');await click('dialog[open] button','继续');await wait('document.body.innerText.includes("已接入 TokenFlow")');await screenshot('claude-desktop-connected.png');
 if(await evaluate('document.body.innerText.includes("打开官方登录")'))throw Error('Unsupported desktop switch visible');
 await click('button','恢复接入前配置');await click('dialog[open] button','继续');await wait('!document.body.innerText.includes("恢复接入前配置")');
 if(changes!==4)throw Error(`Expected 4 fixture actions, got ${changes}`);console.log('PASS: Claude CLI switch/restore and desktop gateway connect/restore, hidden unsupported desktop account switching, including cancel.');
}catch(error){console.error(error instanceof Error?error.message:'UI check failed');console.error('fixture changes',changes);console.error(await win?.webContents.executeJavaScript('document.querySelector("dialog[open]")?.textContent??"no open dialog"')); process.exitCode=1;}
finally{win?.destroy();await service.app.close();await rm(root,{recursive:true,force:true});app.exit(process.exitCode??0);}

}
