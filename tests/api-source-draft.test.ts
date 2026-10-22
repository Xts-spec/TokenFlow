import { apiModelRoute, normalizeApiBaseURL, protocolFromURL } from '../apps/shared/api-endpoint';
import { describe, expect, it } from 'vitest';
import { parseModels, sourceProtocolLabel, validateDraft } from '../apps/console/src/api-source-draft';

const draft={name:'公司中转',baseURL:'https://api.example.test/v1',apiKey:'sk-fixture',model:'gpt-5'};
describe('API source draft with a user-defined name',()=>{
 it('accepts a complete draft and needs no protocol',()=>expect(validateDraft(draft,false)).toEqual({}));
 it('reports every missing field in Chinese before anything is sent',()=>{
  expect(validateDraft({name:'',baseURL:'not-a-url',apiKey:' ',model:' , '},false)).toEqual({name:'请填写便于识别的名称。',baseURL:'请输入完整地址，例如 https://api.example.com/v1',apiKey:'请填写 API Key。',model:'请填写模型名称。'});
 });
 it.each(['http://example.test/v1','file:///tmp/x','ftp://example.test'])('rejects insecure address %s',baseURL=>expect(validateDraft({...draft,baseURL},false).baseURL).toContain('HTTPS'));
 it.each(['https://user:pass@example.test/v1','https://example.test/v1?key=secret','https://example.test/v1#x'])('rejects address carrying secrets %s',baseURL=>expect(validateDraft({...draft,baseURL},false).baseURL).toContain('账号'));
 it.each(['http://127.0.0.1:1234/v1','http://localhost:1234/v1','http://[::1]:1234/v1'])('allows loopback http %s',baseURL=>expect(validateDraft({...draft,baseURL},false)).toEqual({}));
 it('lets an edit keep the saved key but rejects a malformed new one',()=>{
  expect(validateDraft({...draft,apiKey:''},true)).toEqual({});
  expect(validateDraft({...draft,apiKey:'bad key'},true).apiKey).toBeTruthy();
  expect(validateDraft({...draft,apiKey:'bad\nkey'},true).apiKey).toBeTruthy();
 });
 it('splits models on commas and newlines without duplicates',()=>{
  expect(parseModels('a, b\na，c')).toEqual(['a','b','c']);
  expect(validateDraft({...draft,model:'bad\tmodel'},false).model).toBeTruthy();
 });
});

describe('skip-verification protocol inference',()=>{
 it.each([['/v1/responses','responses'],['/v1/chat/completions/','chat'],['/custom/messages','messages'],['/company/anthropic','messages'],['/company/anthropic/v1','messages']])('infers %s as %s',(path,protocol)=>{
  expect(protocolFromURL(`https://relay.test${path}`)).toBe(protocol);
 });
 it.each(['/v1','/custom','/models','/anthropic-relay'])('requires a choice for ambiguous %s',path=>expect(protocolFromURL(`https://relay.test${path}`)).toBeUndefined());
 it('removes the endpoint suffix while retaining a company prefix',()=>expect(normalizeApiBaseURL(' https://relay.test/company/v1/messages/ ')).toBe('https://relay.test/company/v1'));
});

describe('model-specific routes',()=>{
 const source={id:'fixture',baseURL:'https://relay.test/v1',protocol:'responses' as const,models:['gpt','claude'],modelRoutes:{claude:{protocol:'messages' as const,baseURL:'https://relay.test/anthropic/v1'}}};
 it('uses the default for legacy models and overrides for qualified model IDs',()=>{
  expect(apiModelRoute(source,'gpt')).toEqual({protocol:'responses',baseURL:source.baseURL});
  expect(apiModelRoute(source,'api-fixture/claude')).toEqual(source.modelRoutes.claude);
  expect(apiModelRoute(source,'constructor')).toEqual({protocol:'responses',baseURL:source.baseURL});
 });
 it('shows a mixed label only when models actually use different protocols',()=>{
  expect(sourceProtocolLabel(source)).toBe('按模型路由');
  expect(sourceProtocolLabel({...source,models:['claude']})).toBe('Anthropic Messages');
 });
});

import {providerSchema} from '../packages/core/src/providers';
it.each(['10.15.11.5','10.2.6.48','172.16.0.1','172.31.255.254','192.168.1.2','[fd12::1]'])('accepts LAN HTTP consistently in UI and server: %s',host=>{
 const baseURL=`http://${host}:9555/v1`;
 expect(validateDraft({...draft,baseURL},false)).toEqual({});
 expect(providerSchema.safeParse({kind:'custom',baseURL,model:'test'}).success).toBe(true);
});
it.each(['172.15.0.1','172.32.0.1','192.169.1.1','8.8.8.8','10.example.com'])('still requires HTTPS for non-LAN hosts: %s',host=>{
 const baseURL=`http://${host}:9555/v1`;
 expect(validateDraft({...draft,baseURL},false).baseURL).toBeTruthy();
 expect(providerSchema.safeParse({kind:'custom',baseURL,model:'test'}).success).toBe(false);
});
