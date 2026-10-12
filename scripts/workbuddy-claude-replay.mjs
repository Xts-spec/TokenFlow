// Opt-in replay of a previously submitted Claude request to the same WorkBuddy
// account. No tools execute, no original configuration changes, no content logs.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {createDesktopService} from '../packages/core/src/service.ts';
assert.equal(process.argv[2],'--live','Explicit --live required');
const log=process.argv[3];assert.ok(log,'Provide the previous request log path');
const body=(await readFile(log,'utf8')).split('\n').flatMap(line=>{try{const v=JSON.parse(line);return v.model?.startsWith('workbuddy/')&&Array.isArray(v.messages)?[v]:[];}catch{return [];}})[0];
assert.ok(body,'No WorkBuddy request found');
const variant=process.argv[4]??'original';
assert.ok(['original','max4096','no-thinking','core-tools','fresh-turn','without-system','flatten-system','join-instructions','identity-only','rules-only','print-identity'].includes(variant));
if(variant==='print-identity'){
 const identities=["You are Claude Code, Anthropic's official CLI for Claude.","You are Claude Code, Anthropic's official CLI for Claude, running within the Claude Agent SDK."];
 let replaced=0;body.system=body.system.map(block=>{if(block.type==='text'&&identities.includes(block.text)){replaced++;return {...block,text:"You are a Claude agent, built on Anthropic's Claude Agent SDK."};}return block;});
 assert.equal(replaced,1,'Expected one known CLI identity block');
}
if(variant==='identity-only')body.system=[body.system[1]];
if(variant==='rules-only')body.system=[body.system[2]];
if(variant==='join-instructions')body.system=body.system.map(s=>s.text??'').filter(s=>!s.trimStart().startsWith('x-anthropic-billing-header:')).join('\n\n');
if(variant==='flatten-system')body.system=body.system.map(s=>s.text??'').join('\n\n');
if(variant==='without-system')delete body.system;
if(variant==='fresh-turn')body.messages=[{role:'user',content:'Reply OK only.'}];
if(variant==='max4096')body.max_tokens=4096;
if(variant==='no-thinking')delete body.thinking;
if(variant==='core-tools')body.tools=body.tools.filter(t=>['Read','Edit','Write','Bash'].includes(t.name));
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-workbuddy-replay-'));
let service;
try {
 const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');let credential;
 for(const name of await readdir(authDir)){if(!name.endsWith('.json'))continue;try{const v=JSON.parse(await readFile(join(authDir,name),'utf8'));if(v.type==='workbuddy'&&v.access_token&&!v.disabled){credential=v;break;}}catch{}}
 assert.ok(credential,'No enabled WorkBuddy credential');
 await mkdir(join(root,'cliproxy/auth'),{recursive:true,mode:0o700});
 const fields=['type','provider','jwt','access_token','uid','email','domain','proxy_url','expired','expires_in','timestamp'];
 await writeFile(join(root,'cliproxy/auth/probe.json'),JSON.stringify(Object.fromEntries(fields.filter(k=>credential[k]!==undefined).map(k=>[k,credential[k]]))),{mode:0o600});
 const allocator=createServer();await new Promise(r=>allocator.listen(0,'127.0.0.1',r));const proxyPort=allocator.address().port;await new Promise(r=>allocator.close(r));
 service=await createDesktopService({root,proxyPort,binary:resolve('sidecars/darwin-arm64/cliproxyapi'),token:'replay-admin',localKey:'replay-local',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:join(root,'codex.toml'),claude:join(root,'claude.json'),workbuddy:join(root,'workbuddy.json'),qoder:join(root,'qoder.json')},agentProcesses:async()=>[]});
 const origin=await service.app.listen({host:'127.0.0.1',port:0});await service.proxy.start();
 const headers={host:new URL(origin).host,authorization:'Bearer replay-admin'};
 const source=service.proxy.snapshot().accounts.find(a=>a.provider==='workbuddy');assert.ok(source);
 const key=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers,payload:{name:'isolated request replay',sourceId:source.id,models:[body.model],agents:['claude']}});assert.equal(key.statusCode,200);
 const response=await fetch(origin+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','anthropic-version':'2023-06-01','x-api-key':key.json().apiKey},body:JSON.stringify(body),signal:AbortSignal.timeout(90000)});
 const text=await response.text();let error;try{error=JSON.parse(text).error?.type;}catch{}
 const events=text.split('\n').flatMap(line=>{if(!line.startsWith('data:'))return [];try{return [JSON.parse(line.slice(5))];}catch{return [];}});
 const passed=response.ok&&events.some(e=>e.type==='message_stop')&&!events.some(e=>e.type==='error');
 console.log(JSON.stringify({check:'Claude request replay',variant,originalRequestUnmodified:variant==='original',model:body.model,http:response.status,error,passed,requestBytes:JSON.stringify(body).length,tools:body.tools?.length??0,maxTokens:body.max_tokens,messageStop:events.some(e=>e.type==='message_stop')}));
 process.exitCode=passed?0:1;
} finally {await service?.app.close();await rm(root,{recursive:true,force:true});}
