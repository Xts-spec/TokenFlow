import {app,shell} from 'electron';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {lstat,mkdir,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FileCleanup} from '../packages/core/src/file-cleanup.js';
import {desktopCleanupFiles} from '../apps/desktop/src/file-cleanup.js';

// A separate Electron process, an isolated profile, and disposable fixtures only.
// Never scans a real user cache or empties the operating system's Trash.
const temporary=mkdtempSync(join(tmpdir(),'tf-cleanup-os-check-'));
mkdirSync(join(temporary,'profile'));
app.setPath('userData',join(temporary,'profile'));
app.disableHardwareAcceleration();
const timeout=setTimeout(()=>{console.error('Native cleanup check timed out');app.exit(1);},45000);

void app.whenReady().then(async()=>{
 const root=await realpath(temporary),home=join(root,'用户 Home'),downloads=join(root,'下载 Downloads'),desktop=join(root,'桌面 Desktop');
 for(const path of [home,downloads,desktop])await mkdir(path);
 const native=desktopCleanupFiles(app,shell);
 const cleanup=new FileCleanup(join(root,'profile'),{...native,home,env:{},applicationRoots:[],userFolders:{downloads,desktop},executablePath:join(root,'active-app')});
 try{
  const locations=cleanup.snapshot().locations;
  const cache=locations.find(location=>location.name==='npm 下载缓存')!.path;
  const npx=locations.find(location=>location.name==='npx 临时依赖')!.path;
  const history=locations.find(location=>location.name==='Codex 历史会话')!.path;
  for(const path of [cache,npx,history]){await mkdir(path,{recursive:true});await writeFile(join(path,'fixture.bin'),'test-only');}
  const untouched=join(home,'source.txt');await writeFile(untouched,'keep');
  cleanup.start();await cleanup.settled();const state=cleanup.snapshot();
  assert.equal(state.platform,process.platform);assert.equal(state.status,'complete');
  const selected=state.entries.find(entry=>entry.path===cache)!,permanent=state.entries.find(entry=>entry.path===npx)!,protectedEntry=state.entries.find(entry=>entry.path===history)!;
  assert.equal(selected.complete,true);assert.equal(permanent.complete,true);
  assert.throws(()=>cleanup.clean(state.scanId!,[protectedEntry.id],false),/受保护/);
  assert.throws(()=>cleanup.clean(state.scanId!,[permanent.id],false,'delete'),/人工确认/);
  cleanup.clean(state.scanId!,[selected.id],false);await cleanup.settled();
  assert.equal(cleanup.snapshot().result?.moved,1);assert.equal(cleanup.snapshot().result?.failed,0);
  await assert.rejects(lstat(cache),{code:'ENOENT'});
  cleanup.clean(state.scanId!,[permanent.id],false,'delete',true);await cleanup.settled();
  assert.equal(cleanup.snapshot().result?.deleted,1);assert.equal(cleanup.snapshot().result?.failed,0);
  await assert.rejects(lstat(npx),{code:'ENOENT'});
  assert.equal(await readFile(join(history,'fixture.bin'),'utf8'),'test-only');assert.equal(await readFile(untouched,'utf8'),'keep');
  console.log(`Native cleanup passed on ${process.platform}: metadata scan, OS trash, explicit permanent deletion, protected data and unselected files.`);
 }finally{await cleanup.close();await rm(root,{recursive:true,force:true,maxRetries:2});}
}).then(()=>{clearTimeout(timeout);app.exit(0);},error=>{clearTimeout(timeout);console.error(error);app.exit(1);});
