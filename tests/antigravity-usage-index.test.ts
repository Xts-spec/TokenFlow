import {expect,it,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,copyFile,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalUsageIndex} from '../packages/core/src/local-usage-index.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import {NativeUsageLogins} from '../packages/core/src/native-usage-logins.js';
import {nativeIdentity} from '../packages/core/src/local-usage.js';
import {agDatabase,agGeneration} from './fixtures/antigravity-usage.js';

it('indexes Antigravity once across copies, notices WAL appends, preserves accounts on restart and removes gateway responses',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-index-')),dir=join(root,'.gemini/antigravity-ide/conversations'),paths=agentPaths(root);
 let index=new LocalUsageIndex(root,paths),db:DatabaseSync|undefined;
 const now=Date.parse('2026-10-17T10:00:00Z'),login=(name:string)=>({provider:'antigravity' as const,accountId:`${name}@example.test`,email:`${name}@example.test`});
 const ready=async()=>{await vi.waitFor(()=>expect(index.snapshot().scanning).toBe(false),{timeout:5000,interval:25});return index.snapshot();};
 try{
  await mkdir(dir,{recursive:true});const file=join(dir,'one.db');agDatabase(file,agGeneration('a',now+1000));await copyFile(file,join(dir,'copy.db'));
  const logins=await NativeUsageLogins.open(root);await logins.observe({antigravity:login('a')},now);await logins.observe({antigravity:login('a')},now+5000);
  index.snapshot();let snapshot=await ready();expect(snapshot.rows).toHaveLength(1);expect(snapshot.rows[0]).toMatchObject({target:'antigravity',requests:1,inputTokens:100,nativeAccountId:nativeIdentity('antigravity','a@example.test'),nativeAccountEvidence:'login-snapshot'});
  expect(snapshot.coverage.find(c=>c.target==='antigravity')).toMatchObject({files:2,indexed:2,status:'ready'});
  expect(snapshot.coverage.find(c=>c.target==='cursor')).toMatchObject({status:'unsupported'});
  await logins.observe({antigravity:login('b')},now+10000);await logins.observe({antigravity:login('b')},now+15000);
  db=new DatabaseSync(file);db.exec('PRAGMA journal_mode=WAL;PRAGMA wal_autocheckpoint=0');db.prepare('SELECT * FROM gen_metadata').all();const old=await stat(file),data=agGeneration('b',now+12000);db.prepare('INSERT INTO gen_metadata VALUES (1,?,?)').run(data,data.length);
  expect((await stat(file)).mtimeMs).toBe(old.mtimeMs);expect((await stat(file+'-wal')).size).toBeGreaterThan(0);
  index.refresh();snapshot=await ready();expect(snapshot.rows).toHaveLength(2);expect(snapshot.rows.reduce((n,r)=>n+r.requests,0)).toBe(2);expect(snapshot.rows.find(r=>r.nativeAccountId===nativeIdentity('antigravity','b@example.test'))?.requests).toBe(1);
  await index.close();db.close();db=undefined;
  // Current login must not rewrite already observed historical account A.
  const saved=JSON.parse(await readFile(join(root,'native-usage-logins.json'),'utf8'));saved.intervals=[];await writeFile(join(root,'native-usage-logins.json'),JSON.stringify(saved));
  await writeFile(join(root,'gateway-traces.json'),JSON.stringify({salt:'a'.repeat(64),records:[{responseHash:nativeIdentity('response','b')}]}));
  index=new LocalUsageIndex(root,paths);index.snapshot();snapshot=await ready();expect(snapshot.rows).toHaveLength(1);expect(snapshot.rows[0]).toMatchObject({requests:1,nativeAccountId:nativeIdentity('antigravity','a@example.test')});
  const cache=await readFile(join(root,'local-usage-index.json'),'utf8');expect(cache).not.toMatch(/DO_NOT_STORE|a@example|b@example|"response-1"/);
 }finally{db?.close();await index.close();await rm(root,{recursive:true,force:true});}
});

it('keeps unsupported legacy trajectories distinct from an empty supported database',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-legacy-')),dir=join(root,'.gemini/antigravity/conversations'),index=new LocalUsageIndex(root,agentPaths(root));
 try{await mkdir(dir,{recursive:true});await writeFile(join(dir,'legacy.pb'),Buffer.from([1,2,3]));index.snapshot();await vi.waitFor(()=>expect(index.snapshot().scanning).toBe(false),{timeout:5000,interval:25});expect(index.snapshot().coverage.find(c=>c.target==='antigravity')).toMatchObject({files:1,indexed:0,skipped:1,status:'unavailable',note:expect.stringContaining('不支持')});expect(index.snapshot().rows).toEqual([]);
 }finally{await index.close();await rm(root,{recursive:true,force:true});}
});
