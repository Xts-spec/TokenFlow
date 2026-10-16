// Explicit live check: reuse only TokenFlow's saved Cursor authorization.
// Credentials travel over a private stdin pipe, never argv, environment or files.
const {app,safeStorage,session}=require('electron');
const {readFile,access,mkdtemp,rm}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {homedir,tmpdir}=require('node:os');
const {spawn}=require('node:child_process');
const {DatabaseSync}=require('node:sqlite');
if(!process.argv.includes('--live')){console.error('Explicit --live required');app.exit(1);}
else void main();
async function main(){
 let child,helperProfile;
 try{
  app.setName('token-flow');const base=join(homedir(),'Library/Application Support');let profile;
  for(const name of ['token-flow','token-flowb','desktop-browser-agent','Browser Agent']){const p=join(base,name);try{await access(join(p,'secrets/cursor-account.bin'));profile=p;break;}catch{}}
  if(!profile)throw Error('No saved Cursor authorization');helperProfile=await mkdtemp(join(tmpdir(),'tf-cursor-helper-'));app.setPath('userData',helperProfile);await app.whenReady();app.dock?.hide();
  const network=session.fromPartition('cursor-usage-live-check',{cache:false});await network.setProxy({mode:'system'});
  if(!safeStorage.isEncryptionAvailable())throw Error('Secure storage unavailable');
  const saved=safeStorage.decryptString(await readFile(join(profile,'secrets/cursor-account.bin')));
  let native='{}',db;
  try{db=new DatabaseSync(join(base,'Cursor/User/globalStorage/state.vscdb'),{readOnly:true});const accessToken=db.prepare('SELECT value FROM ItemTable WHERE key=?').get('cursorAuth/accessToken')?.value;if(typeof accessToken==='string')native=JSON.stringify({accessToken});}catch{}finally{db?.close();}
  child=spawn('node',['--import','tsx',resolve(__dirname,'cursor-usage-live.ts'),'--live'],{cwd:resolve(__dirname,'..'),stdio:['pipe','pipe','pipe','ipc'],env:process.env});
  child.on('message',async message=>{if(message?.type!=='resolve-proxy'||typeof message.url!=='string')return;try{const u=new URL(message.url);if(!['http:','https:'].includes(u.protocol))throw Error();const result=await network.resolveProxy(u.href);if(child.connected)child.send({id:message.id,result});}catch{if(child.connected)child.send({id:message.id,result:'UNAVAILABLE'});}});
  let output='';child.stdout.on('data',b=>{output+=b;});child.stderr.resume();
  child.stdin.end(JSON.stringify({saved,native}));const timer=setTimeout(()=>child.kill('SIGTERM'),120000);
  const code=await new Promise(resolve=>{child.on('error',()=>resolve(1));child.on('exit',resolve);});clearTimeout(timer);
  for(const line of output.split('\n'))try{const value=JSON.parse(line);if(value.check==='cursor-live-usage')console.log(JSON.stringify(value));}catch{}
  await rm(helperProfile,{recursive:true,force:true});app.exit(code??1);
 }catch{console.log(JSON.stringify({check:'cursor-live-usage',status:'unavailable',reason:'无法读取已保存授权或启动隔离测试；未创建新授权。'}));child?.kill('SIGTERM');if(helperProfile)await rm(helperProfile,{recursive:true,force:true});app.exit(1);}
}
