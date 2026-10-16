import {afterEach,expect,it,vi} from 'vitest';
import {lstat,mkdir,mkdtemp,readFile,realpath,rename,rm,symlink,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {FileCleanup} from '../packages/core/src/file-cleanup.js';
import {desktopCleanupFiles} from '../apps/desktop/src/file-cleanup.js';
import {registerFileCleanup} from '../packages/core/src/file-cleanup-routes.js';
import {createServer} from '../packages/core/src/server.js';

const disposals:(()=>Promise<unknown>)[]=[];
afterEach(async()=>{for(const dispose of disposals.splice(0).reverse())await dispose();});
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'tf-cleanup-native-')));disposals.push(()=>rm(root,{recursive:true,force:true}));
 const home=join(root,'用户 Home'),profile=join(root,'profile'),project=join(home,'项目 Project');await mkdir(home);await mkdir(profile);await mkdir(project);
 const put=async(path:string,content='fixture')=>{await mkdir(dirname(path),{recursive:true});await writeFile(path,content);return path;};
 const folders={downloads:join(root,'重定向 Downloads'),desktop:join(root,'重定向 Desktop')};for(const path of Object.values(folders))await mkdir(path);
 const shell={trashItem:vi.fn(async(_path:string)=>{}),showItemInFolder:vi.fn()};
 const native=desktopCleanupFiles({getPath:name=>folders[name]},shell);
 const options={home,env:{XDG_CACHE_HOME:join(home,'xdg-cache'),XDG_CONFIG_HOME:join(home,'xdg-config'),XDG_DATA_HOME:join(home,'xdg-data')},applicationRoots:[],pickDirectory:async()=>project,...native};
 return {root,home,project,profile,put,folders,shell,native,options};
}

it('keeps cleanup available if optional Linux desktop folders are missing',()=>{
 const native=desktopCleanupFiles({getPath:()=>{throw Error('Known Folder unavailable');}},{trashItem:async()=>{},showItemInFolder:()=>{}});
 expect(native.userFolders).toEqual({downloads:undefined,desktop:undefined});expect(native.trashItem).toBeTypeOf('function');expect(native.deleteItem).toBeTypeOf('function');
});

it('uses native separators for OS trash/reveal and never falls back to permanent deletion',async()=>{
 const {root,put,shell,native}=await fixture();const file=await put(join(root,'cache','缓存.bin'),'keep');
 const mixed=file.replaceAll('\\','/');await native.reveal!(mixed);expect(shell.showItemInFolder).toHaveBeenCalledWith(resolve(file));
 shell.trashItem.mockRejectedValueOnce(Error('no recycle bin'));
 await expect(native.trashItem!(mixed)).rejects.toThrow('no recycle bin');expect(shell.trashItem).toHaveBeenCalledWith(resolve(file));expect(await readFile(file,'utf8')).toBe('keep');
});

it('reports a missing or unavailable OS Trash without deleting the selected files',async()=>{
 const {profile,put,options,shell,native}=await fixture();
 const deleteItem=vi.fn(native.deleteItem!);shell.trashItem.mockRejectedValue(Error('OS Trash unavailable'));
 const cleanup=new FileCleanup(profile,{...options,deleteItem});disposals.push(()=>cleanup.close());
 const cachePath=cleanup.snapshot().locations.find(location=>location.name==='npm 下载缓存')!.path;
 const file=await put(join(cachePath,'keep.bin'),'keep');cleanup.start();await cleanup.settled();const state=cleanup.snapshot();
 cleanup.clean(state.scanId!,[state.entries.find(entry=>entry.path===cachePath)!.id],false);await cleanup.settled();
 expect(cleanup.snapshot().result).toMatchObject({moved:0,deleted:0,failed:1});expect(deleteItem).not.toHaveBeenCalled();
 expect(await readFile(file,'utf8')).toBe('keep');expect(cleanup.snapshot().entries.find(entry=>entry.path===cachePath)?.issue).toContain('未自动改为永久删除');
});

