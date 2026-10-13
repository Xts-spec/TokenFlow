import {mkdtemp,mkdir,readdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:net';
import {spawn} from 'node:child_process';
import {createDesktopService} from '../packages/core/src/service.js';
if(process.argv[2]!=='--live')throw Error('Explicit live quota authorization is required');
const models=process.argv.slice(3);if(!models.length)models.push('qoder/kmodel_latest','qoder/ultimate');
const authDir=join(homedir(),'Library/Application Support/desktop-browser-agent/cliproxy/auth');
let credential:Record<string,any>|undefined;
for(const name of await readdir(authDir)){if(!name.startsWith('qoder')||!name.endsWith('.json'))continue;const value=JSON.parse(await readFile(join(authDir,name),'utf8'));if(value.access_token&&!value.disabled){credential=value;break;}}
if(!credential)throw Error('No active Qoder account');
const quota=async()=>{const r=await fetch('https://openapi.qoder.sh/api/v2/quota/usage',{headers:{Authorization:`Bearer ${credential!.access_token}`,Accept:'application/json','Cosy-ClientType':'CLIProxyAPI'},signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error(`Quota HTTP ${r.status}`);const raw=await r.json() as any;const data=raw.data??raw;return {at:new Date().toISOString(),plan:{total:data.userQuota?.total,used:data.userQuota?.used,remaining:data.userQuota?.remaining},organization:{total:data.orgResourcePackage?.cap,used:data.orgResourcePackage?.used,remaining:data.orgResourcePackage?.remaining}};};
const port=async()=>{const s=createServer();await new Promise<void>(r=>s.listen(0,'127.0.0.1',r));const p=(s.address() as any).port;await new Promise<void>(r=>s.close(()=>r()));return p;};
const root=await mkdtemp(join(tmpdir(),'token-flow-claude-qoder-quota-'));let service:Awaited<ReturnType<typeof createDesktopService>>|undefined;
const report:{before?:unknown;after?:unknown;settled?:unknown;calls:unknown[];gateway:unknown[];models:string[];isolatedConfiguration:boolean}={calls:[],gateway:[],models,isolatedConfiguration:true};
try{
 report.before=await quota();console.log(JSON.stringify({phase:'quota-before',quota:report.before}));
 await mkdir(join(root,'gateway/cliproxy/auth'),{recursive:true,mode:0o700});
 await writeFile(join(root,'gateway/cliproxy/auth/probe-qoder.json'),JSON.stringify(Object.fromEntries(['type','access_token','uid','email','expired','timestamp'].filter(k=>credential![k]!==undefined).map(k=>[k,credential![k]]))),{mode:0o600});
 const gatewayPort=await port(),proxyPort=await port();const base=`http://127.0.0.1:${gatewayPort}`;
 service=await createDesktopService({root:join(root,'gateway'),token:'isolated-admin',localKey:'isolated-internal',proxyPort,binary:resolve(`sidecars/${process.platform}-${process.arch}/cliproxyapi`),secrets:{get:async()=>'',set:async()=>{}},agentProcesses:async()=>[],agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json'),pi:join(root,'pi/models.json'),deepseek:join(root,'deepseek/cordis.patch.yml'),qoder:join(root,'qoder/settings.json')}});
 service.app.addHook('onSend',async(req,reply,payload)=>{if(req.url.startsWith('/v1/')){let error='';if(reply.statusCode>=400&&typeof payload==='string'){try{const p=JSON.parse(payload);error=String(p.error?.message??p.message??'').split(String(credential!.access_token)).join('[hidden]').slice(0,600);}catch{}}report.gateway.push({path:req.url,status:reply.statusCode,error});}});
 await service.app.listen({host:'127.0.0.1',port:gatewayPort});await service.proxy.start();
 for(let i=0;i<100&&!service.proxy.snapshot().models.some(m=>m.id===models[0]);i++)await new Promise(r=>setTimeout(r,200));
 const source=service.proxy.snapshot().accounts.find(a=>a.provider==='qoder');if(!source)throw Error('Qoder account unavailable');
 const response=await service.app.inject({method:'POST',url:'/api/gateway-keys',headers:{authorization:'Bearer isolated-admin',host:`127.0.0.1:${gatewayPort}`},payload:{name:'Claude quota probe',models,sourceId:source.id,agents:['claude']}});
 if(response.statusCode!==200)throw Error('Could not create isolated probe Key');const apiKey=response.json().apiKey;
 await mkdir(join(root,'claude'),{recursive:true});await mkdir(join(root,'workspace'));await mkdir(join(root,'home'));
 for(const model of models){
  const result=await new Promise<{code:number|null;stdout:string;stderr:string}>((done,fail)=>{
   const child=spawn('claude',['--print','--model',model,'--tools','','--max-turns','1','--setting-sources','','--strict-mcp-config','--mcp-config','{"mcpServers":{}}','--output-format','json','Reply with exactly QODER_QUOTA_PROBE_OK. Do not call tools or read files.'],{cwd:join(root,'workspace'),env:{PATH:process.env.PATH,LANG:process.env.LANG,TMPDIR:process.env.TMPDIR,HOME:join(root,'home'),CLAUDE_CONFIG_DIR:join(root,'claude'),ANTHROPIC_BASE_URL:base,ANTHROPIC_AUTH_TOKEN:apiKey,ANTHROPIC_API_KEY:apiKey,CLAUDE_CODE_OAUTH_TOKEN:'',DISABLE_TELEMETRY:'1',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'},stdio:['ignore','pipe','pipe']});let stdout='',stderr='';const timer=setTimeout(()=>child.kill('SIGTERM'),90000);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',e=>{clearTimeout(timer);fail(e);});child.once('close',code=>{clearTimeout(timer);done({code,stdout,stderr});});
  });
  let data:any;try{data=JSON.parse(result.stdout);}catch{}
  const call={model,exitCode:result.code,success:data?.is_error===false&&String(data.result).includes('QODER_QUOTA_PROBE_OK'),result:String(data?.result??result.stderr).split(apiKey).join('[hidden]').split(String(credential!.access_token)).join('[hidden]').slice(0,500),usage:data?.usage};report.calls.push(call);console.log(JSON.stringify({phase:'claude-result',...call}));
 }
 report.after=await quota();console.log(JSON.stringify({phase:'quota-after',quota:report.after}));
 await new Promise(r=>setTimeout(r,15000));report.settled=await quota();console.log(JSON.stringify({phase:'quota-settled',quota:report.settled}));
}finally{
 await service?.app.close();await mkdir('artifacts',{recursive:true});await writeFile('artifacts/qoder-claude-quota-probe.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});await rm(root,{recursive:true,force:true});
}
