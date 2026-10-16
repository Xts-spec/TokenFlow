import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {localCredential} from '../packages/core/src/local-credentials.js';
import type {AgentPaths} from '../packages/core/src/agent-connections.js';
it('imports Claude keychain OAuth with real account identity and rejects missing identity',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'local-claude-'));const directory=join(root,'claude');await mkdir(directory);const paths={claude:join(directory,'settings.json')} as AgentPaths;
 try{
  const auth={accessToken:'keychain-access',refreshToken:'keychain-refresh',expiresAt:Date.parse('2035-01-01'),scopes:['user:inference','user:profile']};
  await writeFile(join(directory,'.credentials.json'),JSON.stringify({claudeAiOauth:{...auth,accessToken:'stale-file'}}));
  const keychain={read:async()=>JSON.stringify({claudeAiOauth:auth}),write:async()=>{throw Error('read-only import');}};
  await expect(localCredential('claude',paths,keychain)).rejects.toThrow('完整账号资料');
  await writeFile(join(directory,'.claude.json'),JSON.stringify({oauthAccount:{emailAddress:'test@example.test',accountUuid:'account',organizationUuid:'org'}}));
  expect(await localCredential('claude',paths,keychain)).toMatchObject({email:'test@example.test',account_uuid:'account',organization_uuid:'org',access_token:'keychain-access',scopes:['user:inference','user:profile']});
  expect(await localCredential('claude',paths,null)).toMatchObject({access_token:'stale-file'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('does not import stale Codex file credentials while the client uses a different credential store or API key',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'local-codex-')),paths={codex:join(root,'config.toml')} as AgentPaths;
 const tokens={access_token:'local-access',refresh_token:'local-refresh',id_token:'x.e30.x',account_id:'account'};
 try{
  await writeFile(join(root,'auth.json'),JSON.stringify({tokens}));
  for(const storage of ['keyring','auto']){await writeFile(paths.codex,`cli_auth_credentials_store="${storage}"`);await expect(localCredential('codex',paths)).rejects.toThrow('暂不支持直接导入');}
  await writeFile(paths.codex,'');expect(await localCredential('codex',paths)).toMatchObject({access_token:'local-access'});
  await writeFile(join(root,'auth.json'),JSON.stringify({auth_mode:'api_key',tokens}));await expect(localCredential('codex',paths)).rejects.toThrow('API Key');
 }finally{await rm(root,{recursive:true,force:true});}
});
