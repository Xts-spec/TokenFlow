import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,readFile,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readAntigravityUsage} from '../packages/core/src/antigravity-usage.js';
import {mergeLocalUsageRows,nativeIdentity} from '../packages/core/src/local-usage.js';
import {agGeneration,agDatabase,field} from './fixtures/antigravity-usage.js';
it('reads native generation counters without prompts and counts a copied trajectory only once',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-usage-'));
 try{const path=join(root,'conversation.db');agDatabase(path);const before=await readFile(path),rows=await readAntigravityUsage(path);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({target:'antigravity',provider:'antigravity',origin:'native',channel:'official',model:'Gemini Test',requests:1,inputTokens:100,cachedTokens:80,cacheBaseTokens:100,outputTokens:30,reasoningTokens:10,responseHash:nativeIdentity('response','response-1')});
  expect(rows[0].nativeAccountId).toBeUndefined();expect(JSON.stringify(rows)).not.toContain('DO_NOT_STORE');expect(mergeLocalUsageRows([...rows,...rows])[0].requests).toBe(1);expect(await readFile(path)).toEqual(before);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('skips missing usage, malformed protobuf, gateway models and an already recorded gateway response',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-skip-'));
 try{const path=join(root,'conversation.db');agDatabase(path);const db=new DatabaseSync(path);
  for(const [idx,data] of [field(1,field(19,'no-usage')),Buffer.from([10,255]),agGeneration('no-time',0),agGeneration('routed',undefined,'antigravity/Gemini')].entries())db.prepare('INSERT INTO gen_metadata VALUES (?,?,?)').run(idx+1,data,data.length);
  db.close();expect(await readAntigravityUsage(path,id=>id==='response-1')).toEqual([]);
 }finally{await rm(root,{recursive:true,force:true});}
});
it('refuses symlinked databases and reports incompatible schemas',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-ag-safe-'));
 try{const path=join(root,'conversation.db');agDatabase(path);const link=join(root,'link.db');await symlink(path,link);await expect(readAntigravityUsage(link)).rejects.toThrow();const other=join(root,'unknown.db');new DatabaseSync(other).close();await expect(readAntigravityUsage(other)).rejects.toThrow();
 }finally{await rm(root,{recursive:true,force:true});}
});
