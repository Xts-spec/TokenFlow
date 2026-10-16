import {afterEach,expect,it} from 'vitest';
import {mkdtemp,readFile,writeFile,rm,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {CodexAccounts} from '../packages/core/src/codex-accounts.js';
import {ClaudeAccountStore} from '../packages/core/src/claude-accounts.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function directory(){const root=await mkdtemp(join(await realpath(tmpdir()),'tf-login-reader-'));roots.push(root);return root;}
it('reads existing Codex file login without switching or modifying config, excluding API and custom-profile routes',async()=>{
 const root=await directory(),config=join(root,'config.toml'),auth=join(root,'auth.json'),store=new CodexAccounts(root,config,async()=>[]);
 const login={auth_mode:'chatgpt',tokens:{account_id:'shared-workspace',access_token:'secret-token',id_token:`x.${Buffer.from(JSON.stringify({email:'native@example.test'})).toString('base64url')}.x`}};
 await writeFile(auth,JSON.stringify(login));
 for(const text of ['', 'profile="native"\n[profiles.native]\nmodel_provider="openai"\n']){await writeFile(config,text);expect(await store.usageLogin()).toEqual({provider:'codex',accountId:'shared-workspace',email:'native@example.test'});expect(await readFile(config,'utf8')).toBe(text);}
 for(const text of ['cli_auth_credentials_store="keyring"','model_provider="custom"','openai_base_url="http://localhost:1234"','[model_providers.openai]\nbase_url="https://custom.test"','profile="missing"','profile="custom"\n[profiles.custom]\nmodel_provider="proxy"']){await writeFile(config,text);expect(await store.usageLogin()).toBeNull();}
 await writeFile(config,'');for(const overridden of [{...login,OPENAI_API_KEY:'api-secret'},{...login,auth_mode:'api_key'},{...login,tokens:{...login.tokens,id_token:'x.e30.x'}}]){await writeFile(auth,JSON.stringify(overridden));expect(await store.usageLogin()).toBeNull();expect(await readFile(auth,'utf8')).toBe(JSON.stringify(overridden));}
});
it.each(['file','keychain'] as const)('reads Claude %s login without writes and excludes gateway, helper, cloud and forced-console authentication',async storage=>{
 const root=await directory(),settings=join(root,'settings.json'),profile=join(root,'.claude.json'),credentials=join(root,'.credentials.json');
 const oauth=JSON.stringify({claudeAiOauth:{accessToken:'secret-token',refreshToken:'secret-refresh'}}),keychain=storage==='keychain'?{read:async()=>oauth,write:async()=>{throw Error('Must not modify credentials');}}:null;
 const store=new ClaudeAccountStore(settings,keychain);await writeFile(profile,JSON.stringify({oauthAccount:{accountUuid:'account',emailAddress:'claude@example.test',organizationUuid:'org'}}));if(storage==='file')await writeFile(credentials,oauth);
 await writeFile(settings,'{"model":"sonnet"}');expect(await store.usageLogin()).toEqual({provider:'claude',accountId:'account',email:'claude@example.test',organizationId:'org'});
 for(const value of [{env:{ANTHROPIC_API_KEY:'secret'}},{env:{ANTHROPIC_BASE_URL:'http://localhost:1234'}},{env:{ANTHROPIC_AUTH_TOKEN:'secret'}},{env:{CLAUDE_CODE_OAUTH_TOKEN:'secret'}},{env:{CLAUDE_CODE_USE_BEDROCK:'1'}},{env:{CLAUDE_CODE_USE_VERTEX:'1'}},{env:{CLAUDE_CODE_USE_FOUNDRY:'1'}},{apiKeyHelper:'read-key'},{forceLoginMethod:'console'},{forceLoginGatewayUrl:'https://gateway.test'}]){const text=JSON.stringify(value);await writeFile(settings,text);expect(await store.usageLogin()).toBeNull();expect(await readFile(settings,'utf8')).toBe(text);}
 if(storage==='file')expect(await readFile(credentials,'utf8')).toBe(oauth);
});
