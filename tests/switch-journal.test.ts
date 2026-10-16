import { it, expect } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SwitchJournal, sanitizeSwitchMessage } from '../packages/core/src/switch-journal.js';
it('retains completed switches without reporting them as failures',async()=>{
 const root=await mkdtemp(join(tmpdir(),'switch-success-')),file=join(root,'journal.json');
 try{const journal=new SwitchJournal(file);await journal.record({action:'official-switch',target:'codex',message:'saved',outcome:'completed',sourceId:'a'.repeat(24),model:'codex/test'});await journal.record({action:'official-switch',target:'codex',message:'failed'});
  expect(journal.history('codex')).toHaveLength(2);expect(journal.list()).toHaveLength(1);
  const loaded=new SwitchJournal(file);await loaded.load();expect(loaded.history('codex').find(r=>r.outcome==='completed')?.model).toBe('codex/test');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('stores only a sanitized switch failure and reloads it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'switch-journal-'));
  const file = join(root, 'switch-failures.json');
  try {
    expect(sanitizeSwitchMessage('失败 tfl_livekey Bearer raw-token\n    at secret')).toBe('失败 [key] Bearer [token]');
    const journal = new SwitchJournal(file);
    await journal.load();
    const saved = await journal.record({ action: 'restore', target: 'codex', model: 'workbuddy/deepseek-v4.1-flash', sourceId: 'a'.repeat(24), message: '旧对话缺失 tfl_livekey Bearer raw-token\n    at secret', code: 'ENOENT' });
    expect(saved.message).toBe('旧对话缺失 [key] Bearer [token]');
    expect(await readFile(file, 'utf8')).not.toContain('tfl_');
    expect(await readFile(file, 'utf8')).not.toContain('raw-token');
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    for (let i = 0; i < 30; i++) await journal.record({ action: 'connect', target: 'claude', message: `第 ${i} 次` });
    expect(journal.list()).toHaveLength(30);
    expect(journal.list().some(item => item.id === saved.id)).toBe(false);
    expect(journal.latest('claude')?.message).toBe('第 29 次');
    expect(journal.latest('codex')).toBeUndefined();
    const reloaded = new SwitchJournal(file);
    await reloaded.load();
    expect(reloaded.latest()?.message).toBe('第 29 次');
    expect(JSON.stringify(reloaded.list())).not.toContain('tfl_');
  } finally { await rm(root, { recursive: true, force: true }); }
});
