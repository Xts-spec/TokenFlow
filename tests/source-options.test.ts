import { expect,it } from 'vitest';
import { sourceOptions,sourceLabel,sourceSelectionState,sourceSelectionNotice } from '../apps/console/src/source-options';
import type { LocalAgentSnapshot } from '../packages/core/src/cliproxy';
it('shows only usable credentials, ranks by lowest remaining window, leaves unknown quota last',()=>{
 const accounts=['high','low','unknown','disabled','invalid'].map(id=>({id,provider:'codex',label:id,status:'active',disabled:id==='disabled',unavailable:id==='invalid',models:['codex/model','codex/model']}));
 const local={accounts,models:[{id:'codex/model',provider:'codex'}],quotas:{high:{status:'ok',windows:[{usedPercent:10},{usedPercent:25}]},low:{status:'ok',windows:[{usedPercent:95}]}}} as unknown as LocalAgentSnapshot;
 expect(sourceOptions(local)[0].models).toEqual(['codex/model']);
 expect(sourceOptions(local).map(a=>[a.id,a.remaining])).toEqual([['high',75],['low',5],['unknown',null]]);
});
it('keeps saved API models in the picker during catalog reload and excludes disabled or unreadable sources',()=>{
 const local={accounts:[{id:'sdk',provider:'cursor',label:'Cursor SDK',status:'ready',disabled:false,unavailable:false,models:['cursor/shared']}],models:[{id:'api-a/shared',provider:'api'},{id:'api-b/shared',provider:'api'},{id:'cursor/shared',provider:'cursor'}],quotas:{},apiSources:[
  {id:'a',name:'API A',models:['shared','pending'],enabled:true,hasKey:true},
  {id:'b',name:'API B',models:['shared'],enabled:false,hasKey:true},
  {id:'c',name:'API C',models:['shared'],enabled:true,hasKey:false},
 ]} as unknown as LocalAgentSnapshot;
 expect(sourceOptions(local).map(s=>[s.label,s.models])).toEqual([['API A',['api-a/shared','api-a/pending']],['Cursor SDK',['cursor/shared']]]);expect(sourceLabel(local,'a')).toBe('API A');
});


it('preserves selections across loading, catalog errors, registration and successful refresh',()=>{
 const selection={sourceId:'account',model:'qoder/model'};
 const account={id:'account',provider:'qoder',label:'Account',status:'active',disabled:false,unavailable:false,models:['qoder/model']};
 const base={state:'running',accounts:[],models:[],quotas:{}} as unknown as LocalAgentSnapshot;
 expect(sourceSelectionState({...base,accountsLoading:true},selection)).toBe('loading');
 expect(sourceSelectionState({...base,accountError:'temporary failure'},selection)).toBe('unknown');
 expect(sourceSelectionState({...base,state:'stopped'},selection)).toBe('unknown');
 expect(sourceSelectionState({...base,accounts:[{...account,models:[],modelError:'refresh failed'}]},selection)).toBe('unknown');
 expect(sourceSelectionState({...base,accounts:[account]},selection)).toBe('loading');
 const ready={...base,accounts:[account],models:[{id:selection.model}]};
 expect(sourceSelectionState(ready,selection)).toBe('available');
 expect(sourceSelectionNotice(ready,[selection])).toBe('');
 expect(sourceSelectionState({...ready,accounts:[{...account,models:['qoder/other']}]},selection)).toBe('unavailable');
 expect(sourceSelectionState({...ready,accounts:[{...account,disabled:true}]},selection)).toBe('unavailable');
 expect(sourceSelectionState(base,selection)).toBe('unavailable');
});
it('bulk removal keeps failed or unfinished sources alongside confirmed missing models',()=>{
 const choices=[{sourceId:'waiting',model:'qoder/model'},{sourceId:'failed',model:'qoder/model'},{sourceId:'disabled',model:'qoder/model'}];
 const account={provider:'qoder',label:'Account',status:'active',disabled:false,unavailable:false};
 const local={state:'running',accounts:[{...account,id:'waiting'},{...account,id:'failed',models:[],modelError:'timeout'},{...account,id:'disabled',models:[],disabled:true}],models:[],quotas:{}} as unknown as LocalAgentSnapshot;
 const original=structuredClone(choices);
 expect(choices.filter(choice=>sourceSelectionState(local,choice)!=='unavailable')).toEqual(choices.slice(0,2));
 expect(choices).toEqual(original);
 expect(sourceSelectionNotice(local,choices)).toContain('正在加载');
 expect(sourceSelectionNotice({...local,accountsLoading:true},choices)).toContain('保留');
});
it('a temporarily unreadable API key is not grounds for removing a saved model',()=>{
 const selection={sourceId:'api',model:'api-api/model'};
 const local={state:'running',accounts:[],models:[],quotas:{},apiSources:[{id:'api',name:'API',enabled:true,hasKey:false,models:['model']}]} as unknown as LocalAgentSnapshot;
 expect(sourceSelectionState(local,selection)).toBe('unknown');
 expect(sourceSelectionState({...local,apiSources:[{...local.apiSources![0],models:['replacement']}]},selection)).toBe('unavailable');
});
