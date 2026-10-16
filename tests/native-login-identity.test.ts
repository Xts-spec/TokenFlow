import {it,expect} from 'vitest';
import {desktopIdentityMatches as matches} from '../apps/shared/native-login-identity';
it('matches official domestic endpoint aliases without mixing international or enterprise logins',()=>{
 const native={accountId:'same-id',domain:'copilot.tencent.com',enterpriseId:'team'};
 for(const domain of ['www.codebuddy.cn','www.workbuddy.cn','https://copilot.tencent.com/'])expect(matches('workbuddy',native,{...native,domain})).toBe(true);
 expect(matches('workbuddy',native,{...native,domain:'www.workbuddy.ai'})).toBe(false);
 expect(matches('workbuddy-ai',native,native)).toBe(false);
 expect(matches('workbuddy',native,{...native,enterpriseId:'other-team'})).toBe(false);
 expect(matches('workbuddy',native,{...native,accountId:'other-id'})).toBe(false);
 expect(matches('workbuddy',native,{...native,domain:'unknown.test'})).toBe(false);
 expect(matches('workbuddy-ai',{...native,domain:'www.workbuddy.ai'},{...native,domain:'www.workbuddy.ai'})).toBe(true);
 expect(matches('qoder',{accountId:'qoder-id'},{accountId:'qoder-id'})).toBe(true);
 expect(matches('qoder',{},{accountId:'qoder-id'})).toBe(false);
});
