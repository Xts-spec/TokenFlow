import { expect,it } from 'vitest';
import { sourceOptions,sourceLabel } from '../apps/console/src/source-options';
import type { LocalAgentSnapshot } from '../packages/core/src/cliproxy';
it('shows only usable credentials, ranks by lowest remaining window, leaves unknown quota last',()=>{
 const accounts=['high','low','unknown','disabled','invalid'].map(id=>({id,provider:'codex',label:id,status:'active',disabled:id==='disabled',unavailable:id==='invalid',models:['codex/model','codex/model']}));
 const local={accounts,models:[{id:'codex/model',provider:'codex'}],quotas:{high:{status:'ok',windows:[{usedPercent:10},{usedPercent:25}]},low:{status:'ok',windows:[{usedPercent:95}]}}} as unknown as LocalAgentSnapshot;
 expect(sourceOptions(local)[0].models).toEqual(['codex/model']);
 expect(sourceOptions(local).map(a=>[a.id,a.remaining])).toEqual([['high',75],['low',5],['unknown',null]]);
});
it('shares saved API sources with the picker and includes only loaded, enabled models with readable keys',()=>{
 const local={accounts:[{id:'sdk',provider:'cursor',label:'Cursor SDK',status:'ready',disabled:false,unavailable:false,models:['cursor/shared']}],models:[{id:'api-a/shared',provider:'api'},{id:'api-b/shared',provider:'api'},{id:'cursor/shared',provider:'cursor'}],quotas:{},apiSources:[
  {id:'a',name:'API A',models:['shared','pending'],enabled:true,hasKey:true},
  {id:'b',name:'API B',models:['shared'],enabled:false,hasKey:true},
  {id:'c',name:'API C',models:['shared'],enabled:true,hasKey:false},
 ]} as unknown as LocalAgentSnapshot;
 expect(sourceOptions(local).map(s=>[s.label,s.models])).toEqual([['API A',['api-a/shared']],['Cursor SDK',['cursor/shared']]]);expect(sourceLabel(local,'a')).toBe('API A');
});
