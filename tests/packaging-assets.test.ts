import {it,expect} from 'vitest';
import {createRequire} from 'node:module';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const require=createRequire(import.meta.url);
const {brandMacHelpers,pruneSdkPlatforms,verifyNativeTargets}=require('../scripts/after-pack.cjs');
const plist=require('plist');
const {nativePackages}=require('../scripts/before-pack.cjs');

it('rejects a Windows bundle containing host Mac native dependencies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-native-guard-')),modules=join(root,'app.asar.unpacked/node_modules');
 try{
  for(const name of ['@cursor/sdk-win32-x64']){
   await mkdir(join(modules,name),{recursive:true});await writeFile(join(modules,name,'package.json'),'{}');
  }
  await expect(verifyNativeTargets(root,'win32','x64')).resolves.toBeUndefined();
  await mkdir(join(modules,'@cursor/sdk-darwin-arm64'));
  await expect(verifyNativeTargets(root,'win32','x64')).rejects.toThrow('Wrong native packages');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('resolves native packages from the target and requires locked integrity',()=>{
 const lock={packages:{
  'node_modules/@cursor/sdk-win32-x64':{version:'1.0.31',integrity:'sha512-cursor'},
  'node_modules/@esbuild/win32-x64':{version:'0.27.7',integrity:'sha512-native'},
  'node_modules/esbuild':{version:'0.27.7',integrity:'sha512-wrapper'},
 }};
 expect(nativePackages(lock,'win32','x64').map((entry:{name:string})=>entry.name)).toEqual(['@cursor/sdk-win32-x64']);
 expect(()=>nativePackages(lock,'darwin','arm64')).toThrow('Missing locked native package');
 expect(()=>nativePackages({packages:{'node_modules/@cursor/sdk-win32-x64':{version:'1.0.31'}}},'win32','x64')).toThrow('Missing locked native package');
});

it('brands every macOS helper without changing its executable or identity',async()=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-icons-'));
 try{
  await mkdir(join(root,'Resources'),{recursive:true});
  await writeFile(join(root,'Resources','icon.icns'),'fixture icon');
  await writeFile(join(root,'Info.plist'),plist.build({CFBundleIconFile:'icon.icns'}));
  for(const suffix of ['',' (Renderer)',' (GPU)',' (Plugin)']){
   const dir=join(root,'Frameworks',`TokenFlow Helper${suffix}.app`,'Contents');await mkdir(dir,{recursive:true});
   await writeFile(join(dir,'Info.plist'),plist.build({CFBundleName:`Electron Helper${suffix}`,CFBundleIdentifier:`existing.helper${suffix}`,CFBundleExecutable:`TokenFlow Helper${suffix}`}));
  }
  await brandMacHelpers(root,'TokenFlow');
  for(const suffix of ['',' (Renderer)',' (GPU)',' (Plugin)']){
   const dir=join(root,'Frameworks',`TokenFlow Helper${suffix}.app`,'Contents');const info=plist.parse(await readFile(join(dir,'Info.plist'),'utf8'));
   expect(info).toMatchObject({CFBundleName:`TokenFlow Helper${suffix}`,CFBundleDisplayName:`TokenFlow Helper${suffix}`,CFBundleIconFile:'icon.icns',CFBundleExecutable:`TokenFlow Helper${suffix}`,CFBundleIdentifier:`existing.helper${suffix}`});
   expect(await readFile(join(dir,'Resources','icon.icns'),'utf8')).toBe('fixture icon');
  }
 }finally{await rm(root,{recursive:true,force:true});}
});

it.each([['darwin','arm64'],['darwin','x64'],['win32','x64'],['linux','arm64'],['linux','x64']])('keeps only %s-%s CLI binaries and preserves shared runtime assets',async(platform,arch)=>{
 const root=await mkdtemp(join(tmpdir(),'tokenflow-sdk-platform-'));const vendor=join(root,'app.asar.unpacked/node_modules/@tencent-ai/agent-sdk/cli/vendor');
 try{
  for(const name of ['arm64-darwin','x64-darwin','arm64-linux','x64-linux','x64-win32'])await mkdir(join(vendor,'ripgrep',name),{recursive:true});
  await writeFile(join(vendor,'ripgrep','COPYING'),'license');
  await mkdir(join(vendor,'genie-trash'));
  for(const name of ['darwin-arm64','darwin-x64','linux-arm64','linux-x64','win32-x64.exe'])await writeFile(join(vendor,'genie-trash',name),'native');
  for(const name of ['assets','shim','toybox-macos','zsh-macos'])await mkdir(join(vendor,name));
  await pruneSdkPlatforms(root,platform,arch);
  expect((await readdir(join(vendor,'ripgrep'))).sort()).toEqual(['COPYING',`${arch}-${platform}`].sort());
  expect(await readdir(join(vendor,'genie-trash'))).toEqual([`${platform}-${arch}${platform==='win32'?'.exe':''}`]);
  const shared=await readdir(vendor);expect(shared).toContain('assets');expect(shared).toContain('shim');expect(shared.includes('zsh-macos')).toBe(platform==='darwin');
 }finally{await rm(root,{recursive:true,force:true});}
});
