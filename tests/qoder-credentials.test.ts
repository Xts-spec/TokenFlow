import {it,expect,vi} from 'vitest';
import {nativeQoderCredential,verifyNativeQoder,qoderProfile} from '../packages/core/src/qoder-credentials';
it('normalizes both native formats without copying unrelated fields',()=>{
 expect(nativeQoderCredential({token:'secret',refreshToken:'refresh',expiresAt:'2035-01-01',user:{id:42,email:'USER@example.test'},models:['untrusted']})).toEqual({access_token:'secret',refresh_token:'refresh',uid:'42',email:'user@example.test',expired:'2035-01-01T00:00:00.000Z'});
 expect(nativeQoderCredential({token:'secret',id:'42',expireTime:'2051222400000'},true)).toMatchObject({uid:'42',access_token:'secret',expired:'2035-01-01T00:00:00.000Z'});
 expect(()=>nativeQoderCredential({user:{id:'cached'}})).toThrow('完整');
 expect(()=>qoderProfile({id:'other'},'expected')).toThrow('不一致');
});
it('refreshes rejected native tokens then verifies identity before import',async()=>{
 const fetcher=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('',{status:401})).mockResolvedValueOnce(new Response(JSON.stringify({data:{accessToken:'new-secret',refreshToken:'new-refresh',tokenExpireTime:2051222400000}}))).mockResolvedValueOnce(new Response(JSON.stringify({id:'42',email:'verified@example.test'})));
 expect(await verifyNativeQoder({uid:'42',access_token:'old-secret',refresh_token:'old-refresh'},fetcher)).toMatchObject({uid:'42',access_token:'new-secret',refresh_token:'new-refresh',email:'verified@example.test'});
 expect(fetcher.mock.calls[2][1]?.headers).toMatchObject({Authorization:'Bearer new-secret'});
});
it('keeps transient failures distinct from confirmed unusable authorization',async()=>{
 await expect(verifyNativeQoder({uid:'42',access_token:'secret'},async()=>{throw Error('private payload');})).rejects.toMatchObject({reauthorize:false});
 await expect(verifyNativeQoder({uid:'42',access_token:'secret'},async()=>new Response('',{status:503}))).rejects.toMatchObject({reauthorize:false});
 await expect(verifyNativeQoder({uid:'42',access_token:'secret'},async()=>new Response('',{status:401}))).rejects.toMatchObject({reauthorize:true});
 await expect(verifyNativeQoder({uid:'42',access_token:'secret'},async()=>new Response(JSON.stringify({id:'other'})))).rejects.toMatchObject({reauthorize:true});
});
