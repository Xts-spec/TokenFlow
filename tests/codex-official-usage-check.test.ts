import {expect,it} from 'vitest';
import {safeOfficialUsage} from '../scripts/codex-official-usage-check.js';
const summary={lifetimeTokens:123,peakDailyTokens:50,longestRunningTurnSec:null,currentStreakDays:0,longestStreakDays:null};
it('returns only documented usage fields and keeps missing, empty and zero buckets distinct',()=>{
 const value={summary:{...summary,private:'SECRET'},dailyUsageBuckets:[{startDate:'2026-10-16',tokens:0,private:'SECRET'},{startDate:'2026-10-15',tokens:25}],email:'SECRET',accessToken:'SECRET'};
 const result=safeOfficialUsage(value,'2026-10-16');expect(result.selectedBuckets).toEqual([{startDate:'2026-10-16',tokens:0}]);expect(JSON.stringify(result)).not.toContain('SECRET');
 expect(safeOfficialUsage({...value,dailyUsageBuckets:null},'2026-10-16')).toMatchObject({dailyBucketsAvailable:false,selectedBuckets:null});
 expect(safeOfficialUsage({...value,dailyUsageBuckets:[]},'2026-10-16')).toMatchObject({dailyBucketsAvailable:true,selectedBuckets:[]});
});
it('rejects malformed counters without echoing the raw payload',()=>{expect(()=>safeOfficialUsage({summary,dailyUsageBuckets:[{startDate:'2026-10-16',tokens:'SECRET'}]},'2026-10-16')).toThrow('Unexpected usage response shape');});
