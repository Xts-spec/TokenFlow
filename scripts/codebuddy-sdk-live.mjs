// Official SDK diagnostic. No protocol/identity rewrite; credentials stay in memory.
// Install the pinned SDK into artifacts/codebuddy-sdk-probe before running with --live.
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readdir,readFile,rm,realpath} from 'node:fs/promises';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';

assert.equal(process.argv[2],'--live','Explicit --live required');
const require=createRequire(resolve('artifacts/codebuddy-sdk-probe/package.json'));
const {query}=require('@tencent-ai/agent-sdk');
const sdkVersion=JSON.parse(await readFile(resolve(require.resolve('@tencent-ai/agent-sdk'),'../../package.json'),'utf8')).version;
const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
const accounts=[];
for(const file of await readdir(authDir)){
 if(!file.endsWith('.json'))continue;
 try{const value=JSON.parse(await readFile(join(authDir,file),'utf8'));
  if(value.type==='workbuddy'&&!value.disabled&&(value.access_token||value.jwt))accounts.push(value);
 }catch{}
}
const secrets=accounts.flatMap(a=>[a.access_token,a.jwt,a.refresh_token,a.email,a.uid]).filter(v=>typeof v==='string'&&v.length>3);
const redact=value=>{let text=String(value);for(const secret of secrets)text=text.split(secret).join('<redacted>');return text.replace(/Bearer\s+\S+/gi,'Bearer <redacted>').slice(0,1200);};
for(const region of ['china','international']){
 const account=accounts.find(a=>(String(a.domain).includes('workbuddy.ai')?'international':'china')===region);
 if(!account){console.log(JSON.stringify({region,status:'missing_credentials'}));process.exitCode=1;continue;}
 const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-sdk-'));
 await mkdir(join(root,'workspace'));await mkdir(join(root,'config'));
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),60000);
 let q;let evidence='';let result;let initializedModel;let responseText='';const responseModels=new Set();const started=Date.now();
 try{
  const env=Object.fromEntries(Object.keys(process.env).filter(k=>/^(CODEBUDDY|ANTHROPIC|OPENAI|WORKBUDDY)_/.test(k)).map(k=>[k,undefined]));
  Object.assign(env,{CODEBUDDY_AUTH_TOKEN:account.access_token||account.jwt,CODEBUDDY_INTERNET_ENVIRONMENT:region==='china'?'internal':'public',CODEBUDDY_CONFIG_DIR:join(root,'config')});
  q=query({prompt:'Reply with SDK_OK only.',options:{environment:region==='china'?'internal':'external',env,cwd:join(root,'workspace'),tools:[],mcpServers:{},strictMcpConfig:true,settingSources:[],persistSession:false,maxTurns:1,abortController:controller,canUseTool:async()=>({behavior:'deny',message:'Diagnostic disables tools'}),stderr:data=>{evidence=(evidence+redact(data)).slice(-6000);},...(process.argv[3]?{model:process.argv[3]}:{})}});
  for await(const message of q){
   if(message.type==='system'&&message.subtype==='init'){
    initializedModel=message.model;
    if(process.env.SDK_LIST_MODELS==='1'){
     const models=await q.supportedModels();
     console.log(JSON.stringify({region,check:'official SDK model list',models:models.map(m=>({id:m.value??m.id??m.modelId,name:m.displayName??m.name,fields:Object.keys(m)}))}));
    }
   }
   if(message.type==='assistant'){responseModels.add(message.message.model);responseText+=message.message.content.filter(c=>c.type==='text').map(c=>c.text).join('');}
   if(message.type==='result')result={subtype:message.subtype,isError:message.is_error,usage:message.usage,errors:message.errors?.map(redact),text:redact(message.result??'')};
   if(message.type==='error')evidence+=redact(JSON.stringify(message));
  }
 }catch(error){evidence+='\n'+redact(error.message);}
 finally{clearTimeout(timer);await q?.return().catch(()=>{});await rm(root,{recursive:true,force:true});}
 const combined=JSON.stringify(result??{})+responseText+evidence;
 const passed=result?.subtype==='success'&&!result.isError&&/SDK_OK/.test(responseText+result.text);
 if(!passed)process.exitCode=1;
 console.log(JSON.stringify({region,sdkVersion,credentialKind:'existing WorkBuddy access token via documented CODEBUDDY_AUTH_TOKEN',requestedModel:process.argv[3]??'SDK default',initializedModel,responseModels:[...responseModels],passed,channelDenied:/11128|unapproved channel/i.test(combined),authenticationFailed:/401|unauth|not logged|invalid.*token|login required/i.test(combined),durationMs:Date.now()-started,result,diagnostic:passed?undefined:redact(combined)}));
}
