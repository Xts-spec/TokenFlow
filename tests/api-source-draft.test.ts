import { describe, expect, it } from 'vitest';
import { parseModels, validateDraft } from '../apps/console/src/api-source-draft';

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
