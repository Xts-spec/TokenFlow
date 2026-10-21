import {afterEach,expect,it,vi} from 'vitest';
import {mkdir,mkdtemp,readFile,realpath,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,parse,sep} from 'node:path';
import {FileCleanup,type FileCleanupOptions} from '../packages/core/src/file-cleanup.js';
import {createServer} from '../packages/core/src/server.js';
import {registerFileCleanup} from '../packages/core/src/file-cleanup-routes.js';

const dispose:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const close of dispose.splice(0).reverse())await close();});
// The catalog resolves the npm cache from %LOCALAPPDATA%\npm-cache on Windows and ~/.npm elsewhere,
// so a fixture that always writes .npm can never match on Windows. Follow the host platform.
const npmCacheDir=process.platform==='win32'?'AppData/Local/npm-cache':'.npm';
async function fixture(extra:FileCleanupOptions={}){
 const root=await realpath(await mkdtemp(join(tmpdir(),'tf-full-scan-')));dispose.push(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'home'),disk=join(root,'disk');await mkdir(home);await mkdir(disk);
 const put=async(path:string,text='fixture')=>{const file=join(disk,path);await mkdir(dirname(file),{recursive:true});await writeFile(file,text);return file;};
 const options={home,env:{},applicationRoots:[],diskRoots:async()=>[disk],...extra};
 const cleanup=new FileCleanup(join(root,'profile'),options);dispose.push(()=>cleanup.close());
 return {root,home,disk,put,options,cleanup};
}

it('finds deep dependencies, other-user caches and packaged files across all selected disks',async()=>{
 const {cleanup,put,disk}=await fixture();
 const dependency=await put('work/a/b/c/d/e/f/g/h/project/node_modules/dependency.bin','deps');
 const npm=await put(`Users/second/${npmCacheDir}/_cacache/cache.bin`,'npm');
 const history=await put('Users/second/.codex/sessions/history.bin','history');
 const build=await put('work/project/release/nested/Tool-2.0.zip','package');
 const python=await put('work/python/.venv/pyvenv.cfg','venv');
 const source=await put('work/project/src/main.ts','source');const document=await put('Documents/report.pdf','document');const photos=await put('Photos/photos.zip','photos');
 await cleanup.configureScope('all');expect(cleanup.snapshot()).toMatchObject({scanScope:'all',diskRoots:[disk],status:'idle'});
 cleanup.start();await cleanup.settled();const state=cleanup.snapshot();expect(state.status).toBe('complete');expect(state.walkedDirectories).toBeGreaterThan(6);
 for(const file of [dependency,npm,history,build,python])expect(state.entries.some(entry=>file===entry.path||file.startsWith(entry.path+sep))).toBe(true);
 expect(state.entries.find(entry=>history.startsWith(entry.path))?.risk).toBe('protected');
 expect(state.entries.find(entry=>npm.startsWith(entry.path))?.risk).toBe('rebuildable');
 expect(state.entries.find(entry=>dependency.startsWith(entry.path))?.risk).toBe('review');
 for(const file of [source,document,photos])expect(state.entries.some(entry=>file===entry.path||file.startsWith(entry.path+sep))).toBe(false);
 for(const entry of state.entries)expect(state.locations.some(location=>location.path===entry.path)).toBe(true);
});

it('scans custom home/disk locations without requiring a project folder',async()=>{
 let selected='';const {cleanup,home,disk,put}=await fixture({pickDirectory:async()=>selected});
 const dependency=await put('deep/old-project/node_modules/dependency.bin');
 selected=home;await cleanup.addProjectRoot();expect(cleanup.snapshot().projectRoots).toEqual([home]);
 selected=disk;await cleanup.addProjectRoot();cleanup.start();await cleanup.settled();expect(cleanup.snapshot().entries.some(entry=>dependency.startsWith(entry.path))).toBe(true);
 selected=parse(disk).root;await cleanup.addProjectRoot();expect(cleanup.snapshot().projectRoots).toEqual([selected]);expect(cleanup.snapshot().status).toBe('idle');
 // The real filesystem root was selected only to verify acceptance, never scanned.
});

it('never follows symlinks or junctions and excludes its own app data and source-control files',async()=>{
 const {cleanup,disk,root,put}=await fixture();
 const outside=join(root,'outside');await mkdir(join(outside,'node_modules'),{recursive:true});await writeFile(join(outside,'node_modules','private.bin'),'private');
 await symlink(outside,join(disk,'redirect'),process.platform==='win32'?'junction':'dir');
 await mkdir(join(root,'profile','node_modules'),{recursive:true});await writeFile(join(root,'profile','node_modules','private.bin'),'profile');
 await put('repo/.git/node_modules/private.bin','git');await put('repo/src/source.ts','source');
 await cleanup.configureScope('all');cleanup.start();await cleanup.settled();expect(cleanup.snapshot().entries).toEqual([]);
 expect(await readFile(join(outside,'node_modules','private.bin'),'utf8')).toBe('private');
});

