import { expect, it } from 'vitest';
import { connectionEvidence, type AgentTarget } from '../apps/console/src/connection-evidence';
import { sourceOptions } from '../apps/console/src/source-options';
import type { LocalAgentSnapshot } from '../packages/core/src/cliproxy';
import type { GatewayCall } from '../packages/core/src/gateway-activity';

const target:AgentTarget={id:'codex',name:'Codex',path:'/fixture/config.toml',exists:true,revision:'revision',pids:[],error:'',connection:null,drift:false,configurationState:'unmanaged',backups:[]};
const connected:AgentTarget={...target,configurationState:'configured',connection:{id:'connection',target:'codex',createdAt:'2026-09-30T01:00:00Z',beforeHash:'before',afterHash:'after',state:'applied',keyId:'owned-key',sourceId:'source',model:'codex/model'}};
const sources=[{id:'source',models:['codex/model']}];
const call:GatewayCall={id:'call',keyId:'owned-key',agent:'Codex',model:'codex/model',protocol:'responses',startedAt:'2026-09-30T02:00:00Z',durationMs:100,status:200,inputTokens:7,outputTokens:3};

it('does not mistake a config file or a process for a verified installation',()=>{
  for(const instance of [target,{...target,pids:[123]}]){
    expect(connectionEvidence(instance,[],sources).label).toBe('未配置 · 安装未验证');
  }
});

it('keeps client verification pending even after a successful gateway request',()=>{
  expect(connectionEvidence(connected,[call],sources)).toMatchObject({tone:'neutral',label:'已写入配置 · 待客户端验证'});
  expect(connectionEvidence(connected,[call],sources).detail).toContain('仍需在客户端确认');
});

it('does not attribute another key, another model or a pre-connection request to this connection',()=>{
  for(const other of [{...call,keyId:'other-key'},{...call,model:'another/model'},{...call,startedAt:'2026-09-29T01:00:00Z'}]){
    expect(connectionEvidence(connected,[{...other,status:500}],sources).tone).toBe('neutral');
  }
  expect(connectionEvidence(connected,[{...call,status:503}],sources).label).toContain('HTTP 503');
  expect(connectionEvidence(connected,[{...call,status:503}, {...call,id:'newer',startedAt:'2026-09-30T03:00:00Z'}],sources).tone).toBe('neutral');
});

it('shows unreadable, drifted and unfinished configurations ahead of successful requests',()=>{
  for(const instance of [{...connected,error:'cannot read'}, {...connected,configurationState:'changed',drift:true}, {...connected,connection:{...connected.connection!,state:'prepared' as const}}]){
    expect(connectionEvidence(instance,[call],sources).tone).toBe('attention');
  }
});


it('requires a fresh source choice when the connected source or model is unavailable, ahead of old successful calls',()=>{
  for(const available of [[],[{id:'source',models:['codex/other']}],[{id:'another-source',models:['codex/model']}]]){
    const evidence=connectionEvidence(connected,[call],available);
    expect(evidence).toMatchObject({tone:'attention',label:'来源或模型不可用'});
    expect(evidence.detail).toContain('请重新选择');
    expect(evidence.detail).not.toContain('客户端发送消息');
  }
});

it('follows API source enablement and model removal without changing the saved connection',()=>{
  const apiConnection={...connected,connection:{...connected.connection!,sourceId:'api-source',model:'api-api-source/model'}};
  const local={accounts:[],models:[{id:'api-api-source/model',provider:'api'}],quotas:{},apiSources:[
    {id:'api-source',name:'Fixture API',enabled:true,hasKey:true,models:['model']},
  ]} as unknown as LocalAgentSnapshot;
  const original=structuredClone(apiConnection);
  expect(connectionEvidence(apiConnection,[],sourceOptions(local)).label).toBe('已写入配置 · 待客户端验证');
  for(const changed of [
    {...local,apiSources:[{...local.apiSources![0],enabled:false}]},
    {...local,apiSources:[{...local.apiSources![0],models:['replacement']}]},
  ]) expect(connectionEvidence(apiConnection,[call],sourceOptions(changed)).label).toBe('来源或模型不可用');
  // A transient catalog reload does not invalidate a saved, enabled API model.
  expect(connectionEvidence(apiConnection,[],sourceOptions({...local,models:[]})).label).toBe('已写入配置 · 待客户端验证');
  expect(connectionEvidence(apiConnection,[],sourceOptions(local)).label).toBe('已写入配置 · 待客户端验证');
  expect(apiConnection).toEqual(original);
});
