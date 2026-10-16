import {expect,it} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm,realpath} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createServer} from 'node:net';
import {CLIProxyManager} from '../packages/core/src/cliproxy.js';
it('uses historical identities despite expiry or disabling and collapses grants without merging regions, enterprises or projects',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-usage-accounts-')),allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));
 const manager=new CLIProxyManager(root,resolve('tests/fixtures/fake-cliproxy.mjs'),'fixture-internal',port);
 const cn={provider:'workbuddy',uid:'same',email:'same@example.test',domain:'www.workbuddy.cn',enterprise_id:'company'};
 const records=[cn,{...cn},{...cn,domain:'www.workbuddy.ai'},{...cn,enterprise_id:'other'}, {provider:'qoder',uid:'qoder-user',email:'qd@example.test'}, {provider:'antigravity',email:'ag@example.test',project_id:'one'},{provider:'antigravity',email:'ag@example.test',project_id:'two'}, {provider:'claude',email:'cl@example.test',account_uuid:'claude-user',organization_uuid:'org'},{provider:'codex',email:'cx@example.test',account_id:'workspace'}];
 try{
  await mkdir(join(root,'cliproxy/auth'),{recursive:true});await writeFile(join(root,'cliproxy/fixture-accounts.json'),JSON.stringify(records.map((r,i)=>({name:`${i}.json`,provider:r.provider,email:r.email,disabled:i<2,status:'active',models:['test']}))));
  for(const [i,r]of records.entries())await writeFile(join(root,'cliproxy/auth',`${i}.json`),JSON.stringify({...r,expired:'2000-01-01',access_token:'DO_NOT_EXPORT',refresh_token:'grant-'+i}));
  await manager.start();const rows=await manager.nativeUsageAccounts();expect(rows).toHaveLength(8);expect(rows.filter(r=>r.provider==='workbuddy').map(r=>r.organizationId).sort()).toEqual(['company','other']);expect(rows.filter(r=>r.provider==='workbuddy-ai')).toHaveLength(1);expect(rows.filter(r=>r.provider==='antigravity').map(r=>r.organizationId).sort()).toEqual(['one','two']);expect(rows.find(r=>r.provider==='qoder')).toMatchObject({accountId:'qoder-user'});expect(rows.find(r=>r.provider==='codex')).toMatchObject({accountId:'workspace'});expect(JSON.stringify(rows)).not.toMatch(/DO_NOT_EXPORT|grant-/);
 }finally{await manager.stop();await rm(root,{recursive:true,force:true});}
});
