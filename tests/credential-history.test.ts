import {expect,it,vi} from 'vitest';
import {CredentialHistory} from '../packages/core/src/credential-history.js';
it('keeps independent grants and refreshed versions in encrypted storage, coalesces repeats, and propagates storage failure',async()=>{
 const values=new Map<string,string>(),set=vi.fn(async(name:string,value:string)=>{values.set(name,value);});
 const history=new CredentialHistory('/unused',{get:async name=>values.get(name)??'',set});
 const first={access_token:'first-private',refresh_token:'first-grant'},second={access_token:'second-private',refresh_token:'second-grant'};
 await Promise.all([history.remember('claude',[first,second]),history.remember('claude',[first])]);expect([...values.keys()].filter(name=>name.startsWith('grant-'))).toHaveLength(2);
 await history.remember('claude',[{...first,access_token:'refreshed-private'}]);expect([...values.keys()].filter(name=>name.startsWith('grant-'))).toHaveLength(3);
 expect([...values].filter(([name])=>name.startsWith('grant-')).every(([,raw])=>JSON.parse(raw).provider==='claude')).toBe(true);
 await history.forget('claude',[first]);expect([...values].filter(([name,raw])=>name.startsWith('grant-')&&!!raw)).toHaveLength(1);
 const locked=new CredentialHistory('/unused',{get:async()=>'',set:async()=>{throw Error('locked');}});await expect(locked.remember('cursor',[{apiKey:'private'}])).rejects.toThrow('locked');
});
