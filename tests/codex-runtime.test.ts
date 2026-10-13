import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeLaunch} from '../packages/core/src/codex-runtime';

it('starts an npm Codex shim on Windows through its Node entry instead of a batch file',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'codex-shim-'));
 try{
  await mkdir(join(dir,'node_modules/@openai/codex/bin'),{recursive:true});await writeFile(join(dir,'node_modules/@openai/codex/bin/codex.js'),'');
  expect(await runtimeLaunch(join(dir,'codex.cmd'),'win32')).toEqual({file:process.execPath,args:[join(dir,'node_modules/@openai/codex/bin/codex.js')],env:{ELECTRON_RUN_AS_NODE:'1'}});
  await expect(runtimeLaunch(join(dir,'other','codex.cmd'),'win32')).rejects.toThrow('codex.cmd');
  expect(await runtimeLaunch('C:\\Codex\\codex.exe','win32')).toEqual({file:'C:\\Codex\\codex.exe',args:[],env:{}});
  expect(await runtimeLaunch('/usr/local/bin/codex','darwin')).toEqual({file:'/usr/local/bin/codex',args:[],env:{}});
 }finally{await rm(dir,{recursive:true,force:true});}
});