it('invalidates prior cleanup selections when the scope changes and refuses arbitrary disk paths at the API boundary',async()=>{
 const {root,options,put,disk}=await fixture();await put('work/project/node_modules/dependency.bin');
 const app=createServer(),cleanup=registerFileCleanup(app,join(root,'profile'),{...options,trashItem:async()=>{}});dispose.push(()=>app.close());
 const setScope=(payload:object)=>app.inject({method:'POST',url:'/api/file-cleanup/scope',payload});
 expect((await setScope({scope:'all',roots:['/']})).statusCode).toBe(400);
 expect((await setScope({scope:'all'})).json().diskRoots).toEqual([disk]);cleanup.start();await cleanup.settled();const prior=cleanup.snapshot();expect(prior.entries).toHaveLength(1);
 expect((await setScope({scope:'common'})).json()).toMatchObject({status:'idle',scanScope:'common',diskRoots:[],entries:[]});
 expect(()=>cleanup.clean(prior.scanId!,[prior.entries[0].id],true)).toThrow('失效');
});

it('reports incomplete disk coverage on limits and allows cancellation without enabling cleanup',async()=>{
 const {cleanup,put}=await fixture({maxDiscoveryDirectories:1});await put('deep/project/node_modules/dependency.bin');
 await cleanup.configureScope('all');cleanup.start();await cleanup.settled();expect(cleanup.snapshot().warnings.join(' ')).toContain('不覆盖所有位置');
 expect(cleanup.snapshot().walkedDirectories).toBe(1);
 cleanup.start();expect(()=>cleanup.removeProjectRoot(0)).toThrow('请等待');cleanup.cancel();await cleanup.settled();expect(cleanup.snapshot().status).toBe('cancelled');
});

it('keeps recycle-bin contents out of results on Windows and Linux',async()=>{
 for(const platform of ['win32','linux'] as const){
  const {cleanup,put}=await fixture({platform});
  await put('$RECYCLE.BIN/S-1-5-21/project/node_modules/dependency.bin');
  await put('user/.local/share/Trash/files/Tool.deb');await put('mount/.Trash-1000/files/Tool.deb');
  // Windows ignores its reserved recycle directory; Linux ignores desktop Trash.
  await cleanup.configureScope('all');cleanup.start();await cleanup.settled();const entries=cleanup.snapshot().entries;
  if(platform==='win32')expect(entries.some(entry=>entry.path.includes('$RECYCLE.BIN'))).toBe(false);
  else expect(entries.some(entry=>entry.path.includes('/Trash/')||entry.path.includes('/.Trash-1000/'))).toBe(false);
 }
});

it('cleans only verified full-scan candidates and retains unrelated personal files',async()=>{
 const trashItem=vi.fn(async(_path:string)=>{}),{cleanup,put}=await fixture({trashItem,deleteItem:async path=>rm(path,{recursive:true})});
 const cache=await put(`user/${npmCacheDir}/_cacache/cache.bin`,'cache'),installer=await put('projects/release/Tool.zip','installer'),personal=await put('Documents/notes.txt','personal');
 await cleanup.configureScope('all');cleanup.start();await cleanup.settled();const state=cleanup.snapshot();
 const selected=state.entries.find(entry=>cache.startsWith(entry.path))!,artifact=state.entries.find(entry=>entry.path===installer)!;
 cleanup.clean(state.scanId!,[selected.id],false);await cleanup.settled();expect(trashItem).toHaveBeenCalledExactlyOnceWith(selected.path);
 expect(()=>cleanup.clean(state.scanId!,[artifact.id],true,'delete')).toThrow('人工确认');
 cleanup.clean(state.scanId!,[artifact.id],true,'delete',true);await cleanup.settled();expect(cleanup.snapshot().result).toMatchObject({deleted:1,failed:0});
 expect(await readFile(personal,'utf8')).toBe('personal');
});

it('classifies global node dependencies as protected shared storage',async()=>{
 const {cleanup,put}=await fixture();const shared=await put('usr/local/lib/node_modules/tool/index.js');
 await cleanup.configureScope('all');cleanup.start();await cleanup.settled();
 expect(cleanup.snapshot().entries.find(entry=>shared.startsWith(entry.path))).toMatchObject({risk:'protected',category:'package'});
});
