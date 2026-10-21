import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Persistent token statistics, one row per day / Agent / Key / source / model.
 * Only counters are stored: never prompts, completions or credentials.
 *
 * `inputTokens` includes cache reads, so uncached input = inputTokens - cachedTokens and
 * total = inputTokens + outputTokens. `cacheBaseTokens` is the input of the calls whose upstream
 * reported cache usage at all, which keeps the hit rate honest for providers that never report it.
 */
const count = z.number().int().nonnegative();
const rowSchema = z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  target: z.string().max(80),
  keyId: z.string().max(80),
  keyName: z.string().max(160),
  sourceId: z.string().max(80),
  model: z.string().max(300),
  requests: count, failed: count, unmeasured: count,
  credits:z.number().finite().nonnegative().optional(),
  inputTokens: count, cachedTokens: count, cacheBaseTokens: count, outputTokens: count,
  durationMs: count,cacheWriteTokens:count.optional(),reasoningTokens:count.optional(),toolCalls:count.optional(),toolResults:count.optional(),generationMs:count.optional(),timedOutputTokens:count.optional(),
  last: z.string(),
});
export type UsageRow = z.infer<typeof rowSchema>;
const fileSchema = z.object({ version: z.literal(1), rows: z.array(rowSchema) });

export type UsageEvent = {
  target: string; keyId: string; keyName: string; sourceId: string; model: string;
  startedAt: string; durationMs: number; status: number;
  inputTokens: number | null; cachedTokens: number | null; outputTokens: number | null;cacheWriteTokens?:number|null;reasoningTokens?:number|null;toolCalls?:number;toolResults?:number;generationMs?:number;timedOutputTokens?:number;
};

const MAX_ROWS = 20000;
const pad = (value: number) => String(value).padStart(2, '0');
/** Local calendar day, so "today" matches what the user sees on their clock. */
export const dayOf = (value: string | number | Date) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
};
const daysAgo = (days: number, now: number) => { const date = new Date(now); date.setDate(date.getDate() - days); return dayOf(date); };
const clamp = (value: number) => Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(value)));

export class UsageLedger {
  private rows = new Map<string, UsageRow>();
  private timer?: NodeJS.Timeout;
  private writing: Promise<void> = Promise.resolve();
  private dirty = false;
  /** Set when the file could not be read or saved; counters in memory stay correct. */
  warning = '';
  private constructor(private path: string, private retentionDays: number, private flushDelay: number) {}

  static async open(root: string, options: { retentionDays?: number; flushDelay?: number } = {}) {
    const ledger = new UsageLedger(join(root, 'usage-ledger.json'), options.retentionDays ?? 180, options.flushDelay ?? 1500);
    try {
      const parsed = fileSchema.parse(JSON.parse(await readFile(ledger.path, 'utf8')));
      for (const row of parsed.rows) ledger.rows.set(ledger.keyOf(row), row);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        // Keep the unreadable file for inspection instead of silently overwriting it.
        await rename(ledger.path, `${ledger.path}.unreadable`).catch(() => undefined);
        ledger.warning = '用量统计文件无法读取，已保留为 usage-ledger.json.unreadable，并从零开始统计。';
      }
    }
    ledger.prune();
    return ledger;
  }

  private keyOf(row: Pick<UsageRow, 'day' | 'target' | 'keyId' | 'sourceId' | 'model'>) {
    return [row.day, row.target, row.keyId, row.sourceId, row.model].join('\n');
  }

  add(event: UsageEvent) {
    const day = dayOf(event.startedAt);
    const key = this.keyOf({ day, target: event.target, keyId: event.keyId, sourceId: event.sourceId, model: event.model });
    const row = this.rows.get(key) ?? {
      day, target: event.target, keyId: event.keyId, keyName: event.keyName, sourceId: event.sourceId, model: event.model,
      requests: 0, failed: 0, unmeasured: 0, inputTokens: 0, cachedTokens: 0, cacheBaseTokens: 0, outputTokens: 0, durationMs: 0, last: event.startedAt,
    };
    const failed = event.status >= 400;
    const input = clamp(event.inputTokens ?? 0);
    row.keyName = event.keyName;
    row.requests += 1;
    if (failed) row.failed += 1;
    else if (event.inputTokens === null || event.outputTokens === null) row.unmeasured += 1;
    row.inputTokens = clamp(row.inputTokens + input);
    row.outputTokens = clamp(row.outputTokens + clamp(event.outputTokens ?? 0));
    if (event.cachedTokens !== null && event.inputTokens !== null) {
      row.cachedTokens = clamp(row.cachedTokens + Math.min(clamp(event.cachedTokens), input));
      row.cacheBaseTokens = clamp(row.cacheBaseTokens + input);
    }
    const read = event.cachedTokens===null?0:Math.min(clamp(event.cachedTokens),input);
    if(event.cacheWriteTokens!==undefined&&event.cacheWriteTokens!==null)row.cacheWriteTokens=clamp((row.cacheWriteTokens??0)+Math.min(clamp(event.cacheWriteTokens),Math.max(0,input-read)));
    if(event.reasoningTokens!==undefined&&event.reasoningTokens!==null)row.reasoningTokens=clamp((row.reasoningTokens??0)+Math.min(clamp(event.reasoningTokens),clamp(event.outputTokens??0)));
    for(const key of ['toolCalls','toolResults','generationMs','timedOutputTokens'] as const)if(event[key]!==undefined)row[key]=clamp((row[key]??0)+clamp(event[key]!));
    row.durationMs = clamp(row.durationMs + Math.max(0, event.durationMs));
    if (event.startedAt > row.last) row.last = event.startedAt;
    this.rows.set(key, row);
    this.schedule();
  }

  /** Rows from the last `days` calendar days including today; 0 means everything kept. */
  list(days = 0, now = Date.now()): UsageRow[] {
    const cutoff = days > 0 ? daysAgo(days - 1, now) : '';
    return [...this.rows.values()].filter(row => row.day >= cutoff).map(row => ({ ...row }));
  }

  firstDay() { let first = ''; for (const row of this.rows.values()) if (!first || row.day < first) first = row.day; return first; }

  private prune(now = Date.now()) {
    const cutoff = daysAgo(this.retentionDays, now);
    for (const [key, row] of this.rows) if (row.day < cutoff) this.rows.delete(key);
    if (this.rows.size > MAX_ROWS) {
      const ordered = [...this.rows.entries()].sort((a, b) => a[1].day.localeCompare(b[1].day));
      for (const [key] of ordered.slice(0, this.rows.size - MAX_ROWS)) this.rows.delete(key);
    }
  }

  private schedule() {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(); }, this.flushDelay);
    this.timer.unref?.();
  }

  /** Writes pending counters; failures are reported through `warning` and retried on the next call. */
  flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    this.writing = this.writing.then(async () => {
      if (!this.dirty) return;
      this.dirty = false;
      this.prune();
      try {
        const temporary = `${this.path}.tmp`;
        await writeFile(temporary, JSON.stringify({ version: 1, rows: [...this.rows.values()] }), { mode: 0o600 });
        await rename(temporary, this.path);
        this.warning = '';
      } catch {
        this.dirty = true;
        this.warning = '用量统计暂时无法写入磁盘；当前数据仍在内存中，请检查资料目录权限。';
      }
    });
    return this.writing;
  }

  close() { return this.flush(); }
}
