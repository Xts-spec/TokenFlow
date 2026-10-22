import {it,expect} from 'vitest';
import {accountLabel} from '../packages/core/src/account-label.js';
it('uses Trae identity rather than a generic provider label, while preserving custom names',()=>{
 expect(accountLabel('trae',{label:'Trae'},{user_id:'123456789'})).toBe('账号 123456789');
 expect(accountLabel('trae',{label:'Trae'},{username:'Example'})).toBe('Example');
 expect(accountLabel('trae',{label:'My work account'},{username:'Example'})).toBe('My work account');
});
it('does not present ZCode provider placeholders as an account identity',()=>{
 expect(accountLabel('zcode',{label:'zcode'},{uid:'123'})).toBe('账号 123');
 expect(accountLabel('zcode',{label:'ZCode'},{email:'person@example.test'})).toBe('person@example.test');
});
it('prefers the stored email over a non-email summary placeholder',()=>{
 for(const provider of ['trae','zcode'])expect(accountLabel(provider,{email:provider,label:provider},{email:'person@example.test',uid:'123'})).toBe('person@example.test');
});
