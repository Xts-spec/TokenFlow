import {expect,it,vi} from 'vitest';
import {zcodeProjectCredential} from '../packages/core/src/zcode-credentials.js';
const native={native_oauth:true,provider:'bigmodel',uid:'person',access_token:'private-login',native_project:{organizationId:'org',projectId:'project',apiKeyId:'key'}};
it('keeps unavailable native project authorization distinct from successful login',async()=>{
 for(const body of ['',JSON.stringify({code:0,data:{enable:false}}),JSON.stringify({code:500})])await expect(zcodeProjectCredential(native,async()=>new Response(body))).rejects.toThrow('项目调用凭据');
 expect(native.access_token).toBe('private-login');
});
it('never sends native credentials to an unrecognized region or an absent project',async()=>{
 const request=vi.fn<typeof fetch>();for(const raw of [{...native,provider:'https://evil.test'},{...native,native_project:undefined}])await expect(zcodeProjectCredential(raw,request)).rejects.toThrow();expect(request).not.toHaveBeenCalled();
});
it('retains an unexpired project grant and leaves independent API credentials intact',async()=>{
 const request=vi.fn<typeof fetch>();const raw={...native,oauth_access_token:'private-login',auth_kind:'project_access',expired:'2035-01-01',access_token:'project-call-token'};expect(await zcodeProjectCredential(raw,request)).toBe(raw);expect(await zcodeProjectCredential({access_token:'personal-api-key'},request)).toEqual({access_token:'personal-api-key'});expect(request).not.toHaveBeenCalled();
});