it('scans the native OS, selected project and redirected folders, then validates all cleanup flows through the API',async()=>{
 const {root,project,profile,put,folders,shell,options}=await fixture();
 const app=createServer(),cleanup=registerFileCleanup(app,profile,options);disposals.push(()=>app.close());
 const initial=(await app.inject('/api/file-cleanup')).json();expect(initial.platform).toBe(process.platform);
 const pathFor=(name:string)=>initial.locations.find((location:{name:string})=>location.name===name)!.path as string;
 const cachePath=pathFor('npm 下载缓存'),npxPath=pathFor('npx 临时依赖'),protectedPath=pathFor('Codex 历史会话');
 await put(join(cachePath,'cache.bin'),'cache');await put(join(npxPath,'tool.bin'),'npx');await put(join(protectedPath,'history.bin'),'history');
 const installer=await put(join(folders.downloads,process.platform==='win32'?'工具.msi':process.platform==='darwin'?'工具.dmg':'工具.deb'),'installer');
 const source=await put(join(project,'source.ts'),'source');await put(join(project,'node_modules','dependency.bin'),'dependency');
 const output=await put(join(project,'dist',process.platform==='win32'?'Tool-1.0.exe':process.platform==='linux'?'Tool-1.0.AppImage':'Tool-1.0.dmg'),'built');
 const api=async(route:string,body:Record<string,unknown>)=>app.inject({method:'POST',url:`/api/file-cleanup/${route}`,payload:body});
 expect((await api('project-roots',{})).statusCode).toBe(200);
 await api('scan',{});await cleanup.settled();let state=cleanup.snapshot();
 expect(state.entries.find(entry=>entry.path===cachePath)).toMatchObject({complete:true,risk:'rebuildable',bytes:5});
 expect(state.entries.find(entry=>entry.path===installer)).toMatchObject({complete:true,risk:'review'});
 expect(state.projectRoots).toEqual([project]);expect(state.entries.some(entry=>entry.category==='project')).toBe(true);
 expect(state.entries.find(entry=>entry.path===output)).toMatchObject({complete:true,risk:'review',category:'artifact'});
 for(const entry of state.entries)expect(state.locations.some(location=>location.path===entry.path)).toBe(true);
 const cache=state.entries.find(entry=>entry.path===cachePath)!,runtime=state.entries.find(entry=>entry.path===npxPath)!,protectedEntry=state.entries.find(entry=>entry.path===protectedPath)!;
 const request=(ids:string[],extra:object={})=>({scanId:state.scanId,ids,method:'trash',...extra});
 expect((await api('clean',request([protectedEntry.id]))).statusCode).toBe(400);
 const packaged=state.entries.find(entry=>entry.path===installer)!;expect((await api('clean',request([packaged.id]))).statusCode).toBe(400);
 expect((await api('clean',request([runtime.id],{method:'delete'}))).statusCode).toBe(400);
 const recovered=join(root,'mock-recycle-bin');await mkdir(recovered);shell.trashItem.mockImplementation(async path=>{await rename(path,join(recovered,'npm-cache'));});
 expect((await api('clean',request([cache.id]))).statusCode).toBe(200);await cleanup.settled();
 expect(cleanup.snapshot().result).toMatchObject({moved:1,deleted:0,failed:0});expect(await readFile(join(recovered,'npm-cache','cache.bin'),'utf8')).toBe('cache');
 expect((await api('clean',request([runtime.id],{method:'delete',confirmPermanent:true}))).statusCode).toBe(200);await cleanup.settled();
 await expect(lstat(npxPath)).rejects.toMatchObject({code:'ENOENT'});expect(await readFile(source,'utf8')).toBe('source');expect(await readFile(join(protectedPath,'history.bin'),'utf8')).toBe('history');
 await api('scan',{});await cleanup.settled();state=cleanup.snapshot();const changed=state.entries.find(entry=>entry.path===protectedPath)!;
 await put(join(protectedPath,'new.bin'),'new');expect((await api('clean',request([changed.id],{confirmProtected:true}))).statusCode).toBe(200);await cleanup.settled();
 expect(cleanup.snapshot().result).toMatchObject({failed:1,moved:0});expect(shell.trashItem).toHaveBeenCalledTimes(1);
});

it('does not follow native Windows junctions or POSIX symlink directories during scanning or cleanup',async()=>{
 const {root,home,profile,put,options,shell}=await fixture();const cleanup=new FileCleanup(profile,options);disposals.push(()=>cleanup.close());
 const cachePath=cleanup.snapshot().locations.find(location=>location.name==='npm 下载缓存')!.path;
 const outside=await put(join(root,'outside','private.bin'),'outside');
 await mkdir(cachePath,{recursive:true});await symlink(dirname(outside),join(cachePath,'redirect'),process.platform==='win32'?'junction':'dir');
 await put(join(cachePath,'cache.bin'),'cache');cleanup.start();await cleanup.settled();let state=cleanup.snapshot();
 const cache=state.entries.find(entry=>entry.path===cachePath)!;expect(cache.bytes).toBe(5);
 await rename(cachePath,`${cachePath}-original`);await symlink(dirname(outside),cachePath,process.platform==='win32'?'junction':'dir');
 cleanup.clean(state.scanId!,[cache.id],false);await cleanup.settled();expect(cleanup.snapshot().result?.failed).toBe(1);expect(shell.trashItem).not.toHaveBeenCalled();
 expect(await readFile(outside,'utf8')).toBe('outside');
});
