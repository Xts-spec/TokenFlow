import {it,expect,afterEach,vi} from 'vitest';
import {mkdtemp,readFile,rm,realpath,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {QoderIdeLogin,qoderIdeLoginPath} from '../packages/core/src/qoder-ide-login.js';
const roots:string[]=[];afterEach(async()=>{for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(value:unknown={id:'ide-user',email:'ide@example.test',name:'IDE User',token:'private-ide-token',refreshToken:'private-refresh'}){
 const root=await mkdtemp(join(await realpath(tmpdir()),'qoder-ide-test-'));roots.push(root);const path=join(root,'state.vscdb'),db=new DatabaseSync(path);db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');if(value!==null)db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('secret://aicoding.auth.userInfo',JSON.stringify(Buffer.from(JSON.stringify(value))));db.close();
 const crypto=vi.fn(async(_op:'encrypt'|'decrypt',value:string)=>Buffer.from(value,'base64').toString());return {path,crypto,reader:new QoderIdeLogin({path,crypto})};
}
it('reads the IDE identity independently without changing the database or exposing tokens',async()=>{
 const f=await fixture(),before=await readFile(f.path),status=await f.reader.status();expect(status).toMatchObject({accountId:'ide-user',email:'ide@example.test',displayName:'IDE User',readOnly:true,loginState:'signed-in',backup:null});expect(JSON.stringify(status)).not.toMatch(/private-ide-token|private-refresh|refreshToken/);expect(await readFile(f.path)).toEqual(before);expect(f.crypto).toHaveBeenCalledWith('decrypt',expect.any(String));
});
it('does not interpret a cached profile without a token as an IDE login',async()=>{
 const f=await fixture({id:'old-user',email:'old@example.test'});expect(await f.reader.status()).toMatchObject({loginState:'signed-out'});
});
it('keeps unreadable IDE data separate from signed out, and retries only explicitly',async()=>{
 const f=await fixture();f.crypto.mockRejectedValueOnce(Error('private error'));expect(await f.reader.status()).toMatchObject({loginState:'unreadable'});await f.reader.status();expect(f.crypto).toHaveBeenCalledTimes(1);expect(await f.reader.status(true)).toMatchObject({accountId:'ide-user'});expect(f.crypto).toHaveBeenCalledTimes(2);
});
it('does not fall back to the standalone login when IDE data is absent',async()=>{
 const f=await fixture(null);expect(await f.reader.status()).toMatchObject({loginState:'signed-out'});expect(f.crypto).not.toHaveBeenCalled();await rm(f.path);expect(await f.reader.status()).toMatchObject({loginState:'signed-out'});
});
it('resolves IDE paths separately on macOS, Windows and Linux',()=>{
 expect(qoderIdeLoginPath('darwin','/Users/user',{})).toBe('/Users/user/Library/Application Support/Qoder/User/globalStorage/state.vscdb');
 expect(qoderIdeLoginPath('win32','C:\\Users\\用户',{APPDATA:'D:\\Roaming'})).toBe('D:\\Roaming\\Qoder\\User\\globalStorage\\state.vscdb');
 expect(qoderIdeLoginPath('linux','/home/u',{XDG_CONFIG_HOME:'/config'})).toBe('/config/Qoder/User/globalStorage/state.vscdb');
});

const authKey='secret://aicoding.auth.userInfo';
const credential={uid:'pooled-user',access_token:'selected-secret',refresh_token:'selected-refresh',expired:'2035-01-01T00:00:00Z'};
const encode=(value:unknown)=>JSON.stringify(Buffer.from(JSON.stringify(value)));
const allRows=(path:string)=>{const db=new DatabaseSync(path,{readOnly:true});try{return db.prepare('SELECT key,value FROM ItemTable ORDER BY key').all();}finally{db.close();}};
const put=(path:string,key:string,value:string|null)=>{const db=new DatabaseSync(path);try{if(value===null)db.prepare('DELETE FROM ItemTable WHERE key=?').run(key);else db.prepare('INSERT OR REPLACE INTO ItemTable VALUES (?,?)').run(key,value);}finally{db.close();}};
async function writable(value?:unknown,platform:NodeJS.Platform='darwin'){
 const f=await fixture(value),vault=new Map<string,string>(),processes=vi.fn(async()=>[] as number[]),secrets={get:vi.fn(async(key:string)=>vault.get(key)??''),set:vi.fn(async(key:string,value:string)=>{vault.set(key,value);})};
 const crypto=vi.fn(async(op:'encrypt'|'decrypt',value:string)=>op==='encrypt'?Buffer.from(value).toString('base64'):Buffer.from(value,'base64').toString());
 const fetch=vi.fn(async()=>new Response(JSON.stringify({id:'pooled-user',email:'pool@example.test',name:'Pooled',whitelistStatus:'PASS',orgId:'org-a',userType:'teams'})));
 const options={path:f.path,crypto,fetch,platform},manager=new QoderIdeLogin(options,secrets,processes);
 return {...f,vault,secrets,processes,options,manager,crypto,fetch};
}
it.each(['darwin','win32'] as const)('switches only IDE auth rows and restores the exact original rows on %s',async platform=>{
 const f=await writable(undefined,platform);
 for(const name of ['userPlan','creditUsage','enterpriseUsage'])put(f.path,'secret://aicoding.auth.'+name,encode({original:name}));
 put(f.path,'unrelated-editor-setting','keep');const original=allRows(f.path);
 const standalone=f.path+'.standalone';await writeFile(standalone,'independent-login');
 const prepared=await f.manager.prepare(credential),revision=(await f.manager.status()).revision;
 expect(f.fetch.mock.calls).toHaveLength(1);const profile=JSON.parse(Buffer.from(JSON.parse(prepared.data).data).toString());expect(profile).toMatchObject({id:'pooled-user',token:'selected-secret',refreshToken:'selected-refresh',expireTime:String(Date.parse(credential.expired)),status:2,whitelist:3,orgId:'org-a'});
 await f.manager.apply(revision,prepared);const switched=await f.manager.status();expect(switched).toMatchObject({accountId:'pooled-user',readOnly:false,backup:{state:'applied'}});expect(JSON.stringify(switched)).not.toMatch(/selected-secret|selected-refresh/);expect(allRows(f.path)).toHaveLength(2);
 put(f.path,'unrelated-editor-setting','changed-after-switch');await f.manager.apply((await f.manager.status()).revision,null);
 expect(await f.manager.status()).toMatchObject({accountId:'ide-user',backup:null});expect(allRows(f.path)).toEqual(original.map(row=>row.key==='unrelated-editor-setting'?{...row,value:'changed-after-switch'}:row));expect(await readFile(standalone,'utf8')).toBe('independent-login');expect([...f.vault.keys()]).toEqual(['native-login-qoder-ide']);
});
it('keeps the first original through repeated switches and tolerates refresh of the selected account',async()=>{
 const f=await writable(),original=allRows(f.path),prepared=await f.manager.prepare(credential);
 await f.manager.apply((await f.manager.status()).revision,prepared);
 put(f.path,authKey,encode({id:'pooled-user',orgId:'org-a',token:'refreshed-token'}));put(f.path,'secret://aicoding.auth.userPlan',encode({new:'plan'}));
 await f.manager.apply((await f.manager.status()).revision,prepared);
 const resumed=new QoderIdeLogin(f.options,f.secrets,f.processes);await resumed.apply((await resumed.status()).revision,null);expect(allRows(f.path)).toEqual(original);
});
it('restores a previously signed-out IDE without deleting unrelated settings',async()=>{
 const f=await writable(null);put(f.path,'unrelated','keep');const original=allRows(f.path);
 await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credential));await f.manager.apply((await f.manager.status()).revision,null);expect(allRows(f.path)).toEqual(original);
});
it('rejects changed revisions, running processes, malformed encrypted data and missing initialized profiles',async()=>{
 const f=await writable(),prepared=await f.manager.prepare(credential),revision=(await f.manager.status()).revision;
 put(f.path,'secret://aicoding.auth.creditUsage',encode({changed:true}));await expect(f.manager.apply(revision,prepared)).rejects.toThrow('已变化');expect(f.vault.size).toBe(0);
 f.processes.mockResolvedValue([100]);await expect(f.manager.apply((await f.manager.status()).revision,prepared)).rejects.toThrow('完全退出');f.processes.mockResolvedValue([]);
 put(f.path,authKey,'malformed-private-content');await expect(f.manager.check((await f.manager.status()).revision)).rejects.toThrow('无法确认');expect(f.vault.size).toBe(0);
 await rm(f.path);await expect(f.manager.check((await f.manager.status()).revision)).rejects.toThrow('初始化');
});
it('preserves a later external account and the original backup, but allows restoring after explicit logout',async()=>{
 const f=await writable(),original=allRows(f.path);await f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credential));
 for(const value of [{id:'other',token:'other-token'},{id:'pooled-user',orgId:'other-org',token:'other-token'}]){
  put(f.path,authKey,encode(value));const external=allRows(f.path);await expect(f.manager.apply((await f.manager.status()).revision,null)).rejects.toThrow('其他账号');expect(allRows(f.path)).toEqual(external);expect((await f.manager.status()).backup).not.toBeNull();
 }
 put(f.path,authKey,null);await f.manager.apply((await f.manager.status()).revision,null);expect(allRows(f.path)).toEqual(original);
});
it('fails before mutation when credentials, permissions, official identity or official session are invalid',async()=>{
 const f=await writable(),original=allRows(f.path);
 await expect(f.manager.prepare({...credential,expired:'2000-01-01'})).rejects.toThrow('过期');
 for(const body of [{id:'different',whitelistStatus:'PASS'},{id:'pooled-user',whitelistStatus:'LoginExpire'},{id:'pooled-user',whitelistStatus:'NOT_ALLOW'}]){f.fetch.mockResolvedValue(new Response(JSON.stringify(body)));await expect(f.manager.prepare(credential)).rejects.toThrow();}
 f.fetch.mockRejectedValue(Error('private token in request'));await expect(f.manager.prepare(credential)).rejects.toThrow('官方服务');expect(allRows(f.path)).toEqual(original);expect(f.vault.size).toBe(0);
 await expect(new QoderIdeLogin(f.options,{...f.secrets,persistent:false},f.processes).prepare(credential)).rejects.toThrow('安全存储');await expect(new QoderIdeLogin({...f.options,platform:'linux'},f.secrets,f.processes).prepare(credential)).rejects.toThrow('此系统');
});
it('rolls back owned rows when final vault persistence fails and recovers an interrupted prepared journal',async()=>{
 const f=await writable(),original=allRows(f.path),prepared=await f.manager.prepare(credential),save=f.secrets.set.getMockImplementation()!;let fail=true;
 f.secrets.set.mockImplementation(async(key,value)=>{if(value&&JSON.parse(value).state==='applied'&&fail){fail=false;throw Error('vault unavailable');}return save(key,value);});
 await expect(f.manager.apply((await f.manager.status()).revision,prepared)).rejects.toThrow('vault unavailable');expect(allRows(f.path)).toEqual(original);expect((await f.manager.status()).backup).toBeNull();
 await f.manager.apply((await f.manager.status()).revision,prepared);const journal=JSON.parse(f.vault.get('native-login-qoder-ide')!);journal.state='prepared';f.vault.set('native-login-qoder-ide',JSON.stringify(journal));
 await expect(f.manager.check((await f.manager.status()).revision)).rejects.toThrow('上次切换');await f.manager.apply((await f.manager.status()).revision,null);expect(allRows(f.path)).toEqual(original);
});
it('does not overwrite a concurrent external update or erase its recovery journal after persistence fails',async()=>{
 const f=await writable(),save=f.secrets.set.getMockImplementation()!;
 f.secrets.set.mockImplementation(async(key,value)=>{if(value&&JSON.parse(value).state==='applied'){put(f.path,authKey,encode({id:'external',token:'external'}));throw Error('write interrupted');}return save(key,value);});
 await expect(f.manager.apply((await f.manager.status()).revision,await f.manager.prepare(credential))).rejects.toThrow('write interrupted');expect(await f.manager.status()).toMatchObject({accountId:'external',backup:{state:'prepared'}});
});
it('refuses a concurrent SQLite writer and can retry after that writer exits',async()=>{
 const f=await writable(),prepared=await f.manager.prepare(credential),revision=(await f.manager.status()).revision,db=new DatabaseSync(f.path);db.exec('BEGIN IMMEDIATE');
 try{await expect(f.manager.apply(revision,prepared)).rejects.toThrow('数据库正在使用');expect(f.vault.size).toBe(0);}finally{db.exec('ROLLBACK');db.close();}
 await f.manager.apply(revision,prepared);expect(await f.manager.status()).toMatchObject({accountId:'pooled-user'});
});
