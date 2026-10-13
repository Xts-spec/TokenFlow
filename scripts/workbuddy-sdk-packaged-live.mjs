// Run with ELECTRON_RUN_AS_NODE=1 using the packaged app's executable.
import {mkdtemp,mkdir,readFile,readdir,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';import {tmpdir,homedir} from 'node:os';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
assert.equal(process.argv[2],'--live');const app=resolve(process.argv[3]);
const {runOfficialSDK}=await import(pathToFileURL(join(app,'Contents/Resources/app.asar/node_modules/@token-flow/codebuddy-runtime/index.js')).href);
const auth=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');const accounts=[];
for(const file of await readdir(auth)){try{const v=JSON.parse(await readFile(join(auth,file),'utf8'));if(v.type==='workbuddy'&&v.access_token&&!v.disabled)accounts.push(v);}catch{}}
for(const region of ['china','international']){
 const account=accounts.find(a=>(String(a.domain).includes('workbuddy.ai')?'international':'china')===region);assert.ok(account,'Missing regional credential');
 const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-packaged-sdk-'));const cwd=join(root,'workspace'),configDir=join(root,'config');await mkdir(cwd);await mkdir(configDir,{mode:0o700});
 try{const result=await runOfficialSDK({region,token:account.access_token,model:'deepseek-v4.1-flash',prompt:'Reply SDK_PACKAGED_OK only.',tools:[],cwd,configDir,signal:AbortSignal.timeout(90000)});
  assert.equal(result.failed,false);assert.equal(result.model.toLowerCase(),'deepseek-v4.1-flash');assert.match(result.text,/SDK_PACKAGED_OK/);assert.ok(result.usage?.input_tokens>0);
  console.log(JSON.stringify({region,passed:true,model:result.model,inputTokens:result.usage.input_tokens,outputTokens:result.usage.output_tokens,electron:process.versions.electron}));
 }finally{await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
}
