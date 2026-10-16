const {readFile,writeFile,readdir,copyFile,mkdir,rm,access}=require('node:fs/promises');
const {join}=require('node:path');
const plist=require('plist');

// Only edit the staged bundle, before electron-builder signs it.
async function brandMacHelpers(contents,productName){
  const main=plist.parse(await readFile(join(contents,'Info.plist'),'utf8'));
  const icon=join(contents,'Resources',main.CFBundleIconFile);
  const frameworks=join(contents,'Frameworks');
  for(const name of await readdir(frameworks)){
    if(!name.startsWith(`${productName} Helper`)||!name.endsWith('.app'))continue;
    const helper=join(frameworks,name,'Contents'),path=join(helper,'Info.plist');
    const info=plist.parse(await readFile(path,'utf8'));
    info.CFBundleName=name.slice(0,-4);
    info.CFBundleDisplayName=name.slice(0,-4);
    info.CFBundleIconFile='icon.icns';
    await mkdir(join(helper,'Resources'),{recursive:true});
    await copyFile(icon,join(helper,'Resources','icon.icns'));
    await writeFile(path,plist.build(info));
  }
}

async function keepPlatform(directory,keep,known){
  for(const name of await readdir(directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;})){
    if(known.includes(name)&&name!==keep)await rm(join(directory,name),{recursive:true,force:true});
  }
}

async function pruneSdkPlatforms(resources,platform,arch){
  // The official CLI ships native tools for five platforms. Keep the target's
  // tools and shared assets; never remove SDK JS, CLI entry points or licenses.
  const vendor=join(resources,'app.asar.unpacked','node_modules','@tencent-ai','agent-sdk','cli','vendor');
  await keepPlatform(join(vendor,'ripgrep'),`${arch}-${platform}`,['arm64-darwin','x64-darwin','arm64-linux','x64-linux','x64-win32']);
  await keepPlatform(join(vendor,'genie-trash'),`${platform}-${arch}${platform==='win32'?'.exe':''}`,['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-x64.exe']);
  if(platform!=='darwin')for(const name of ['toybox-macos','zsh-macos'])await rm(join(vendor,name),{recursive:true,force:true});
}

async function verifyNativeTargets(resources,platform,arch){
  const modules=join(resources,'app.asar.unpacked','node_modules');
  for(const [scope,expected,prefix] of [['@cursor',`sdk-${platform}-${arch}`,'sdk-']]){
    const names=(await readdir(join(modules,scope))).filter(name=>name.startsWith(prefix));
    if(names.length!==1||names[0]!==expected)throw new Error(`Wrong native packages for ${platform}-${arch}: ${scope}/${names.join(',')}`);
    await access(join(modules,scope,expected,'package.json'));
  }
}

async function afterPack(context){
  const platform=context.electronPlatformName;
  const arch=typeof context.arch==='number'?['ia32','x64','armv7l','arm64','universal'][context.arch]:context.arch;
  if(!['x64','arm64'].includes(arch))throw new Error(`Unsupported packaged architecture: ${arch}`);
  const contents=join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,'Contents');
  const resources=platform==='darwin'?join(contents,'Resources'):join(context.appOutDir,'resources');
  await verifyNativeTargets(resources,platform,arch);
  await pruneSdkPlatforms(resources,platform,arch);
  if(platform==='darwin')await brandMacHelpers(contents,context.packager.appInfo.productFilename);
}
module.exports=afterPack;
module.exports.brandMacHelpers=brandMacHelpers;
module.exports.pruneSdkPlatforms=pruneSdkPlatforms;
module.exports.verifyNativeTargets=verifyNativeTargets;
