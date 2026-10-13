// Official SDK acceptance: native session resume and a narrowly permitted Read.
// Requires the isolated SDK install used by codebuddy-sdk-live.mjs.
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,readdir,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {homedir,tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
assert.equal(process.argv[2],'--live','Explicit --live required');
const require=createRequire(resolve('artifacts/codebuddy-sdk-probe/package.json'));
const {query}=require('@tencent-ai/agent-sdk');
const accounts=[];
const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
for(const file of await readdir(authDir)){
 if(!file.endsWith('.json'))continue;
 try{const a=JSON.parse(await readFile(join(authDir,file),'utf8'));if(a.type==='workbuddy'&&!a.disabled&&(a.access_token||a.jwt))accounts.push(a);}catch{}
}
for(const region of ['china','international']){
 const account=accounts.find(a=>(String(a.domain).includes('workbuddy.ai')?'international':'china')===region);
 if(!account){console.log(JSON.stringify({region,status:'missing_credentials'}));process.exitCode=1;continue;}
 const root=await mkdtemp(join(await realpath(tmpdir()),'token-flow-sdk-session-'));
 const workspace=join(root,'workspace'),config=join(root,'config');await mkdir(workspace);await mkdir(config);
 const marker=`READ_${randomUUID()}`,context=`CONTEXT_${randomUUID()}`,file=join(workspace,'probe.txt');await writeFile(file,marker);
 const env=Object.fromEntries(Object.keys(process.env).filter(k=>/^(CODEBUDDY|ANTHROPIC|OPENAI|WORKBUDDY)_/.test(k)).map(k=>[k,undefined]));
 Object.assign(env,{CODEBUDDY_AUTH_TOKEN:account.access_token||account.jwt,CODEBUDDY_INTERNET_ENVIRONMENT:region==='china'?'internal':'public',CODEBUDDY_CONFIG_DIR:config});
 const results=[];
 try{
  let session;
  for(const phase of ['create','resume-read']){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),60000);
   let q,answer='',result,readCalls=0,toolResults=0;const models=new Set();let denied=0;let code11128=false;
   try{
    q=query({prompt:phase==='create'?`Remember this exact marker for the next message: ${context}. Reply SDK_READY only.`:`Continue our conversation. Read ${file} with the Read tool. Reply with the marker I asked you to remember followed by the exact file contents. Do not read any other files.`,options:{environment:region==='china'?'internal':'external',env,cwd:workspace,tools:phase==='create'?[]:['Read'],mcpServers:{},strictMcpConfig:true,settingSources:[],persistSession:true,maxTurns:3,model:'deepseek-v4.1-flash',...(session?{resume:session}:{}),abortController:controller,canUseTool:async(name,input)=>{
     const requested=input.file_path??input.path;
     if(name==='Read'&&typeof requested==='string'&&resolve(workspace,requested)===file)return {behavior:'allow',updatedInput:input};
     denied++;return {behavior:'deny',message:'Only the diagnostic file is allowed'};
    },stderr:line=>{if(/11128|unapproved channel/i.test(line))code11128=true;}}});
    for await(const message of q){
     if(message.type==='system'&&message.subtype==='init')session=message.session_id;
     if(message.type==='assistant'){
      models.add(message.message.model);
      for(const block of message.message.content){if(block.type==='text')answer+=block.text;if(block.type==='tool_use'&&block.name==='Read')readCalls++;}
     }
     if(message.type==='user'&&Array.isArray(message.message.content))for(const block of message.message.content)if(block.type==='tool_result'&&JSON.stringify(block.content).includes(marker))toolResults++;
     if(message.type==='result'){result={subtype:message.subtype,isError:message.is_error,usage:message.usage};if(message.result)answer+=message.result;if(/11128|unapproved channel/i.test(JSON.stringify(message.errors??[])))code11128=true;}
    }
    const passed=result?.subtype==='success'&&!result.isError&&(phase==='create'?answer.includes('SDK_READY'):answer.includes(marker)&&answer.includes(context)&&readCalls>0&&toolResults>0);
    results.push({phase,passed,models:[...models],readCalls,toolResults,denied,code11128,historyRetained:phase==='resume-read'?answer.includes(context):undefined,result});
    if(!passed){process.exitCode=1;break;}
   }catch(error){results.push({phase,passed:false,errorType:error.name,code11128});process.exitCode=1;break;}
   finally{clearTimeout(timer);await q?.return().catch(()=>{});}
  }
 }finally{await rm(root,{recursive:true,force:true});}
 console.log(JSON.stringify({region,check:'official SDK conversation and tool acceptance',results}));
}
