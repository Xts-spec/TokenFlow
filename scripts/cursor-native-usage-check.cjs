// Read-only check using existing TokenFlow SDK grants. No inference, new key or
// native IDE credential access. Secrets use a private pipe, never argv/env/files.
const {app,safeStorage,session}=require('electron');
const {readFile,access,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {tmpdir}=require('node:os');
const {spawn}=require('node:child_process');
if(!process.argv.includes('--check')){console.error('Explicit --check required');app.exit(1);}else void main();
async function main(){
 let child,helperProfile;
 try{
  app.setName('token-flow');const base=app.getPath('appData');let profile;
  for(const name of ['token-flow','token-flowb','desktop-browser-agent','Browser Agent']){const candidate=join(base,name);try{await access(join(candidate,'secrets/cursor-account.bin'));profile=candidate;break;}catch{}}
  if(!profile)throw Error();helperProfile=await mkdtemp(join(tmpdir(),'tf-cursor-native-helper-'));app.setPath('userData',helperProfile);await app.whenReady();app.dock?.hide();
  const proxy=session.fromPartition('cursor-native-usage-check',{cache:false});await proxy.setProxy({mode:'system'});
  if(!safeStorage.isEncryptionAvailable())throw Error();const saved=safeStorage.decryptString(await readFile(join(profile,'secrets/cursor-account.bin')));
  child=spawn('node',['--import','tsx',resolve(__dirname,'cursor-native-usage-check.ts'),'--check'],{cwd:resolve(__dirname,'..'),stdio:['pipe','pipe','pipe','ipc'],env:process.env});
  child.on('message',async message=>{if(message?.type!=='resolve-proxy'||typeof message.url!=='string')return;try{const url=new URL(message.url);if(!['http:','https:'].includes(url.protocol))throw Error();const result=await proxy.resolveProxy(url.href);if(child.connected)child.send({id:message.id,result});}catch{if(child.connected)child.send({id:message.id,result:'UNAVAILABLE'});}});
  let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.resume();child.stdin.end(saved);
  const timer=setTimeout(()=>child.kill('SIGTERM'),120000),code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',resolve);});clearTimeout(timer);
  for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.check==='cursor-native-usage')console.log(JSON.stringify(value));}catch{}
  await rm(helperProfile,{recursive:true,force:true});app.exit(code??1);
 }catch{console.log(JSON.stringify({check:'cursor-native-usage',status:'unavailable',reason:'无法读取已保存授权或完成只读检查；未创建授权或修改客户端配置。'}));child?.kill('SIGTERM');if(helperProfile)await rm(helperProfile,{recursive:true,force:true});app.exit(1);}
}
