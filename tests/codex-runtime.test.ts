import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeLaunch} from '../packages/core/src/codex-runtime';

it('starts the native npm Codex executable on Windows instead of leaving a Node wrapper process',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'codex-shim-'));
 try{
  await mkdir(join(dir,'node_modules/@openai/codex/bin'),{recursive:true});await writeFile(join(dir,'node_modules/@openai/codex/bin/codex.js'),'');
  const vendor=join(dir,'node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin');
  await mkdir(vendor,{recursive:true});const native=join(vendor,'codex.exe');await writeFile(native,'fixture');
  expect(await runtimeLaunch(join(dir,'codex.cmd'),'win32','x64')).toEqual({file:native,args:[],env:{}});
  await expect(runtimeLaunch(join(dir,'other','codex.cmd'),'win32')).rejects.toThrow('codex.cmd');
  expect(await runtimeLaunch('C:\\Codex\\codex.exe','win32')).toEqual({file:'C:\\Codex\\codex.exe',args:[],env:{}});
  expect(await runtimeLaunch('/usr/local/bin/codex','darwin')).toEqual({file:'/usr/local/bin/codex',args:[],env:{}});
 }finally{await rm(dir,{recursive:true,force:true});}
});

it.each([
 ['x64','node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin'],
 ['arm64','node_modules/@openai/codex/node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin'],
 ['x64','node_modules/@openai/codex/vendor/x86_64-pc-windows-msvc/codex'],
])('resolves the official %s npm layout %s without a shell',async(arch,vendor)=>{
 const dir=await mkdtemp(join(tmpdir(),'Codex 中文 & runtime-'));
 try{
  const path=join(dir,vendor);await mkdir(path,{recursive:true});const native=join(path,'codex.exe');await writeFile(native,'fixture');
  expect(await runtimeLaunch(join(dir,'codex.cmd'),'win32',arch as NodeJS.Architecture)).toEqual({file:native,args:[],env:{}});
 }finally{await rm(dir,{recursive:true,force:true});}
});

it('rejects an incomplete Windows npm install rather than starting its orphan-prone Node launcher',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'codex-incomplete-'));
 try{
  const bin=join(dir,'node_modules/@openai/codex/bin');await mkdir(bin,{recursive:true});await writeFile(join(bin,'codex.js'),'');
  await expect(runtimeLaunch(join(dir,'codex.cmd'),'win32')).rejects.toThrow('原生');
 }finally{await rm(dir,{recursive:true,force:true});}
});
