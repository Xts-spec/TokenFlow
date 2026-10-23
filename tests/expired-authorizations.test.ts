import {expect,it} from 'vitest';
import {expiredAuthorizations} from '../apps/console/src/expired-authorizations';
const grant=(id:string,rest:Record<string,unknown>={})=>({id,provider:'qoder',label:'person@example.test',status:'active',disabled:false,unavailable:false,...rest});
it('offers to remove a confirmed expired hidden grant while retaining the usable merged account',()=>{
 const accounts=[grant('good',{preferredCredentialId:'good'}),grant('old',{isDuplicate:true,preferredCredentialId:'good',authenticationRequired:true}),grant('unknown',{unavailable:true,modelError:'network error'}),grant('old-reference',{isDuplicate:true,preferredCredentialId:'good',credentialAlias:true,authenticationRequired:true})];
 expect(expiredAuthorizations(accounts)).toEqual([{account:accounts[0],count:1,key:'old'}]);
 expect(expiredAuthorizations(accounts.map(a=>({...a,authenticationRequired:false})))).toEqual([]);
});
it('does not prompt for refreshable access expiry, cooldowns or ambiguous catalog failures',()=>{
 expect(expiredAuthorizations([grant('refreshable',{retryable:true}),grant('cooldown',{unavailable:true,retryable:true}),grant('catalog',{unavailable:true})])).toEqual([]);
 expect(expiredAuthorizations([grant('terminal',{authenticationRequired:true,disabled:true})])[0].count).toBe(1);
});
