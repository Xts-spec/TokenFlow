import {app,BrowserWindow,session} from 'electron';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.js';

void main();
async function main(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'native-usage-ui-'));
 app.setPath('userData',join(root,'electron'));await app.whenReady();app.dock?.hide();
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/settings.json')};
 for(const directory of ['cliproxy/auth','codex/sessions','claude/projects'])await mkdir(join(root,directory),{recursive:true});
 await writeFile(paths.codex,'model="gpt-test"\n');await writeFile(paths.claude,'{}');
 const jwt=`x.${Buffer.from(JSON.stringify({email:'codex-local@example.test'})).toString('base64url')}.x`,codexAuth=JSON.stringify({auth_mode:'chatgpt',tokens:{account_id:'workspace',id_token:jwt,access_token:'fixture-access',refresh_token:'fixture-refresh'}}),claudeAuth=JSON.stringify({claudeAiOauth:{accessToken:'fixture-access',refreshToken:'fixture-refresh'}});
 await writeFile(join(root,'codex/auth.json'),codexAuth);await writeFile(join(root,'claude/.credentials.json'),claudeAuth);await writeFile(join(root,'claude/.claude.json'),JSON.stringify({oauthAccount:{accountUuid:'claude-user',organizationUuid:'org',emailAddress:'claude-local@example.test'}}));
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'claude.json',provider:'claude',status:'active',email:'claude-local@example.test',models:['claude-sonnet-4-6']}]));
 await writeFile(join(root,'cliproxy/auth/claude.json'),JSON.stringify({type:'claude',account_uuid:'claude-user',organization_uuid:'org',email:'claude-local@example.test',access_token:'fixture-access',refresh_token:'fixture-refresh',expired:'2035-01-01T00:00:00Z'}));
 const service=await createDesktopService({root,proxyPort,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'fixture-admin',localKey:'fixture-key',uiRoot:resolve('dist/console'),agentPaths:paths,agentProcesses:async()=>[],desktopProcesses:async()=>[],nativeProcesses:async()=>[],desktopAccounts:{paths:{qoder:join(root,'qoder/auth.v1.dat'),workbuddy:join(root,'workbuddy/auth.info'),'workbuddy-ai':join(root,'workbuddy-ai/auth.info')}},claudeCredentialStore:null,qoderIde:{path:join(root,'native/ide.vscdb')},antigravityPath:join(root,'antigravity.db'),claudeDesktop:{directory:join(root,'Claude-3p'),processes:async()=>[],policy:async()=>{}},secrets:{get:async()=>'',set:async()=>{}}});
 let win:BrowserWindow|undefined;
 try{
  await service.proxy.start();const address=await service.app.listen({host:'127.0.0.1',port:0}),timestamp=new Date().toISOString();
  await writeFile(join(root,'codex/sessions/native.jsonl'),[{type:'session_meta',payload:{id:'thread',model_provider:'openai'}},{type:'turn_context',payload:{model:'gpt-test'}},{type:'token_usage_record',timestamp,payload:{response_id:'codex-response',usage:{input_tokens:100,cached_input_tokens:60,output_tokens:20}}}].map(r=>JSON.stringify(r)).join('\n'));
  await writeFile(join(root,'claude/projects/native.jsonl'),JSON.stringify({type:'assistant',timestamp,message:{id:'claude-response',model:'claude-sonnet-4-6',usage:{input_tokens:40,cache_read_input_tokens:60,output_tokens:20}}}));
  for(let n=0;n<100;n++){const overview=(await service.app.inject({url:'/api/usage/overview?days=0',headers:{host:'127.0.0.1:9527',authorization:'Bearer fixture-admin'}})).json();if(!overview.scanning&&overview.nativeRows.length===2)break;if(n===99)throw Error('Native usage not ready');await new Promise(r=>setTimeout(r,100));}
  await session.defaultSession.cookies.set({url:address,name:'agent_session',value:'fixture-admin',httpOnly:true,sameSite:'strict'});
  win=new BrowserWindow({show:false,width:1320,height:900,webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});await win.loadURL(address);
  const evaluate=(code:string)=>win!.webContents.executeJavaScript(code);
  const wait=async(code:string)=>{for(let n=0;n<120;n++){if(await evaluate(code))return;await new Promise(r=>setTimeout(r,100));}throw Error(`UI condition timeout: ${code}`);};
  const click=async(selector:string,text:string)=>{const expression=`[...document.querySelectorAll(${JSON.stringify(selector)})].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&!e.disabled)`;await wait(`!!(${expression})`);await evaluate(`(${expression}).click()`);};
  const screenshot=async(name:string)=>{await new Promise(r=>setTimeout(r,300));const output=resolve('release/native-usage-test/ui-check');await mkdir(output,{recursive:true});await writeFile(join(output,name),(await win!.webContents.capturePage()).toPNG());};
  await click('nav button','用量总览');await click('[role=tab]','来源');await wait('document.querySelector(".tfOverviewMetrics")?.innerText.includes("240")');
  await wait('document.querySelector("#overview-breakdown-panel")?.innerText.includes("codex-local@example.test") && document.querySelector("#overview-breakdown-panel")?.innerText.includes("claude-local@example.test")');await wait('document.querySelector("#overview-breakdown-panel")?.innerText.includes("本机登录识别")');await screenshot('overview-native-accounts.png');
  await click('nav button','账号授权');await click('[role=tab]','Claude');await wait('document.querySelector(".tfProviderHead")?.innerText.includes("120")');await wait('!!document.querySelector(".tfAccountTabs .tfUsing")');await screenshot('claude-account-usage.png');
  await click('nav button','活动');await wait('document.querySelector(".tfTraceList")?.innerText.includes("codex-local@example.test") && document.querySelector(".tfTraceList")?.innerText.includes("claude-local@example.test")');await wait('document.querySelector(".tfTraceList")?.innerText.includes("按本机登录识别")');await screenshot('native-account-activity.png');
  if(await readFile(join(root,'codex/auth.json'),'utf8')!==codexAuth||await readFile(join(root,'claude/.credentials.json'),'utf8')!==claudeAuth)throw Error('Usage reading changed login credentials');
  console.log('PASS: total 240 tokens; Claude saved account and unsaved Codex native account visible in overview and activity without any switch; credentials unchanged.');
 }catch(error){console.error(error instanceof Error?error.message:error);process.exitCode=1;}
 finally{win?.destroy();await service.app.close();await rm(root,{recursive:true,force:true});app.exit(process.exitCode??0);}
}
