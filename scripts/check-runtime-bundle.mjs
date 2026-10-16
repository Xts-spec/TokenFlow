import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {isBuiltin} from 'node:module';

// Audit the build graph rather than guessing which transitive packages are used.
const root=resolve(import.meta.dirname,'..');
const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));
const meta=JSON.parse(await readFile(join(root,'dist/metafile-esm.json'),'utf8'));
const nameOf=specifier=>specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
const externals=new Set();
for(const output of Object.values(meta.outputs))for(const entry of output.imports){
 if(!entry.external||isBuiltin(entry.path)||entry.path==='electron')continue;
 if(!manifest.dependencies[nameOf(entry.path)])throw new Error(`Unpackaged runtime import: ${entry.path}`);
 externals.add(entry.path);
}
const retained=new Map();
for(const output of Object.values(meta.outputs))for(const [input,info] of Object.entries(output.inputs)){
 if(!info.bytesInOutput||!input.includes('node_modules/'))continue;
 let directory=dirname(resolve(root,input));
 while(directory!==root&&directory!==dirname(directory)){
  try{
   const pkg=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
   if(pkg.name){const item=retained.get(directory)??{name:pkg.name,version:pkg.version,bytes:0,license:pkg.license};item.bytes+=info.bytesInOutput;retained.set(directory,item);break;}
  }catch(error){if(error.code!=='ENOENT')throw error;}
  directory=dirname(directory);
 }
}
const licenses=[];
for(const [directory,pkg] of [...retained].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
 const names=(await readdir(directory)).filter(name=>/^(licen[cs]e|copying|notice)(\.|$|-)/i.test(name));
 const fallback=pkg.name.startsWith('@earendil-works/')?'Pi-LICENSE.txt':pkg.name==='typebox'?'TypeBox-LICENSE.txt':undefined;
 if(!names.length&&!fallback)throw new Error(`Missing bundled dependency license: ${pkg.name}`);
 const texts=names.length?await Promise.all(names.map(name=>readFile(join(directory,name),'utf8'))):[await readFile(join(root,'LICENSES',fallback),'utf8')];
 licenses.push(`${pkg.name}@${pkg.version}\n${texts.join('\n\n')}`);
}
await writeFile(join(root,'dist/bundled-dependencies.LICENSE.txt'),licenses.join('\n\n--------------------\n\n'));
await mkdir(join(root,'.tmp'),{recursive:true});
await writeFile(join(root,'.tmp/runtime-bundle-report.json'),JSON.stringify({externals:[...externals].sort(),bundled:[...retained.values()]},null,2)+'\n');
console.log(`Runtime bundle verified: ${retained.size} bundled packages; external SDK/plugin dependencies preserved.`);
