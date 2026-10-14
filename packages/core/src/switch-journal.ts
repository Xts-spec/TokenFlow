import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

const actions = ['connect', 'restore', 'migration-restore', 'official-switch', 'official-restore'] as const;
export type SwitchAction = typeof actions[number];
const failureSchema = z.object({
  id: z.string().uuid(),
  at: z.string().datetime(),
  action: z.enum(actions),
  target: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  model: z.string().min(1).max(300).optional(),
  sourceId: z.string().regex(/^[a-f0-9]{24}$/).optional(),
  message: z.string().min(1).max(400),
  code: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/).optional(),
}).strict();
export type SwitchFailure = z.infer<typeof failureSchema>;
const limit = 30;

/** Keep the first line and drop credentials. Switch logs are shown to the repair assistant. */
export function sanitizeSwitchMessage(value: string) {
  const line = value.split(/\r?\n/, 1)[0] ?? '';
  const text = line.replace(/tfl_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{8,}|\bBearer\s+\S+/gi, match => /^bearer\b/i.test(match) ? 'Bearer [token]' : '[key]').replace(/\s+/g, ' ').trim();
  return text.slice(0, 400) || '切换失败';
}

export class SwitchJournal {
  private records: SwitchFailure[] = [];
  private pending: Promise<void> = Promise.resolve();
  constructor(private readonly file: string) {}
  async load() {
    try {
      const parsed = z.array(failureSchema).safeParse(JSON.parse(await readFile(this.file, 'utf8')));
      this.records = parsed.success ? parsed.data.slice(0, limit) : [];
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.records = []; }
  }
  list(target?: string) { return this.records.filter(item => !target || item.target === target).map(item => ({ ...item })); }
  latest(target?: string) { return this.list(target)[0]; }
  record(input: { action: SwitchAction; target: string; model?: string; sourceId?: string; message: string; code?: string }) {
    const target = /^[a-z0-9_-]{1,40}$/.test(input.target) ? input.target : 'unknown';
    const model = input.model ? sanitizeSwitchMessage(input.model) : undefined;
    const entry = failureSchema.parse({
      id: randomUUID(), at: new Date().toISOString(), action: input.action, target,
      ...(model && model !== '切换失败' && model.length <= 300 ? { model } : {}),
      ...(input.sourceId && /^[a-f0-9]{24}$/.test(input.sourceId) ? { sourceId: input.sourceId } : {}),
      message: sanitizeSwitchMessage(input.message),
      ...(input.code && /^[A-Za-z0-9_-]{1,80}$/.test(input.code) ? { code: input.code } : {}),
    });
    this.records = [entry, ...this.records].slice(0, limit);
    const snapshot = this.records;
    const write = this.pending.then(() => this.flush(snapshot));
    this.pending = write.catch(() => {});
    return write.then(() => entry);
  }
  private async flush(records: SwitchFailure[]) {
    const temp = `${this.file}.tmp`;
    try { await writeFile(temp, JSON.stringify(records), { mode: 0o600 }); await rename(temp, this.file); }
    finally { await rm(temp, { force: true }); }
  }
}
