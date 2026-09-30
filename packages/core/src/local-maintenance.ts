import { spawn } from 'node:child_process';
import { access, realpath, mkdir, writeFile, rename, open, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, dirname, resolve, delimiter, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { connect as tcpConnect } from 'node:net';
import { z } from 'zod';
import { AgentConnections, agentProcesses, readConfig, safePath, targetSchema, type Target } from './agent-connections.js';

const conflict=(message:string)=>Object.assign(new Error(message),{statusCode:409});
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
const version=z.string().max(40).regex(/^\d+\.\d+\.\d+$/);
export const diagnosticInput=z.object({check:z.enum(['configuration','processes','ports','installation','network']).default('configuration'),target:targetSchema.default('codex'),sourceId:z.string().regex(/^[a-f0-9]{24}$/).optional()}).strict();
export type DiagnosticInput=z.infer<typeof diagnosticInput>;
export type Command={executable:string;args:string[];cwd:string;timeoutMs:number;outputLimit:number};
type CommandResult={exitCode:number|null;stdout:string;interrupted:boolean;truncated:boolean};
export type CommandRunner=(command:Command,signal:AbortSignal)=>Promise<CommandResult>;
function environment(){return Object.fromEntries(['HOME','PATH','TMPDIR','TEMP','TMP','SystemRoot','USERPROFILE'].flatMap(key=>process.env[key]?[ [key,process.env[key]!] ]:[]));}
/** No shell, bounded output and lifetime; only backend recipes construct commands. */
export const runBounded:CommandRunner=async(command,signal)=>{
 signal.throwIfAborted();
 return new Promise((resolveResult,reject)=>{
  const child=spawn(command.executable,command.args,{cwd:command.cwd,env:{...environment(),ELECTRON_RUN_AS_NODE:'1'},shell:false,detached:process.platform!=='win32',windowsHide:true,stdio:['ignore','pipe','pipe']});
  let stdout='',bytes=0,truncated=false,interrupted=false,killTimer:NodeJS.Timeout|undefined;
  const kill=(force=false)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,force?'SIGKILL':'SIGTERM');else child.kill(force?'SIGKILL':'SIGTERM');}catch{/* Already exited. */}};
  const stop=()=>{if(interrupted)return;interrupted=true;kill();killTimer=setTimeout(()=>kill(true),1500);};
  const timer=setTimeout(stop,command.timeoutMs);signal.addEventListener('abort',stop,{once:true});
  const collect=(chunk:Buffer,keep:boolean)=>{bytes+=chunk.length;if(bytes>command.outputLimit){truncated=true;stop();return;}if(keep)stdout+=chunk.toString('utf8');};
  child.stdout.on('data',(chunk:Buffer)=>collect(chunk,true));child.stderr.on('data',(chunk:Buffer)=>collect(chunk,false));
  const cleanup=()=>{clearTimeout(timer);if(killTimer)clearTimeout(killTimer);signal.removeEventListener('abort',stop);};
  child.once('error',()=>{cleanup();reject(new Error('本地命令无法启动；没有返回原始命令错误。'));});
  child.once('close',exitCode=>{if(interrupted)kill(true);cleanup();resolveResult({exitCode,stdout,interrupted,truncated});});
  if(signal.aborted)stop();
 });
};
async function findExecutable(name:string){
 if(process.platform==='win32')return undefined; // .cmd needs a shell; unsupported rather than guessed.
 for(const directory of (process.env.PATH??'').split(delimiter).filter(isAbsolute)){
  const candidate=join(directory,name);try{await access(candidate,constants.X_OK);return await realpath(candidate);}catch{/* Try next PATH entry. */}
 }
}
async function fileHash(path:string){const value=await readConfig(path);if(value===null)throw conflict('安装文件已消失');return digest(value);}
async function portEvidence(port:number,signal:AbortSignal){
 const started=Date.now();return new Promise<{port:number;reachable:boolean;durationMs:number}>((done,reject)=>{
  signal.throwIfAborted();const socket=tcpConnect({host:'127.0.0.1',port});let ended=false;
  const finish=(reachable:boolean)=>{if(ended)return;ended=true;signal.removeEventListener('abort',stop);socket.destroy();done({port,reachable,durationMs:Date.now()-started});};
  const stop=()=>{if(ended)return;ended=true;socket.destroy();reject(new Error('诊断已停止'));};signal.addEventListener('abort',stop,{once:true});
  socket.setTimeout(1500,()=>finish(false));socket.once('connect',()=>finish(true));socket.once('error',()=>finish(false));
 });
}
export type Installation={target:Target;path?:string;version?:string;channel:'npm-global'|'unknown'|'not-found';reason:string;fingerprint?:string;packageRoot?:string;npm?:string;prefix?:string;reference:string};
export type LocalRun={id:string;kind:'diagnostic'|'upgrade';title:string;startedAt:string;endedAt?:string;status:'running'|'completed'|'failed'|'stopped'|'interrupted';steps:{name:string;status:'passed'|'failed'|'skipped'|'running';message:string;data?:unknown}[]};
export type UpgradePlan={id:string;target:'codex';currentVersion:string;nextVersion:string;createdAt:string;expiresAt:string;installation:Installation;command:Command;integrity:string;configurationRevision:string;impact:string;rollback:string};
type Options={runner?:CommandRunner;installation?:()=>Promise<Installation>;latest?:()=>Promise<{version:string;integrity:string}>;source:(id:string)=>Promise<{baseURL:string;name:string}|undefined>;gateway:()=>{port:number;state:string};processes?:(target:Target)=>Promise<number[]>};
const historySchema=z.array(z.object({id:z.string().uuid(),kind:z.enum(['diagnostic','upgrade']),title:z.string().max(200),startedAt:z.string(),endedAt:z.string().optional(),status:z.enum(['running','completed','failed','stopped','interrupted']),steps:z.array(z.object({name:z.string(),status:z.enum(['passed','failed','skipped','running']),message:z.string(),data:z.unknown().optional()}))})).max(50);

