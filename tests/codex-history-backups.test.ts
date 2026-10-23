import {afterEach,expect,it} from 'vitest';
import {mkdtemp,writeFile,readdir,readFile,stat,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {CodexHistoryBackups} from '../packages/core/src/codex-history-backups.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('stores an existing full baseline once, appends only new bytes and reconstructs every revision after restart',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'history-backup-'));roots.push(root);
 const path=join(root,'rollout.jsonl'),baseline=join(root,'baseline.jsonl');const original=Buffer.from('历史\n'.repeat(20000));await writeFile(baseline,original);
 const store=new CodexHistoryBackups(root),first=await store.capture(path,original,baseline);
 const added=Buffer.from('new official turn\n'),second=await store.capture(path,Buffer.concat([original,added]));
 const folder=join(root,'codex-history-backups',first.key);
 expect((await readdir(folder)).filter(name=>name.endsWith('.jsonl'))).toEqual([]);
 expect((await stat(join(folder,second.revision+'.delta'))).size).toBe(added.length);
 const reopened=new CodexHistoryBackups(root);expect(await reopened.read(first)).toEqual(original);expect(await reopened.read(second)).toEqual(Buffer.concat([original,added]));
 expect(await reopened.capture(path,Buffer.concat([original,added]))).toEqual(second);
 expect((await readdir(folder)).filter(name=>name.endsWith('.delta'))).toHaveLength(1);
});
it('backs up a rewritten prefix as a delta, preserves the old version, and handles rollback without revision cycles',async()=>{
 const root=await mkdtemp(join(await realpath(tmpdir()),'history-backup-'));roots.push(root);const store=new CodexHistoryBackups(root),path=join(root,'rollout.jsonl');
 const original=Buffer.from('provider=openai\n'+'unchanged history\n'.repeat(2000));
 const first=await store.capture(path,original),changed=Buffer.from(original.toString().replace('openai','token_flow'));
 const second=await store.capture(path,changed);const folder=join(root,'codex-history-backups',first.key);
 expect((await readFile(join(folder,second.revision+'.delta'))).length).toBeLessThan(30);
 expect(await store.capture(path,original)).toEqual(first);
 const third=await store.capture(path,Buffer.concat([original,Buffer.from('after rollback')]));
 for(const [snapshot,value] of [[first,original],[second,changed],[third,Buffer.concat([original,Buffer.from('after rollback')])]] as const)expect(await new CodexHistoryBackups(root).read(snapshot)).toEqual(value);
 expect((await readdir(folder)).filter(name=>name.endsWith('.jsonl'))).toHaveLength(1);
});
