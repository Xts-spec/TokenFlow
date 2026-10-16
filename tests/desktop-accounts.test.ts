import {afterEach,it,expect,vi} from 'vitest';
import {mkdtemp,writeFile,readFile,rm,stat,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DesktopAccounts,desktopLoginPaths,type DesktopProvider} from '../packages/core/src/desktop-accounts.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
const credentials=(uid='new',extra={})=>({access_token:`access-${uid}`,refresh_token:`refresh-${uid}`,uid,expired:'2035-01-01T00:00:00Z',...extra});
const crypt=async(op:'encrypt'|'decrypt',value:string)=>op==='encrypt'?Buffer.from(`encrypted:${value}`).toString('base64'):Buffer.from(value,'base64').toString().replace(/^encrypted:/,'');
const originalWB=JSON.stringify({account:{uid:'original',nickname:{$wbEncrypted:1,envelope:'opaque-original'},enterpriseId:'enterprise-original'},auth:{domain:'copilot.tencent.com',accessToken:{$wbEncrypted:1,envelope:'opaque-token'}}});
async function setup(provider:DesktopProvider='workbuddy'){
 const root=await mkdtemp(join(await realpath(tmpdir()),'native-desktop-'));roots.push(root);const path=join(root,provider==='qoder'?'auth.v1.dat':provider==='workbuddy-ai'?'workbuddy-desktop-ai.info':'workbuddy-desktop.info');
 const original=provider!=='qoder'?Buffer.from(originalWB):Buffer.from(await crypt('encrypt',JSON.stringify({schemaVersion:1,user:{id:'original',email:'original@example.test'},token:'original-token'})),'base64');
 await writeFile(path,original);const vault=new Map<string,string>();const secrets={get:async(n:string)=>vault.get(n)??'',set:vi.fn(async(n:string,v:string)=>{vault.set(n,v);})};
 let pids:number[]=[];
 const fetcher=vi.fn<typeof fetch>(async url=>new Response(JSON.stringify(String(url).includes('userinfo')?{id:'new',email:'new@example.test'}:{data:{accounts:[{uid:'new',type:'personal',pluginEnabled:true,nickname:'New'},{uid:'enterprise',enterpriseId:'team',type:'ultimate',pluginEnabled:true}]}})));
 const manager=new DesktopAccounts(provider,secrets,async()=>pids,{paths:{[provider]:path},crypto:crypt,fetch:fetcher,platform:'darwin'});
 return {root,path,original,vault,secrets,fetcher,manager,running:(value:number[])=>{pids=value;}};
}
it('resolves roaming, macOS and Linux XDG paths without assuming path separators',()=>{
 expect(desktopLoginPaths('win32','C:\\Users\\用户',{APPDATA:'D:\\Roaming'}).qoder[0]).toBe('D:\\Roaming\\com.qoder.app.stable\\auth.v1.dat');
 expect(desktopLoginPaths('win32','C:\\Users\\用户',{APPDATA:'D:\\Roaming',LOCALAPPDATA:'D:\\Local'}).workbuddy[0]).toBe('D:\\Local\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-desktop.info');
 expect(desktopLoginPaths('win32','C:\\Users\\用户',{LOCALAPPDATA:'D:\\Local'})['workbuddy-ai'][0]).toBe('D:\\Local\\CodeBuddyExtension\\Data\\Public\\auth\\workbuddy-desktop-ai.info');
 expect(desktopLoginPaths('darwin','/Users/用户',{}).workbuddy[0]).toBe('/Users/用户/Library/Application Support/CodeBuddyExtension/Data/Public/auth/workbuddy-desktop.info');
 expect(desktopLoginPaths('linux','/home/u',{XDG_CONFIG_HOME:'/custom/config'}).qoder[0]).toBe('/custom/config/com.qoder.app.stable/auth.v1.dat');
});
it('identifies an existing Qoder login before any TokenFlow switch without writing a journal',async()=>{
 const f=await setup('qoder');expect(await f.manager.status()).toMatchObject({accountId:'original',email:'original@example.test',backup:null});expect(f.secrets.set).not.toHaveBeenCalled();expect(await readFile(f.path)).toEqual(f.original);
});
it('displays a native WorkBuddy nickname even when it has no email and is not in the gateway pool',async()=>{
 const f=await setup();await writeFile(f.path,JSON.stringify({account:{uid:'native',nickname:'Local WorkBuddy User'},auth:{domain:'copilot.tencent.com'}}));expect(await f.manager.status()).toMatchObject({accountId:'native',displayName:'Local WorkBuddy User',backup:null});expect(f.secrets.set).not.toHaveBeenCalled();
});
it('distinguishes unavailable Qoder identity from signed out and retries decryption only on explicit refresh',async()=>{
 const f=await setup('qoder'),crypto=vi.fn(crypt);crypto.mockRejectedValueOnce(Error('private keychain error'));
 const manager=new DesktopAccounts('qoder',f.secrets,async()=>[],{paths:{qoder:f.path},crypto,platform:'darwin'});
 expect(await manager.status()).toMatchObject({loginState:'unreadable',readError:expect.stringContaining('安全存储')});expect(await manager.status()).toMatchObject({loginState:'unreadable'});expect(crypto).toHaveBeenCalledTimes(1);
 expect(await manager.status(true)).toMatchObject({loginState:'signed-in',email:'original@example.test'});expect(crypto).toHaveBeenCalledTimes(2);expect(f.secrets.set).not.toHaveBeenCalled();
});
it('uses the international endpoint and independent original-login backup for WorkBuddyAI',async()=>{
 const f=await setup('workbuddy-ai'),original=JSON.stringify({account:{uid:'original-ai',nickname:'Local AI'},auth:{domain:'www.workbuddy.ai',accessToken:'original-secret'}});await writeFile(f.path,original);
 const domestic=join(f.root,'workbuddy-desktop.info');await writeFile(domestic,originalWB);
 const prepared=await f.manager.prepare(credentials('new',{domain:'www.workbuddy.ai'}));await f.manager.apply((await f.manager.status()).revision,prepared);
 expect(f.fetcher).toHaveBeenCalledWith('https://www.workbuddy.ai/v2/plugin/accounts',expect.objectContaining({headers:expect.objectContaining({'X-Domain':'www.workbuddy.ai'})}));
 expect(await f.manager.status()).toMatchObject({accountId:'new',domain:'www.workbuddy.ai',displayName:'New'});expect(f.vault.has('native-login-workbuddy-ai')).toBe(true);expect(f.vault.has('native-login-workbuddy')).toBe(false);
 await f.manager.apply((await f.manager.status()).revision,null);expect(await readFile(f.path,'utf8')).toBe(original);expect(await readFile(domestic,'utf8')).toBe(originalWB);
 f.fetcher.mockClear();await expect(f.manager.prepare(credentials())).rejects.toThrow('WorkBuddy 国内版');expect(f.fetcher).not.toHaveBeenCalled();
});
it.each(['workbuddy','qoder'] as const)('%s switches and restores exact original bytes without exposing secrets in status',async provider=>{
 const f=await setup(provider);const before=await f.manager.status();const prepared=await f.manager.prepare(credentials());await f.manager.apply(before.revision,prepared);
 const status=await f.manager.status();expect(status.accountId).toBe('new');expect(status.backup?.state).toBe('applied');expect(JSON.stringify(status)).not.toMatch(/access-new|refresh-new|opaque-token|original-token/);
 expect((await stat(f.path)).mode&0o777).toBe(0o600);
 await f.manager.apply(status.revision,null);expect(await readFile(f.path)).toEqual(f.original);expect((await f.manager.status()).backup).toBeNull();expect((await f.manager.status()).accountId).toBe('original');
});
it('preserves the first original login through successive account switches and native re-encryption',async()=>{
 const f=await setup();await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()));
 const native=JSON.parse(await readFile(f.path,'utf8'));native.auth.accessToken={$wbEncrypted:1,envelope:'refreshed'};await writeFile(f.path,JSON.stringify(native));
 f.fetcher.mockResolvedValue(new Response(JSON.stringify({data:{accounts:[{uid:'second',pluginEnabled:true,type:'personal'}]}})));
 await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials('second')));
 await f.manager.apply((await f.manager.status()).revision,null);expect(await readFile(f.path)).toEqual(f.original);
});
it('restores signed-out state including the original logout marker',async()=>{
 const f=await setup();await writeFile(`${f.path}.logged-out`,'logout-original');const before=await f.manager.status();expect(before.accountId).toBeUndefined();await f.manager.apply(before.revision,await f.manager.prepare(credentials()));await expect(readFile(`${f.path}.logged-out`)).rejects.toHaveProperty('code','ENOENT');
 await f.manager.apply((await f.manager.status()).revision,null);expect(await readFile(`${f.path}.logged-out`,'utf8')).toBe('logout-original');expect(await readFile(f.path)).toEqual(f.original);
});
it('maps domestic domain aliases and matches the exact enterprise identity',async()=>{
 const f=await setup();const result=await f.manager.prepare(credentials('enterprise',{enterprise_id:'team',domain:'https://www.codebuddy.cn'}));const native=JSON.parse(Buffer.from(result.data,'base64').toString());expect(native.account.enterpriseId).toBe('team');expect(native.auth.domain).toBe('www.codebuddy.cn');expect(f.fetcher).toHaveBeenCalledWith('https://www.workbuddy.cn/v2/plugin/accounts',expect.objectContaining({redirect:'error',headers:expect.objectContaining({'X-Domain':'www.codebuddy.cn'})}));
 await expect(f.manager.prepare(credentials('enterprise',{enterprise_id:'wrong'}))).rejects.toThrow('无法唯一确认');await expect(f.manager.prepare(credentials('new',{domain:'evil.test'}))).rejects.toThrow('区域');
});
it('does not write or release the gateway on expired credentials, profile rejection, or mismatched Qoder identity',async()=>{
 const f=await setup('qoder');await expect(f.manager.prepare(credentials('new',{expired:'2020-01-01'}))).rejects.toThrow('过期');expect(f.fetcher).not.toHaveBeenCalled();
 f.fetcher.mockResolvedValueOnce(new Response('',{status:401}));await expect(f.manager.prepare(credentials())).rejects.toThrow('未接受');
 await expect(f.manager.prepare(credentials('different'))).rejects.toThrow('身份');expect(await readFile(f.path)).toEqual(f.original);expect(f.secrets.set).not.toHaveBeenCalled();
});
it('refuses stale revisions, running clients and a native lock before writing',async()=>{
 const f=await setup('qoder'),prepared=await f.manager.prepare(credentials()),revision=(await f.manager.status()).revision;
 f.running([20]);await expect(f.manager.apply(revision,prepared)).rejects.toThrow('退出');f.running([]);
 await writeFile(join(f.root,'auth.v1.lock'),'native');await expect(f.manager.apply(revision,prepared)).rejects.toThrow('正在使用');await rm(join(f.root,'auth.v1.lock'));
 await expect(f.manager.apply('0'.repeat(64),prepared)).rejects.toThrow('已变化');expect(await readFile(f.path)).toEqual(f.original);
});
it('refuses to overwrite a different external login during restore',async()=>{
 const f=await setup();await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()));
 const other=JSON.stringify({account:{uid:'external'},auth:{domain:'copilot.tencent.com'}});await writeFile(f.path,other);await expect(f.manager.apply((await f.manager.status()).revision,null)).rejects.toThrow('其他账号');expect(await readFile(f.path,'utf8')).toBe(other);
});
it('rolls back login and encrypted journal when gateway release fails',async()=>{
 const f=await setup();const release=vi.fn(async()=>{throw Error('gateway failed');});await expect(f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()),release)).rejects.toThrow('gateway failed');expect(release).toHaveBeenCalledOnce();expect(await readFile(f.path)).toEqual(f.original);expect((await f.manager.status()).backup).toBeNull();
});
it('never writes a new login if encrypted backup persistence fails',async()=>{
 const f=await setup();f.secrets.set.mockRejectedValue(Error('locked keychain'));await expect(f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()))).rejects.toThrow('locked keychain');expect(await readFile(f.path)).toEqual(f.original);
});
it('does not overwrite a concurrent external login while rolling back',async()=>{
 const f=await setup();const external='external-login';await expect(f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()),async()=>{await writeFile(f.path,external);throw Error('concurrent');})).rejects.toThrow('concurrent');expect(await readFile(f.path,'utf8')).toBe(external);
});
it('rejects unsupported platforms and non-persistent stores before any request',async()=>{
 const f=await setup();const unsupported=new DesktopAccounts('workbuddy',f.secrets,async()=>[],{paths:{workbuddy:f.path},platform:'linux',fetch:f.fetcher});await expect(unsupported.prepare(credentials())).rejects.toThrow('此系统');
 const ephemeral=new DesktopAccounts('workbuddy',{...f.secrets,persistent:false},async()=>[],{platform:'darwin',fetch:f.fetcher});await expect(ephemeral.prepare(credentials())).rejects.toThrow('持久化');expect(f.fetcher).not.toHaveBeenCalled();
});
it('respects WorkBuddy native directory lock and treats an empty logout marker as signed out',async()=>{
 const f=await setup();await writeFile(`${f.path}.logged-out`,'');expect((await f.manager.status()).accountId).toBeUndefined();
 const {mkdir}=await import('node:fs/promises');await mkdir(join(f.root,'.workbuddy-desktop.info.workbuddy.lock'));
 await expect(f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()))).rejects.toThrow('正在使用');expect(await readFile(f.path)).toEqual(f.original);
});

it.each(['workbuddy','qoder'] as const)('can recover the original %s login if the client rejects the new session and clears it',async provider=>{
 const f=await setup(provider);await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials()));await rm(f.path);
 await f.manager.apply((await f.manager.status()).revision,null);expect(await readFile(f.path)).toEqual(f.original);
});

it('refuses overseas credentials before requesting a profile or writing a domestic native login',async()=>{
 const f=await setup();await expect(f.manager.prepare(credentials('new',{domain:'www.workbuddy.ai'}))).rejects.toThrow('WorkBuddyAI 国际版');expect(f.fetcher).not.toHaveBeenCalled();expect(await readFile(f.path)).toEqual(f.original);
});

it('restores the original after WorkBuddy normalizes its domestic login endpoint',async()=>{
 const f=await setup();await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credentials('new',{domain:'www.codebuddy.cn'})));
 const native=JSON.parse(await readFile(f.path,'utf8'));native.auth.domain='copilot.tencent.com';await writeFile(f.path,JSON.stringify(native));
 await f.manager.apply((await f.manager.status()).revision,null);expect(await readFile(f.path)).toEqual(f.original);
});