/** Lives independently of the model and sidecar. Stores facts, never raw configs or command output. */
export class LocalMaintenance {
 private runs:LocalRun[]=[];private plan?:UpgradePlan;private abort?:AbortController;private task?:Promise<void>;private closed=false;private warning='';
 private runner:CommandRunner;private processes:(target:Target)=>Promise<number[]>;
 constructor(private root:string,private connections:AgentConnections,private options:Options){this.runner=options.runner??runBounded;this.processes=options.processes??agentProcesses;}
 async load(){
  this.root=await realpath(this.root);
  try{const raw=await readConfig(join(this.root,'local-maintenance.json'));if(raw===null)return;this.runs=historySchema.parse(JSON.parse(raw));for(const run of this.runs)if(run.status==='running'){run.status='interrupted';run.endedAt=new Date().toISOString();run.steps.push({name:'启动恢复',status:'failed',message:'上次运行未完成。部分操作可能已执行，未自动重试或声称回滚。'});}await this.persist();}
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')this.warning='本地维修记录无法读取，原文件保留；本轮不会覆盖，请先检查资料目录。';}
 }
 snapshot(){return structuredClone({runs:this.runs,plan:this.plan,warning:this.warning,active:this.runs.find(r=>r.status==='running')?.id});}
 private async persist(){if(this.warning)throw conflict(this.warning);const path=join(this.root,'local-maintenance.json');await writeFile(`${path}.tmp`,JSON.stringify(this.runs,null,2),{mode:0o600});await rename(`${path}.tmp`,path);}
 private ensureIdle(){if(this.closed)throw conflict('服务正在关闭');if(this.abort)throw conflict('本地诊断或升级正在执行，请先停止或等待完成');if(this.warning)throw conflict(this.warning);}
 private async command(executable:string,args:string[],signal:AbortSignal){const result=await this.runner({executable,args,cwd:this.root,timeoutMs:5000,outputLimit:32768},signal);signal.throwIfAborted();if(result.exitCode!==0||result.interrupted||result.truncated)throw conflict('版本或安装来源命令未完成');return result.stdout.trim();}
 async installation(target:Target,signal=new AbortController().signal):Promise<Installation>{
  const reference=target==='codex'?'https://learn.chatgpt.com/docs/codex/cli':'https://code.claude.com/docs/en/setup';
  if(target!=='codex'&&target!=='claude')return {target,channel:'unknown',reason:'此实例没有可靠的安装适配器，请在原应用内检查更新。',reference:''};
  if(target==='codex'&&this.options.installation)return this.options.installation();
  const path=await findExecutable(target);if(!path)return {target,channel:'not-found',reason:'当前应用 PATH 中没有发现 CLI；这不代表桌面应用或 IDE 扩展未安装。',reference};
  let currentVersion:string|undefined;try{const output=await this.command(path,['--version'],signal);currentVersion=output.match(/(?:^|\s)(\d+\.\d+\.\d+)(?:\s|$)/)?.[1];}catch{signal.throwIfAborted();}
  if(!version.safeParse(currentVersion).success)currentVersion=undefined;
  const unknown:Installation={target,path,version:currentVersion,channel:'unknown',reason:'发现 CLI，但无法确认匹配的 npm 全局安装来源。请使用原安装通道。',reference};
  if(target!=='codex'||!currentVersion)return unknown;
  try{
   const packageRoot=dirname(dirname(path));const manifestPath=join(packageRoot,'package.json');const manifest=JSON.parse((await readConfig(manifestPath))??'null');
   if(manifest?.name!=='@openai/codex'||manifest.version!==currentVersion||typeof manifest.bin?.codex!=='string'||resolve(packageRoot,manifest.bin.codex)!==path)return unknown;
   const npm=await findExecutable('npm');if(!npm||!npm.endsWith('/npm/bin/npm-cli.js'))return unknown;
   const globalRoot=await this.command(process.execPath,[npm,'root','--global'],signal);const prefix=await this.command(process.execPath,[npm,'prefix','--global'],signal);
   if(!isAbsolute(globalRoot)||!isAbsolute(prefix)||await realpath(join(globalRoot,'@openai/codex'))!==packageRoot)return unknown;
   const fingerprint=digest(JSON.stringify([path,await fileHash(path),await fileHash(manifestPath),npm,await fileHash(npm),prefix,globalRoot]));
   return {target,path,version:currentVersion,channel:'npm-global',reason:'已核对实际 CLI、包版本及当前 npm 全局目录。',packageRoot,npm,prefix,fingerprint,reference};
  }catch{signal.throwIfAborted();return unknown;}
 }
 private async latest(){
  if(this.options.latest)return this.options.latest();
  const response=await fetch('https://registry.npmjs.org/@openai%2fcodex/latest',{redirect:'error',signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw conflict('官方 npm 更新通道无法访问');
  const reader=response.body!.getReader();let raw='',bytes=0;
  try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.length;if(bytes>1024*1024)throw conflict('更新元数据超过限制');raw+=Buffer.from(part.value).toString('utf8');}}finally{await reader.cancel().catch(()=>{});}
  const data=z.object({name:z.literal('@openai/codex'),version,dist:z.object({integrity:z.string().regex(/^sha512-[A-Za-z0-9+/=]+$/),tarball:z.string().url().refine(url=>new URL(url).origin==='https://registry.npmjs.org')})}).parse(JSON.parse(raw));
  return {version:data.version,integrity:data.dist.integrity};
 }
 async prepareUpgrade(){
  this.ensureIdle();const controller=new AbortController();this.abort=controller;
  try{
   const install=await this.installation('codex',controller.signal);if(install.channel!=='npm-global'||!install.npm||!install.prefix||!install.version||!install.fingerprint)throw conflict(install.reason);
   if((await this.processes('codex')).length)throw conflict('Codex 正在运行，请结束任务并退出后再检查升级。');
   const next=await this.latest();controller.signal.throwIfAborted();if(next.version===install.version)throw conflict('当前 npm 通道已是该版本，无需升级。');
   if(next.version.split('.').map(Number).reduce((n,v,i)=>n||(v-Number(install.version!.split('.')[i])),0)<=0)throw conflict('更新通道版本未高于当前版本，不执行降级。');
   version.parse(next.version);const current=(await this.connections.status()).find(t=>t.id==='codex')!;
   this.plan={id:randomUUID(),target:'codex',currentVersion:install.version,nextVersion:next.version,createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+600000).toISOString(),installation:install,integrity:next.integrity,configurationRevision:current.revision,
    command:{executable:process.execPath,args:[install.npm,'install','--global','--prefix',install.prefix,`@openai/codex@${next.version}`,'--registry=https://registry.npmjs.org/','--no-audit','--no-fund'],cwd:this.root,timeoutMs:120000,outputLimit:512*1024},
    impact:'替换该 npm 全局 CLI，可能执行 npm 安装脚本。只使用官方 npm 注册表，不提权、不停止其他应用。执行前备份受管配置。',rollback:'配置备份可恢复文件；不保证软件降级、安装脚本或数据迁移可回退。停止或失败后需重新检查实际安装状态。'};
   return structuredClone(this.plan);
  }catch(error){if(error instanceof Error&&'statusCode' in error)throw error;throw conflict('安装或更新通道检查未完成，请重新检查；未执行升级。');}finally{this.abort=undefined;}
 }
 async diagnostic(input:DiagnosticInput,signal:AbortSignal){
  input=diagnosticInput.parse(input);signal.throwIfAborted();
  if(input.check==='configuration'){
   const target=(await this.connections.status()).find(t=>t.id===input.target)!;
   const checks=target.connection?await this.connections.review(target.connection.id).catch(()=>undefined):undefined;
   return {state:target.configurationState,revision:target.revision,path:target.path,backupCount:target.backups.length,checks:checks?.checks??[],liveCallVerified:false,message:target.error?'配置或进程无法读取':target.connection?'已检查受管配置；不是客户端实际调用验证。':'没有受管连接；未读取凭据或返回原始配置。'};
  }
  if(input.check==='processes')return {target:input.target,pids:await this.processes(input.target),message:'只查询进程名称与 PID，不读取命令参数，不终止进程。'};
  if(input.check==='installation')return this.installation(input.target,signal);
  if(input.check==='ports')return {...this.options.gateway(),evidence:await portEvidence(this.options.gateway().port,signal),message:'TCP 可达不代表模型调用成功。'};
  if(!input.sourceId)throw conflict('网络诊断需要明确选择已保存的 API 来源');
  const source=await this.options.source(input.sourceId);if(!source)throw conflict('所选 API 来源不存在或已停用');
  const url=new URL(source.baseURL);url.search='';url.hash='';const started=Date.now();
  // A credential-free HEAD checks the configured endpoint only. Never follow redirects or disable TLS.
  try{const response=await fetch(url,{method:'HEAD',redirect:'manual',signal:AbortSignal.any([signal,AbortSignal.timeout(10000)])});await response.body?.cancel();return {sourceId:input.sourceId,stage:url.protocol==='https:'?'DNS/TCP/TLS/HTTP':'TCP/HTTP',httpStatus:response.status,durationMs:Date.now()-started,message:'已收到 HTTP 响应。未带密钥、未调用模型；401/403/405 也不能据此判定模型权限。'};}
  catch{signal.throwIfAborted();return {sourceId:input.sourceId,stage:'network',durationMs:Date.now()-started,message:'指定地址未完成网络检查。现有证据不足以区分 DNS、代理、TLS 与服务端超时。'};}
 }
 private async start(kind:LocalRun['kind'],title:string,perform:(run:LocalRun,signal:AbortSignal)=>Promise<void>){
  this.ensureIdle();const controller=new AbortController();this.abort=controller;
  const previous=this.runs;const run:LocalRun={id:randomUUID(),kind,title,startedAt:new Date().toISOString(),status:'running',steps:[]};this.runs=[run,...this.runs].slice(0,50);
  try{await this.persist();}catch(error){this.abort=undefined;this.runs=previous;throw error;}
  this.task=(async()=>{
   try{await perform(run,controller.signal);controller.signal.throwIfAborted();run.status='completed';}
   catch{run.status=controller.signal.aborted?'stopped':'failed';run.steps.push({name:'执行结果',status:'failed',message:kind==='upgrade'?'升级未完成。已执行步骤见记录，软件可能已变化；未自动回滚或重试。':'诊断未完成；已取得的结果保留。'});}
   finally{run.endedAt=new Date().toISOString();try{await this.persist();}catch{this.warning='维修结果无法保存到磁盘；当前结果仍在本次运行中，请保留资料目录并检查。';}this.abort=undefined;}
  })();return this.snapshot();
 }
 startDiagnostic(target:Target,sourceId?:string){return this.start('diagnostic',`${target} · 本地诊断`,async(run,signal)=>{
  for(const check of ['configuration','processes','ports','installation',...(sourceId?['network']:[])] as DiagnosticInput['check'][]){
   signal.throwIfAborted();try{const data=await this.diagnostic({check,target,sourceId},signal);signal.throwIfAborted();run.steps.push({name:check,status:'passed',message:'检查已完成，请以具体证据判断。',data});}catch{signal.throwIfAborted();run.steps.push({name:check,status:'failed',message:'该项无法完成，继续检查其他项目。'});}await this.persist();
  }
 });}
 async executeUpgrade(id:string){
  this.ensureIdle();const plan=this.plan;if(!plan||plan.id!==id||Date.now()>Date.parse(plan.expiresAt))throw conflict('升级方案已变更或过期，请重新检查');
  return this.start('upgrade',`Codex ${plan.currentVersion} → ${plan.nextVersion}`,async(run,signal)=>{
   const lock=join(this.root,'codex-upgrade.lock');let file;
   try{file=await open(lock,'wx',0o600);}catch{throw conflict('另一个升级操作持有锁，未执行');}
   try{
    const install=await this.installation('codex',signal);const target=(await this.connections.status()).find(t=>t.id==='codex')!;
    if(install.fingerprint!==plan.installation.fingerprint||target.revision!==plan.configurationRevision||target.pids.length||(await this.processes('codex')).length)throw conflict('安装、配置或运行进程已变化，请重新检查');
    const metadata=await this.latest();signal.throwIfAborted();if(metadata.version!==plan.nextVersion||metadata.integrity!==plan.integrity)throw conflict('更新通道元数据已变化，请重新生成方案');
    const backup=join(this.root,'backups',`codex-upgrade-${run.id}`);await safePath(backup);await mkdir(backup,{recursive:true,mode:0o700});
    const config=await readConfig(this.connections.paths.codex);if(digest(config===null?'missing':`file:${config}`)!==plan.configurationRevision)throw conflict('配置在备份前发生变化');if(config!==null)await writeFile(join(backup,'config.toml'),config,{mode:0o600,flag:'wx'});
    await writeFile(join(backup,'plan.json'),JSON.stringify(plan,null,2),{mode:0o600,flag:'wx'});
    run.steps.push({name:'前置检查与配置备份',status:'passed',message:'版本、安装路径、配置指纹和空闲进程已核对；仅配置备份，不承诺软件回退。',data:{backup}});await this.persist();signal.throwIfAborted();
    // The exact version is pinned. No shell text or renderer-supplied args reach this executor.
    const beforeCommand=(await this.connections.status()).find(t=>t.id==='codex')!;
    if(beforeCommand.revision!==plan.configurationRevision||beforeCommand.pids.length||(await this.processes('codex')).length||(await this.installation('codex',signal)).fingerprint!==plan.installation.fingerprint)throw conflict('执行前安装、配置或进程发生变化');
    const step:LocalRun['steps'][number]={name:'npm 升级',status:'running',message:'命令即将执行；结果待确认，可能部分安装。'};run.steps.push(step);await this.persist();signal.throwIfAborted();
    let result:CommandResult;
    try{result=await this.runner(plan.command,signal);}catch(error){step.status='failed';step.message='命令没有完成，可能部分安装。';throw error;}
    step.status=result.exitCode===0&&!result.interrupted?'passed':'failed';step.message=result.interrupted?'命令已中止，可能部分安装。':`命令退出码 ${result.exitCode??'未知'}；未保存原始输出。`;await this.persist();signal.throwIfAborted();
    if(result.exitCode!==0||result.interrupted)throw conflict('安装未完成');
    const after=await this.installation('codex',signal);const current=(await this.connections.status()).find(t=>t.id==='codex')!;
    const ok=after.version===plan.nextVersion&&current.revision===plan.configurationRevision;
    run.steps.push({name:'版本与配置实测',status:ok?'passed':'failed',message:ok?'实际 CLI 版本与目标相符，配置未变化。模型及客户端实际调用仍需单独验证。':'实际版本或配置复查未通过，备份仍保留。',data:{version:after.version,configurationUnchanged:current.revision===plan.configurationRevision,liveCallVerified:false}});if(!ok)throw conflict('复查失败');
   }finally{await file.close();await rm(lock,{force:true});this.plan=undefined;}
  });
 }
 async stop(){this.abort?.abort();await this.task;return this.snapshot();}
 async close(){this.closed=true;await this.stop();}
}
