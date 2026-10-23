import {expect,it} from 'vitest';
import {qoderAuthorization} from '../packages/core/src/qoder-authorizations.js';
it('shows only safe grant metadata and does not invent authorization time from file timestamps',()=>{
 const details=qoderAuthorization({access_token:'secret',refresh_token:'private',uid:'person',native_client:'qoder-ide',last_refresh:'2026-10-21T01:00:00Z',expired:'2035-01-01',modtime:'2026-10-21T01:00:00Z'},{id:'grant',disabled:false,unavailable:false,models:['fixture']},'local-qoder-fixture.json',true);
 expect(details).toMatchObject({source:'Qoder IDE',status:'usable',preferred:true,refreshedAt:'2026-10-21T01:00:00.000Z'});expect(details.authorizedAt).toBeUndefined();expect(JSON.stringify(details)).not.toMatch(/secret|private|person/);
});
it('distinguishes refreshable, unusable and disabled authorizations without collapsing their identity',()=>{
 const raw={access_token:'secret',refresh_token:'refresh',expired:'2020-01-01'},account={id:'grant',disabled:false,unavailable:false};
 expect(qoderAuthorization(raw,account,'web.json',false).status).toBe('refreshable');expect(qoderAuthorization({...raw,refresh_token:undefined},account,'web.json',false).status).toBe('expired');expect(qoderAuthorization(raw,{...account,disabled:true},'web.json',false).status).toBe('disabled');expect(qoderAuthorization({...raw,expired:'2035-01-01'},{...account,authenticationRequired:true},'web.json',false).status).toBe('revoked');
});
