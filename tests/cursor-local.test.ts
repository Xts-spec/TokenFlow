import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {afterEach,expect,it,vi} from 'vitest';import {localCursorSession} from '../packages/core/src/cursor-local.js';
const cleanup:string[]=[];afterEach(async()=>{vi.restoreAllMocks();for(const dir of cleanup.splice(0))await rm(dir,{recursive:true,force:true});});
async function fixture(){const root=await mkdtemp(join(tmpdir(),'cursor-local-'));cleanup.push(root);const path=join(root,'state.vscdb');const db=new DatabaseSync(path);db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY,value TEXT)');db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('cursorAuth/accessToken','native-test-token');db.prepare('INSERT INTO ItemTable VALUES (?,?)').run('cursorAuth/cachedEmail','stale@example.test');db.close();return path;}
it('confirms server identity before creating an independent SDK key and never modifies the native database',async()=>{
 const path=await fixture();const before=await readFile(path);const calls:string[]=[];vi.spyOn(globalThis,'fetch').mockImplementation(async(url,init)=>{calls.push(String(url));expect(init?.redirect).toBe('error');expect(new Headers(init?.headers).get('authorization')).toBe('Bearer native-test-token');if(String(url).endsWith('/GetMe'))return Response.json({email:'verified@example.test'});expect(JSON.parse(String(init?.body))).toMatchObject({name:'token-flow-local-import',expiresAt:expect.any(String)});return Response.json({apiKey:'independent-key'});});
 const session=await localCursorSession(path);expect(session.email).toBe('verified@example.test');expect(calls).toHaveLength(1);expect(await session.createCredential()).toMatchObject({email:'verified@example.test',apiKey:'independent-key'});expect(calls).toHaveLength(2);expect(await readFile(path)).toEqual(before);
});
it('does not mint a key when the native token is expired and redacts upstream failures',async()=>{
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('native-test-token',{status:401}));await expect(localCursorSession(await fixture())).rejects.toThrow('本机 Cursor 登录已过期');expect(fetcher).toHaveBeenCalledOnce();
});
it('rejects missing local credentials without creating a database',async()=>{
 const root=await mkdtemp(join(tmpdir(),'cursor-local-'));cleanup.push(root);const path=join(root,'missing.db');await expect(localCursorSession(path)).rejects.toThrow('未找到本机 Cursor 登录');await expect(readFile(path)).rejects.toThrow();
});

it('resolves Cursor credentials on all three platforms including redirected and empty environment paths',async()=>{
 const {cursorDatabasePath}=await import('../packages/core/src/cursor-local.js');
 expect(cursorDatabasePath('darwin','/Users/用户',{})).toBe('/Users/用户/Library/Application Support/Cursor/User/globalStorage/state.vscdb');
 expect(cursorDatabasePath('win32','C:\\Users\\用户',{APPDATA:'D:\\用户数据'})).toBe('D:\\用户数据\\Cursor\\User\\globalStorage\\state.vscdb');
 expect(cursorDatabasePath('win32','C:\\Users\\用户',{APPDATA:''})).toBe('C:\\Users\\用户\\AppData\\Roaming\\Cursor\\User\\globalStorage\\state.vscdb');
 expect(cursorDatabasePath('linux','/home/u',{XDG_CONFIG_HOME:'/data/config'})).toBe('/data/config/Cursor/User/globalStorage/state.vscdb');
 expect(cursorDatabasePath('linux','/home/u',{XDG_CONFIG_HOME:''})).toBe('/home/u/.config/Cursor/User/globalStorage/state.vscdb');
});
it('detects the verified local account read-only, coalesces checks, caches five minutes and permits manual refresh',async()=>{
 const {CursorLocalLogin}=await import('../packages/core/src/cursor-local.js');
 const path=await fixture(),before=await readFile(path),reader=new CursorLocalLogin(path);
 let now=1000;vi.spyOn(Date,'now').mockImplementation(()=>now);
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({email:'verified@example.test'}));
 const states=await Promise.all([reader.status(),reader.status(),reader.status(true)]);
 expect(states[0]).toMatchObject({loginState:'signed-in',email:'verified@example.test'});expect(states[1]).toEqual(states[0]);expect(fetcher).toHaveBeenCalledOnce();
 expect(JSON.stringify(states)).not.toMatch(/native-test-token|stale@example|apiKey|accessToken/);
 now+=299999;await reader.status();expect(fetcher).toHaveBeenCalledOnce();
 // Give each response its own body, as fetch does.
 fetcher.mockImplementation(async()=>Response.json({email:'verified@example.test'}));
 now++;await reader.status();expect(fetcher).toHaveBeenCalledTimes(2);
 await reader.status(true);expect(fetcher).toHaveBeenCalledTimes(3);
 expect(fetcher.mock.calls.every(([url])=>String(url).endsWith('/GetMe'))).toBe(true);expect(await readFile(path)).toEqual(before);
});
it('invalidates cached identity on account change or logout even while an older check is pending',async()=>{
 const {CursorLocalLogin}=await import('../packages/core/src/cursor-local.js');
 const path=await fixture(),reader=new CursorLocalLogin(path);let finish!:(r:Response)=>void;
 const fetcher=vi.spyOn(globalThis,'fetch').mockImplementationOnce(()=>new Promise(r=>{finish=r;})).mockImplementation(async()=>Response.json({email:'new@example.test'}));
 const first=reader.status();const db=new DatabaseSync(path);db.prepare('UPDATE ItemTable SET value=? WHERE key=?').run('new-token','cursorAuth/accessToken');
 expect(await reader.status()).toMatchObject({email:'new@example.test'});
 finish(Response.json({email:'old@example.test'}));await first;
 expect(await reader.status()).toMatchObject({email:'new@example.test'});expect(fetcher).toHaveBeenCalledTimes(2);
 db.prepare('DELETE FROM ItemTable WHERE key=?').run('cursorAuth/accessToken');db.close();
 expect(await reader.status()).toEqual({loginState:'signed-out',revision:'signed-out'});expect(fetcher).toHaveBeenCalledTimes(2);
});
it('distinguishes missing credentials and unreadable databases, and caches failures without trusting stale email',async()=>{
 const {CursorLocalLogin}=await import('../packages/core/src/cursor-local.js');const path=await fixture();
 const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('private-token',{status:401}));const reader=new CursorLocalLogin(path);
 const state=await reader.status();expect(state.loginState).toBe('unreadable');expect(state.email).toBeUndefined();expect(JSON.stringify(state)).not.toContain('private-token');await reader.status();expect(fetcher).toHaveBeenCalledOnce();
 expect((await new CursorLocalLogin(path+'.missing').status()).loginState).toBe('signed-out');await expect(readFile(path+'.missing')).rejects.toThrow();
 const {writeFile}=await import('node:fs/promises');await writeFile(path,'not a sqlite database');expect((await reader.status()).loginState).toBe('unreadable');expect(fetcher).toHaveBeenCalledOnce();
});
