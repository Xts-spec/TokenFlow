import {readFile,mkdir,writeFile,readdir,access} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {homedir} from 'node:os';

// Build output only: never copy the developer's profile or repository wholesale.
const pkg=JSON.parse(await readFile('package.json','utf8'));
const version=pkg.build.buildVersion;
const output=resolve('release',`v${version}`);
await mkdir(output,{recursive:true});
for(const [platform,arch] of [['darwin','arm64'],['darwin','x64'],['win32','x64']]){
  const spec=`${platform}-${arch}`;
  if(process.argv.length>2&&!process.argv.slice(2).includes(spec))continue;
  const electronVersion=JSON.parse(await readFile('node_modules/electron/package.json','utf8')).version;
  const cache=resolve(homedir(),'Library/Caches/electron');
  let electronDist;
  for(const folder of await readdir(cache).catch(()=>[])){
    const candidate=resolve(cache,folder,`electron-v${electronVersion}-${spec}.zip`);
    try{await access(candidate);electronDist=candidate;break;}catch{}
  }
  const config={...pkg.build,
    ...(electronDist?{electronDist}:{}),
    artifactName:`token-flow-v${version}-${platform==='darwin'?'mac':'windows'}-${arch}.zip`,
    directories:{...pkg.build.directories,output:resolve(output,spec)},
    extraResources:pkg.build.extraResources.map(resource=>resource.from==='sidecars'
      ?{from:`sidecars/${spec}`,to:`sidecars/${spec}`,filter:[platform==='win32'?'cliproxyapi.exe':'cliproxyapi']}
      :{...resource,filter:['**/*','!**/.DS_Store']}),
  };
  const configPath=resolve(output,`${spec}.json`);
  await writeFile(configPath,JSON.stringify(config,null,2)+'\n');
  const result=spawnSync('npx',['electron-builder','--config',configPath,platform==='darwin'?'--mac':'--win','--dir',`--${arch}`,'--publish','never'],{stdio:'inherit'});
  if(result.status!==0)process.exit(result.status??1);
  const bundleDir=resolve(output,spec,platform==='darwin'?(arch==='arm64'?'mac-arm64':'mac'):'win-unpacked');
  const zip=spawnSync('zip',['-q','-r','-y','-1',resolve(output,spec,config.artifactName),platform==='darwin'?`${pkg.build.productName}.app`:'.'],{cwd:bundleDir,stdio:'inherit'});
  if(zip.status!==0)process.exit(zip.status??1);
}
console.log(`Release archives created in ${output}`);
