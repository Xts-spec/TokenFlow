import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,realpath} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {AgentConnections,agentPaths} from '../packages/core/src/agent-connections.js';

// Run with: node --import tsx scripts/deepseek-settings-check.ts /path/to/@deepseek-ai/dsh
// Exercise the installed Harness config editor with isolated files and fixture credentials.
assert.ok(process.argv[2],'Provide the installed @deepseek-ai/dsh package directory');
const require=createRequire(join(resolve(process.argv[2]),'package.json'));
const {boot,readProfilePatches}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-app-boot')).href);
const {ConfigEditor}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-config-editor')).href);
const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-deepseek-settings-'));
let ctx;
try{
 const home=join(root,'home'),dir=join(home,'profiles/desktop'),bundle=join(dir,'node_modules/probe-bundle');
 await mkdir(bundle,{recursive:true});
 await writeFile(join(bundle,'package.json'),JSON.stringify({name:'probe-bundle',version:'1.0.0',dsh:{bundle:{patch:'./cordis.patch.yml'}}}));
 await writeFile(join(bundle,'noop.mjs'),'export default function () {}\n');
 await writeFile(join(bundle,'cordis.patch.yml'),JSON.stringify([{insert:[{id:'llm-pi-ai',name:'./noop.mjs',config:{providers:{}}},{id:'agent-default-model',name:'./noop.mjs',config:{}}]}]));
 await writeFile(join(dir,'package.json'),JSON.stringify({name:'probe-profile',dsh:{profile:{bundles:['probe-bundle']}}}));
 await writeFile(join(dir,'cordis.yml'),'[]\n');
 const profile={name:'desktop',dir,home,patchPath:join(dir,'cordis.patch.yml'),installAnchor:join(dir,'package.json'),cwd:root,overlays:[],startedBundles:['probe-bundle']};
 const savedHome=process.env.DSH_HOME;let path:string;
 try{process.env.DSH_HOME=home;path=agentPaths().deepseek;}
 finally{if(savedHome===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=savedHome;}
 const connections=new AgentConnections(join(root,'gateway'),{deepseek:path},async()=>[]);
 const state=(await connections.status()).find(item=>item.id==='deepseek')!;
 await connections.apply({target:'deepseek',revision:state.revision,origin:'http://127.0.0.1:9527',model:'api/test',sourceId:'a'.repeat(24),keyId:randomUUID(),key:'fixture-only'});
 ctx=await boot('dsh',join(dir,'cordis.yml'),readProfilePatches('dsh',profile),async context=>{context.provide('profileContext',profile);await context.plugin(ConfigEditor);});
 const entry=ctx.configEditor.entries().find(row=>row.options.id==='llm-pi-ai');
 assert.ok(entry,'llm-pi-ai must be active');
 await ctx.configEditor.edit(entry,current=>({...current,providers:{...current.providers,manual:{apiKeyEnv:'FIXTURE_KEY'}}}));
 const patch=await readFile(profile.patchPath,'utf8');
 assert.ok(patch.includes('manual:')&&patch.includes('token-flow:'),'Both providers must survive the native settings write');
 console.log(JSON.stringify({nativeDeepSeekSettings:'passed',manualProviderSaved:true,gatewayProviderPreserved:true,inferenceRequests:0}));
}finally{if(ctx)await ctx.fiber.dispose();await rm(root,{recursive:true,force:true});}
