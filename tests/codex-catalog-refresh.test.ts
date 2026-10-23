import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'smol-toml';
import { AgentConnections } from '../packages/core/src/agent-connections.js';
import { codexModelCatalog, codexCompactionLimit, codexContextMetadata } from '../packages/core/src/codex-model-catalog.js';
import * as catalogModule from '../packages/core/src/codex-model-catalog.js';
import { modelLabel } from '../packages/core/src/model-label.js';
const roots:string[]=[];
afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const sourceId='a'.repeat(24),model=`api-${sourceId}/company/gpt`;
it('reapplies unchanged selections to replace the legacy downshift window and keeps the original config restorable',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-catalog-upgrade-'));roots.push(root);
 const configPath=join(root,'config.toml'),original='model = "gpt-6-astra"\nmodel_provider = "openai"\n';
 await writeFile(configPath,original);
 const connections=new AgentConnections(root,{codex:configPath},async()=>[]);
 const apply=async(replaceId?:string)=>connections.apply({target:'codex',revision:(await connections.status()).find(t=>t.id==='codex')!.revision,origin:'http://127.0.0.1:9527',model,sourceId,keyId:randomUUID(),key:'fixture-key',...(replaceId?{replaceId}:{})});
 const legacy=catalogModule.codexModelCatalog;
 const mock=vi.spyOn(catalogModule,'codexModelCatalog').mockImplementation((...args)=>({models:legacy(...args).models.map(m=>({...m,context_window:131072,auto_compact_token_limit:65536}))}));
 let first;try{first=await apply();}finally{mock.mockRestore();}
 const before=parse(await readFile(configPath,'utf8'));
 const second=await apply(first.id),after=parse(await readFile(configPath,'utf8'));
 expect(after.model_catalog_json).not.toBe(before.model_catalog_json);
 const entry=JSON.parse(await readFile(String(after.model_catalog_json),'utf8')).models[0];
 expect(entry.slug).toBe(model);expect(entry.context_window).toBe(272000);expect(entry.auto_compact_token_limit).toBeUndefined();
 await connections.restore(second.id);expect(await readFile(configPath,'utf8')).toBe(original);
});
it('lets Codex derive native triggers from capacity, retaining the tested small-window switch workaround',()=>{
 const catalog=codexModelCatalog(['codex/gpt-6-luna','api-example/custom','unknown/model','large/model'],{}, {'codex/gpt-6-luna':272000,'api-example/custom':64000,'large/model':1000000});
 expect(catalog.models.map(model=>model.context_window)).toEqual([272000,undefined,272000,1000000]);
 expect(catalog.models.map(model=>model.auto_compact_token_limit)).toEqual([undefined,57600,undefined,undefined]);
 expect(codexCompactionLimit(272000)).toBe(244800);expect(codexCompactionLimit(64000)).toBe(57600);
 for(const invalid of [undefined,NaN,Infinity,-1,0,1.5]){
  expect(codexCompactionLimit(invalid)).toBe(244800);expect(codexContextMetadata(invalid)).toEqual({context_window:272000});
 }
});
it('updates existing generated catalogs while preserving routing, original backups and history',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-compaction-metadata-'));roots.push(root);
 const configPath=join(root,'config.toml'),original='model = "original"\n';await writeFile(configPath,original);
 const connections=new AgentConnections(root,{codex:configPath},async()=>[]);
 const record=await connections.apply({target:'codex',revision:(await connections.status()).find(t=>t.id==='codex')!.revision,origin:'http://127.0.0.1:9527',model,sourceId,keyId:randomUUID(),key:'fixture-key'});
 const before=await readFile(configPath,'utf8'),catalogPath=String(parse(before).model_catalog_json),catalog=JSON.parse(await readFile(catalogPath,'utf8'));
 catalog.models[0].auto_compact_token_limit=65536;catalog.models[0].max_context_window=999999;await writeFile(catalogPath,JSON.stringify(catalog));
 expect(await connections.refreshCodexCompactionLimits(async()=>272000)).toEqual({updated:1,failed:0});
 const refreshed=JSON.parse(await readFile(catalogPath,'utf8'));
 expect(refreshed.models[0].context_window).toBe(272000);expect(refreshed.models[0].auto_compact_token_limit).toBeUndefined();expect(refreshed.models[0].max_context_window).toBeUndefined();
 expect(refreshed.models[0].truncation_policy.limit).toBe(Number.MAX_SAFE_INTEGER);
 expect(await readFile(configPath,'utf8')).toBe(before);
 expect((await connections.review(record.id)).checks.every(check=>check.ok)).toBe(true);
 expect(await connections.refreshCodexCompactionLimits(async()=>64000)).toEqual({updated:1,failed:0});
 const smaller=JSON.parse(await readFile(catalogPath,'utf8')).models[0];expect(smaller.auto_compact_token_limit).toBe(57600);expect(smaller.context_window).toBeUndefined();
 expect(await connections.refreshCodexCompactionLimits(async()=>64000)).toEqual({updated:0,failed:0});
 expect(await readFile(configPath,'utf8')).toBe(before);
 await connections.restore(record.id);expect(await readFile(configPath,'utf8')).toBe(original);
});
it('replaces the Codex catalog when managing unchanged models with updated names, preserving history and original settings',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'codex-catalog-refresh-'));roots.push(root);
 const configPath=join(root,'codex/config.toml'),historyPath=join(root,'codex/sessions/existing.json');await mkdir(join(root,'codex/sessions'),{recursive:true});
 const original='model = "native"\nprofile = "work"\n[profiles.work]\nmodel = "old"\napproval_policy = "untrusted"\n';
 await writeFile(configPath,original);await writeFile(historyPath,'existing conversation');
 const connections=new AgentConnections(root,{codex:configPath},async()=>[]);
 const apply=async(replaceId?:string,label=model)=>{
  const current=(await connections.status()).find(t=>t.id==='codex')!;
  return connections.apply({target:'codex',revision:current.revision,origin:'http://127.0.0.1:9527',model,sourceId,keyId:randomUUID(),key:'fixture-key',selections:[{model,sourceId}],modelLabels:{[model]:label},...(replaceId?{replaceId}:{})});
 };
 const first=await apply();const before=parse(await readFile(configPath,'utf8'));
 const second=await apply(first.id,'公司 GPT');const after=parse(await readFile(configPath,'utf8'));
 expect(after.model_catalog_json).not.toBe(before.model_catalog_json);
 const catalog=JSON.parse(await readFile(String(after.model_catalog_json),'utf8'));
 expect(catalog.models).toHaveLength(1);expect(catalog.models[0]).toMatchObject({slug:model,display_name:'公司 GPT'});
 expect(after).toMatchObject({model,profile:'work',profiles:{work:{model,model_catalog_json:after.model_catalog_json,approval_policy:'untrusted'}}});
 expect(await readFile(historyPath,'utf8')).toBe('existing conversation');
 expect((await connections.review(second.id)).checks.every(check=>check.ok)).toBe(true);
 await connections.restore(second.id);expect(await readFile(configPath,'utf8')).toBe(original);expect(await readFile(historyPath,'utf8')).toBe('existing conversation');
});
it('uses readable API names when older or temporarily unavailable models have no display metadata',()=>{
 expect(modelLabel([],model)).toBe('company/gpt');
 for(const labels of [{},{[model]:model},{[model]:'  '}])expect(codexModelCatalog([model],labels).models[0]).toMatchObject({slug:model,display_name:'company/gpt'});
 expect(codexModelCatalog([model],{[model]:'自定义名称'}).models[0].display_name).toBe('自定义名称');
 expect(modelLabel([],'qoder/kmodel_latest')).toBe('qoder/kmodel_latest');
});
