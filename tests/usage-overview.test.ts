import {it,expect} from 'vitest';
import {activityStats} from '../apps/console/src/UsageOverview';
import type {UsageRow} from '../apps/console/src/usage-model';
const row=(day:string,total:number):UsageRow=>({day,target:'codex',keyId:'native',keyName:'native',sourceId:'',model:'test',requests:1,failed:0,unmeasured:0,inputTokens:total,cachedTokens:0,cacheBaseTokens:0,outputTokens:0,durationMs:0,last:`${day}T12:00:00`});
it('aggregates daily activity, detects gaps, and ignores future timestamps',()=>{
 const stats=activityStats([row('2026-10-01',10),row('2026-10-02',20),row('2026-10-02',5),row('2026-10-10',30),row('2026-10-11',40),row('2026-10-12',50),row('2026-10-14',999)],new Date('2026-10-12T12:00:00'));
 expect(stats.days.get('2026-10-02')).toBe(25);expect(stats.peak).toBe(50);expect(stats.activeDays).toBe(5);expect(stats.longest).toBe(3);expect(stats.current).toBe(3);expect(stats.days.has('2026-10-14')).toBe(false);
});
it('keeps yesterday’s streak before today has activity and ends it after an idle day',()=>{
 const rows=[row('2026-10-10',1),row('2026-10-11',1)];expect(activityStats(rows,new Date('2026-10-12T12:00:00')).current).toBe(2);expect(activityStats(rows,new Date('2026-10-13T12:00:00')).current).toBe(0);
});

import {modelManufacturer} from '../apps/console/src/UsagePanel';
import type {LocalAgentSnapshot} from '../packages/core/src/cliproxy';
it('recognizes GPT manufacturer independent of source namespace',()=>{const local={models:[]} as unknown as LocalAgentSnapshot;for(const id of ['gpt-6-astra','gpt-6.1-sol','api-custom/gpt-6.1-sol','codex/gpt-6-astra'])expect(modelManufacturer(id,local)).toBe('codex');expect(modelManufacturer('workbuddy/DeepSeek-V4-Pro',local)).toBe('deepseek');});
