import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {maintenanceStorage} from '../packages/core/src/maintenance-storage.js';
import type {AgentPaths} from '../packages/core/src/agent-connections.js';

it('reports resolved custom/legacy locations and metadata without reading credentials or conversation content',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'tf-storage-'));
 try{
  const root=join(dir,'旧版资料 目录'),home=join(dir,'自定义 Codex');await mkdir(root);await mkdir(join(home,'sessions'),{recursive:true});
  const paths=Object.fromEntries(['codex','claude','claude-desktop','qoder','workbuddy','pi','deepseek','cursor'].map(target=>[target,target==='codex'?join(home,'config.toml'):join(dir,target,'config.json')])) as AgentPaths;
  await writeFile(paths.codex,'secret-configuration');await writeFile(join(home,'sessions','private.jsonl'),'private-conversation');await writeFile(join(root,'usage-ledger.json'),'private-ledger');
  const info=await maintenanceStorage(root,paths);
  expect(info.platform).toBe(process.platform);expect(info.locations.find(e=>e.id==='profile')).toMatchObject({path:root,exists:true,kind:'directory'});
  expect(info.locations.find(e=>e.id==='config-codex')).toMatchObject({path:paths.codex,exists:true,kind:'file',bytes:20});
  expect(info.locations.find(e=>e.id==='codex-sessions')).toMatchObject({path:join(home,'sessions'),exists:true});
  expect(info.locations.find(e=>e.id==='local-usage')).toMatchObject({exists:false,status:'尚未生成',tool:'read_usage'});
  expect(JSON.stringify(info)).not.toMatch(/secret-configuration|private-conversation|private-ledger/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
