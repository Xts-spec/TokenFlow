import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {artifactLocations,discoverCleanupArtifacts} from '../packages/core/src/file-cleanup-artifacts';

const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'tf-artifacts-')));roots.push(root);
 const home=join(root,'home');await mkdir(home);
 const put=async(path:string,content='private-app-data')=>{const full=join(home,path);await mkdir(join(full,'..'),{recursive:true});await writeFile(full,content);return full;};
 const options={home,platform:'darwin' as NodeJS.Platform,applicationRoots:[] as string[],profile:join(home,'profile'),executablePath:join(root,'running-app'),signal:new AbortController().signal,deadline:Date.now()+60000};
 return {home,root,put,options};
}

it('finds app copies without claiming content equality and flags installed or running apps as protected',async()=>{
 const {home,put,options}=await fixture();
 await put('Applications/Editor.app/Contents/MacOS/Editor','original');
 await put('Applications/Solo.app/Contents/MacOS/Solo');
 const copy=await put('Downloads/Editor (2).app/Contents/MacOS/Editor','a-different-version');
 await put('Downloads/Running.app/Contents/MacOS/Running');
 await put('Downloads/notes.txt');await put('Downloads/photos.zip');
 const result=await discoverCleanupArtifacts({...options,applicationRoots:[join(home,'Applications')],executablePath:join(home,'Downloads','Running.app','Contents','MacOS','Running')});
 expect(result.rules.find(rule=>rule.path===join(home,'Applications','Editor.app'))?.risk).toBe('protected');
 expect(result.rules.find(rule=>rule.path===join(home,'Downloads','Editor (2).app'))).toMatchObject({risk:'review',category:'artifact',description:expect.stringContaining('未比较文件内容')});
 expect(result.rules.find(rule=>rule.path===join(home,'Downloads','Running.app'))?.risk).toBe('protected');
 expect(result.rules.some(rule=>rule.path.endsWith('Solo.app')||rule.path.endsWith('notes.txt')||rule.path.endsWith('photos.zip'))).toBe(false);
 expect(JSON.stringify(result)).not.toContain('a-different-version');expect(copy).toContain('Editor (2).app');
});

it('finds individual packaged versions, never the whole output folder or source tree',async()=>{
 const {home,put,options}=await fixture();
 await put('project/release/v1/mac/Editor-1.0.0.app/Contents/bin');
 await put('project/release/v2/Editor-2.0.0.dmg');
 await put('project/release/Editor-win32-x64.zip');
 await put('project/release/source.ts');
 const output=join(home,'project','release'),result=await discoverCleanupArtifacts({...options,outputRoots:[output]});
 expect(result.rules).toHaveLength(3);expect(result.rules.every(rule=>rule.category==='artifact'&&rule.risk==='review')).toBe(true);
 expect(result.rules.some(rule=>rule.path===output||rule.path.endsWith('source.ts'))).toBe(false);
});

it('does not follow symlinked apps or discovery directories, and protects profile containers',async()=>{
 const {home,root,put,options}=await fixture();await put('Downloads/Real.app/Contents/config');
 await mkdir(join(root,'outside.app'));await writeFile(join(root,'outside.app','private'),'outside');
 await symlink(join(root,'outside.app'),join(home,'Downloads','Linked.app'));
 await symlink(join(home,'Downloads'),join(home,'Desktop'));
 const result=await discoverCleanupArtifacts({...options,profile:join(home,'Downloads','Real.app','Contents')});
 expect(result.rules).toHaveLength(1);expect(result.rules[0]).toMatchObject({risk:'protected',path:join(home,'Downloads','Real.app')});
});

it('recognizes Windows and Linux installers while keeping ordinary personal archives out',async()=>{
 for(const platform of ['win32','linux'] as const){
  const {put,options}=await fixture();
  for(const name of ['ToolSetup.exe','Tool-2.1-x64.zip','Tool.msi','Tool.AppImage','Tool.deb','photos.zip'])await put(`Downloads/${name}`);
  const result=await discoverCleanupArtifacts({...options,platform});
  expect(result.rules).toHaveLength(5);expect(result.rules.every(rule=>rule.risk==='review')).toBe(true);
 }
 const locations=artifactLocations('/home','win32',{LOCALAPPDATA:'/local',ProgramFiles:'/programs'});
 expect(locations.map(location=>location.path)).toContain('/local/Programs');expect(locations.map(location=>location.path)).toContain('/programs');
});

it('bounds discovery and respects cancellation',async()=>{
 const {put,options}=await fixture();for(let i=0;i<8;i++)await put(`Downloads/Tool-${i}.dmg`);
 const result=await discoverCleanupArtifacts({...options,maxEntries:4});expect(result.warnings.join(' ')).toContain('停止发现');
 const controller=new AbortController();controller.abort();await expect(discoverCleanupArtifacts({...options,signal:controller.signal})).rejects.toBeDefined();
});
