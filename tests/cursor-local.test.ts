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
