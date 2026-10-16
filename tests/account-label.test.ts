import {it,expect} from 'vitest';
import {accountLabel} from '../packages/core/src/account-label.js';
it('uses Trae identity rather than a generic provider label, while preserving custom names',()=>{
 expect(accountLabel('trae',{label:'Trae'},{user_id:'123456789'})).toBe('账号 123456789');
 expect(accountLabel('trae',{label:'Trae'},{username:'Example'})).toBe('Example');
 expect(accountLabel('trae',{label:'My work account'},{username:'Example'})).toBe('My work account');
});
