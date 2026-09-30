import { expect, it } from 'vitest';
import { connectionEvidence, type AgentTarget } from '../apps/console/src/connection-evidence';
import type { GatewayCall } from '../packages/core/src/gateway-activity';

const target:AgentTarget={id:'codex',name:'Codex',path:'/fixture/config.toml',exists:true,revision:'revision',pids:[],error:'',connection:null,drift:false,configurationState:'unmanaged',backups:[]};
const connected:AgentTarget={...target,configurationState:'configured',connection:{id:'connection',target:'codex',createdAt:'2026-09-30T01:00:00Z',beforeHash:'before',afterHash:'after',state:'applied',keyId:'owned-key',sourceId:'source',model:'codex/model'}};
const call:GatewayCall={id:'call',keyId:'owned-key',agent:'Codex',model:'codex/model',protocol:'responses',startedAt:'2026-09-30T02:00:00Z',durationMs:100,status:200,inputTokens:7,outputTokens:3};

it('does not mistake a config file or a process for a verified installation',()=>{
  for(const instance of [target,{...target,pids:[123]}]){
    expect(connectionEvidence(instance,[]).label).toBe('未配置 · 安装未验证');
  }
});

it('keeps client verification pending even after a successful gateway request',()=>{
  expect(connectionEvidence(connected,[call])).toMatchObject({tone:'neutral',label:'已写入配置 · 待客户端验证'});
  expect(connectionEvidence(connected,[call]).detail).toContain('仍需在客户端确认');
});

it('does not attribute another key, another model or a pre-connection request to this connection',()=>{
  for(const other of [{...call,keyId:'other-key'},{...call,model:'another/model'},{...call,startedAt:'2026-09-29T01:00:00Z'}]){
    expect(connectionEvidence(connected,[{...other,status:500}]).tone).toBe('neutral');
  }
  expect(connectionEvidence(connected,[{...call,status:503}]).label).toContain('HTTP 503');
  expect(connectionEvidence(connected,[{...call,status:503}, {...call,id:'newer',startedAt:'2026-09-30T03:00:00Z'}]).tone).toBe('neutral');
});

it('shows unreadable, drifted and unfinished configurations ahead of successful requests',()=>{
  for(const instance of [{...connected,error:'cannot read'}, {...connected,configurationState:'changed',drift:true}, {...connected,connection:{...connected.connection!,state:'prepared' as const}}]){
    expect(connectionEvidence(instance,[call]).tone).toBe('attention');
  }
});
