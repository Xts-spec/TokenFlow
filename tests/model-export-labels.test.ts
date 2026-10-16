import { expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { modelLabel } from '../packages/core/src/model-label.js';
import { qualifiedModelLabel } from '../apps/console/src/model-label';
import { connectedConfig } from '../packages/core/src/agent-connections.js';
import { codexModelCatalog } from '../packages/core/src/codex-model-catalog.js';
const source={id:'a'.repeat(24),name:'🍋 公司接口'},id=`api-${source.id}/company/model-v2`,expected='🍋 公司接口 · company/model-v2';
it('resolves saved API source names consistently even when the live catalog is empty or stale',()=>{
 expect(modelLabel([],id,[source])).toBe(expected);
 expect(modelLabel([{id,provider:'api',displayName:'outdated'}],id,[source])).toBe(expected);
 expect(modelLabel([],id,[{...source,name:'新名称'}])).toBe('新名称 · company/model-v2');
 expect(qualifiedModelLabel({models:[],apiSources:[source]},id)).toBe(expected);
});
it.each(['claude','codex','qoder','workbuddy','pi','deepseek'] as const)('exports the platform label to %s while retaining the routing ID',target=>{
 const label=modelLabel([],id,[source]),labels={[id]:label};
 const text=connectedConfig(target,null,'http://127.0.0.1:9527',id,'fixture-key','/fixture/catalog.json',[id],labels);
 const config=target==='codex'?codexModelCatalog([id],labels):target==='deepseek'?parseYaml(text):JSON.parse(text);
 const entry=target==='codex'?config.models[0]:target==='claude'?config.modelPicker.options[0]:target==='qoder'?config.providers['token-flow'].models[0]:target==='pi'?config.providers['token-flow'].models[0]:target==='deepseek'?config.find((e:{id:string})=>e.id==='llm-pi-ai').config.providers['token-flow'].models[0]:config[0];
 expect(entry.display_name??entry.label??entry.displayName??entry.name).toBe(expected);
 expect(entry.slug??entry.model??entry.id).toBe(id);
});
