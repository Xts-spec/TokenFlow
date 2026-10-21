import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.js';
import {WorkBuddySDKProvider} from '../packages/core/src/codebuddy.js';
import {knownClaudeCodeHelpNotice} from '../packages/core/src/gateway-help-notice.js';
import type {SDKInput} from '../packages/codebuddy-runtime/index.js';

it('normalizes the known notice for Desktop and ordinary CLI keys without changing tools or user data',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'workbuddy-desktop-scope-'));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 await mkdir(join(root,'cliproxy/auth'),{recursive:true});
 await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify([{name:'chosen.json',provider:'workbuddy',status:'active',models:['deepseek-v4.1-flash']}]));
 await writeFile(join(root,'cliproxy/auth/chosen.json'),JSON.stringify({type:'workbuddy',access_token:'fixture-token'}));
 const vault=new Map<string,string>(),directory=join(root,'Claude-3p'),seen:SDKInput[]=[];
 const service=await createDesktopService({root,proxyPort:port,binary:resolve('tests/fixtures/fake-cliproxy.mjs'),token:'admin',localKey:'sidecar',secrets:{get:async n=>vault.get(n)??'',set:async(n,v)=>{vault.set(n,v);}},claudeDesktop:{directory,processes:async()=>[],policy:async()=>{}},claudeDesktopChange:async work=>work(),workbuddySDKFactory:proxy=>new WorkBuddySDKProvider(root,(id,model)=>proxy.workbuddyCredential(id,model),async input=>{seen.push(input);return {model:input.model,text:'OK',calls:[],failed:false};})});
 const admin={host:'127.0.0.1:9527',authorization:'Bearer admin'};
 const model='workbuddy/deepseek-v4.1-flash';
 const body={model:'claude-sonnet-5',max_tokens:1024,system:[{type:'text',text:'IDENTITY'},{type:'text',text:`BEFORE\n${knownClaudeCodeHelpNotice}AFTER`}],messages:[{role:'user',content:`User data ${knownClaudeCodeHelpNotice}`}],tools:Array.from({length:115},(_,i)=>({name:`tool_${i}`,description:'Original tool description',input_schema:{type:'object',properties:{file:{type:'string'}}}}))};
 try{
  await service.proxy.start();const sourceId=service.proxy.snapshot().accounts.find(a=>a.provider==='workbuddy')!.id;
  const status=(await service.app.inject({url:'/api/claude-desktop',headers:admin})).json();
  const connected=await service.app.inject({method:'POST',url:'/api/claude-desktop/connect',headers:admin,payload:{revision:status.revision,selections:[{sourceId,model}]}});
  expect(connected.statusCode,connected.body).toBe(200);
  const journal=JSON.parse(vault.get('native-login-claude-desktop')!);
  const profile=JSON.parse(await readFile(join(directory,'configLibrary',`${journal.id}.json`),'utf8'));
  for(const stream of [false,true]){
   const result=await service.app.inject({method:'POST',url:'/v1/messages',headers:{...admin,authorization:`Bearer ${profile.inferenceGatewayApiKey}`},payload:{...body,stream}});
   expect(result.statusCode,result.body).toBe(200);
   expect(result.headers['x-token-flow-compatibility']).toBe('claude-code-help-v1');
   expect(seen.at(-1)!.systemPrompt).toBe('IDENTITY\nBEFORE\nAFTER');
   expect(seen.at(-1)!.prompt).toContain(JSON.stringify(knownClaudeCodeHelpNotice).slice(1,-1));
   expect(seen.at(-1)!.tools).toHaveLength(115);
   expect(seen.at(-1)!.tools.map(t=>t.parameters)).toEqual(body.tools.map(t=>t.input_schema));
  }
  const exported=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:admin,payload:{name:'ordinary Claude CLI key',sourceId,models:[model],agents:['claude']}});
  expect(exported.statusCode).toBe(200);
  const cli=await service.app.inject({method:'POST',url:'/v1/messages',headers:{...admin,authorization:`Bearer ${exported.json().apiKey}`,'user-agent':'claude-cli'},payload:{...body,model}});
  expect(cli.statusCode,cli.body).toBe(200);expect(cli.headers['x-token-flow-compatibility']).toBe('claude-code-help-v1');
  expect(seen.at(-1)!.systemPrompt).toBe('IDENTITY\nBEFORE\nAFTER');
  expect(seen).toHaveLength(3);
 }finally{await service.app.close();await rm(root,{recursive:true,force:true});}
});
