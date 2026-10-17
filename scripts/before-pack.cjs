const {readFile,writeFile,mkdir,rm,rename,access}=require('node:fs/promises');
const {join}=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {createHash}=require('node:crypto');
const exec=promisify(execFile);

function nativePackages(lock,platform,arch){
  return [`@cursor/sdk-${platform}-${arch}`].map(name=>{
    const entry=lock.packages[`node_modules/${name}`];
    if(!entry?.version||!entry.integrity?.startsWith('sha512-'))throw new Error(`Missing locked native package: ${name}`);
    return {name,version:entry.version,integrity:entry.integrity};
  });
}

// Do not let a cross-build reuse the host's optional native dependencies.
// Stage official, integrity-checked npm archives without running install scripts
// or modifying the developer's node_modules directory.
async function beforePack(context){
  const project=context.packager.projectDir,platform=context.electronPlatformName;
  const arch=typeof context.arch==='number'?['ia32','x64','armv7l','arm64','universal'][context.arch]:context.arch;
  const os={darwin:'mac',win32:'win',linux:'linux'}[platform];
  if(!os||!['arm64','x64'].includes(arch))throw new Error(`Unsupported package target: ${platform}-${arch}`);
  const lock=JSON.parse(await readFile(join(project,'package-lock.json'),'utf8'));
  const packages=nativePackages(lock,platform,arch),signature=JSON.stringify(packages);
  const stage=join(project,'.tmp','package-native',`${os}-${arch}`),marker=join(stage,'manifest.json');
  try{
    if(await readFile(marker,'utf8')===signature){
      for(const {name} of packages)await access(join(stage,'node_modules',name,'package.json'));
      return;
    }
  }catch{}
  await rm(stage,{recursive:true,force:true});await mkdir(stage,{recursive:true});
  for(const {name,version,integrity} of packages){
    const filename=`${name.split('/').pop()}-${version}.tgz`;
    const response=await fetch(`https://registry.npmjs.org/${name}/-/${filename}`,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`Cannot fetch ${name}@${version}: HTTP ${response.status}`);
    const data=Buffer.from(await response.arrayBuffer());
    const hash=`sha512-${createHash('sha512').update(data).digest('base64')}`;
    if(hash!==integrity)throw new Error(`Integrity mismatch for ${name}@${version}`);
    const archive=join(stage,filename);await writeFile(archive,data);
    // Windows GNU tar treats "d:\..." as a remote host; the system bsdtar handles drive paths.
    const tarExecutable=process.platform==='win32'?join(process.env.SystemRoot??'C:\\Windows','System32','tar.exe'):'tar';
    await exec(tarExecutable,['-xzf',archive,'-C',stage]);
    const destination=join(stage,'node_modules',name);await mkdir(join(stage,'node_modules',name.startsWith('@')?name.split('/')[0]:''),{recursive:true});
    await rename(join(stage,'package'),destination);
    const metadata=JSON.parse(await readFile(join(destination,'package.json'),'utf8'));
    if(metadata.name!==name||metadata.version!==version)throw new Error(`Unexpected native package: ${name}`);
    await rm(archive);
  }
  await writeFile(marker,signature);
}
module.exports=beforePack;
module.exports.nativePackages=nativePackages;
