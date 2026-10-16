import {expect,it} from 'vitest';
import {credentialIdentity as identity,compareCredentials,credentialFingerprint,credentialSubject} from '../packages/core/src/credential-identity.js';
const jwt=(claims:unknown)=>`x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.x`;
it('normalizes email without collapsing Codex members, Claude organizations, WorkBuddy regions or enterprise identities',()=>{
 for(const provider of ['cursor','antigravity','kimi','xai','qoder'])expect(identity(provider,{email:' User@Example.test '})).toBe(identity(provider,{email:'user@example.test'}));
 expect(identity('codex',{email:'one@example.test',account_id:'team'})).not.toBe(identity('codex',{email:'two@example.test',account_id:'team'}));
 expect(identity('codex',{email:'one@example.test',account_id:'one'})).not.toBe(identity('codex',{email:'one@example.test',account_id:'two'}));
 expect(identity('claude',{email:'one@example.test',organization_uuid:'one'})).not.toBe(identity('claude',{email:'one@example.test',organization_uuid:'two'}));
 const wb={uid:'same',domain:'copilot.tencent.com',enterprise_id:'one'};
 expect(identity('workbuddy',wb)).toBe(identity('workbuddy',{...wb,domain:'www.workbuddy.cn'}));
 expect(identity('workbuddy',wb)).not.toBe(identity('workbuddy',{...wb,domain:'www.workbuddy.ai'}));
 expect(identity('workbuddy',wb)).not.toBe(identity('workbuddy',{...wb,enterprise_id:'two'}));
});
it('uses provider identifiers when there is no email and never guesses identity from a nickname, workspace alone or token',()=>{
 for(const [provider,raw] of Object.entries({claude:{account_uuid:'claude-id',organization_uuid:'org'},qoder:{uid:'qoder-id'},workbuddy:{uid:'wb-id',domain:'www.workbuddy.cn'},zcode:{uid:'zai-id'},trae:{user_id:'trae-id'},kimi:{access_token:jwt({sub:'kimi-id'})},xai:{access_token:jwt({sub:'xai-id'})}})){
  expect(identity(provider,raw)).toBeTruthy();expect(identity(provider,{...raw,nickname:'new nickname'})).toBe(identity(provider,raw));
 }
 expect(identity('codex',{account_id:'shared-workspace'})).toBeUndefined();
 expect(identity('codex',{account_id:'shared-workspace',id_token:jwt({sub:'person-one'})})).not.toBe(identity('codex',{account_id:'shared-workspace',id_token:jwt({sub:'person-two'})}));
 for(const provider of ['cursor','qoder','trae','kimi','xai','zcode'])expect(identity(provider,{nickname:'same name',access_token:'opaque-token'})).toBeUndefined();
 expect(identity('workbuddy',{uid:'id',domain:'unknown.test'})).toBeUndefined();
 expect(credentialSubject({access_token:jwt({user_id:'visible-kimi-user'})})).toBe('visible-kimi-user');
 expect(identity('kimi',{access_token:jwt({user_id:'same-user',sub:'session-one'})})).toBe(identity('kimi',{access_token:jwt({user_id:'same-user',sub:'session-two'})}));
 expect(identity('antigravity',{email:'one@example.test',project_id:'one'})).not.toBe(identity('antigravity',{email:'one@example.test',project_id:'two'}));
});
it('selects usable grants before expired grants, then uses refresh or authorization time and retains stable grant identity on access refresh',()=>{
 const good={access_token:'access',refresh_token:'refresh',last_refresh:'2026-10-01',expired:'2030-01-01'};
 expect(compareCredentials({raw:good},{raw:{apiKey:'expired',apiKeyExpiresAtMs:1,authorizedAt:Date.now()}})).toBeLessThan(0);
 expect(compareCredentials({raw:{...good,last_refresh:'2026-10-15'}},{raw:good})).toBeLessThan(0);
 expect(credentialFingerprint(good)).toBe(credentialFingerprint({...good,access_token:'refreshed-access'}));
 expect(credentialFingerprint(good)).not.toBe(credentialFingerprint({...good,refresh_token:'independent-authorization'}));
});
