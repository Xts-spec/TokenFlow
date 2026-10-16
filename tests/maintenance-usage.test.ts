import {it,expect} from 'vitest';
import {maintenanceUsage} from '../packages/core/src/maintenance-usage';
import type {UsageRow} from '../packages/core/src/usage-ledger';
const now=new Date('2026-10-16T12:00:00');
const row=(overrides:Partial<UsageRow>&{origin?:string}={}):UsageRow&{origin?:string}=>({day:'2026-10-16',target:'key',sourceId:'account-a',keyId:'key-a',keyName:'test',model:'test/model',requests:1,failed:0,unmeasured:0,inputTokens:100,cachedTokens:50,cacheBaseTokens:100,outputTokens:20,durationMs:10000,last:now.toISOString(),...overrides});
it('uses weighted streaming timing, excludes untimed output and preserves unknown speeds',()=>{
 const result=maintenanceUsage([row({timedOutputTokens:100,generationMs:1000}),row({timedOutputTokens:100,generationMs:3000}),row({outputTokens:9000}),row({model:'native/model',origin:'native',durationMs:1})],{page:'usage'},{range:'today'},now);
 expect(result.models.find(m=>m.model==='test/model')).toMatchObject({tokensPerSecond:50,timedOutputTokens:200,generationMs:4000,untimedRows:1});
 expect(result.models.find(m=>m.model==='native/model')?.tokensPerSecond).toBeNull();
});
it('uses the selected week and account, while an explicit today query overrides the calendar',()=>{
 const rows=[row({day:'2026-10-10'}),row({day:'2026-10-16'}),row({sourceId:'account-b'}),row({day:'2026-10-17'})];
 const context={page:'usage' as const,mode:'week' as const,day:'2026-10-10',sourceId:'account-a'};
 expect(maintenanceUsage(rows,context,{},now)).toMatchObject({requests:1,scope:{from:'2026-10-04',to:'2026-10-10'}});
 expect(maintenanceUsage(rows,context,{range:'today'},now)).toMatchObject({requests:1,scope:{from:'2026-10-16',to:'2026-10-16'}});
});
it('keeps selected Key, origin and model filters and bounds model output',()=>{
 const rows=[row({origin:'gateway'}),row({origin:'native'}),row({keyId:'other',origin:'gateway'})];
 expect(maintenanceUsage(rows,{page:'proxy',keyId:'key-a',origin:'gateway'},{model:'test/model'},now).requests).toBe(1);
 const many=maintenanceUsage(Array.from({length:90},(_,i)=>row({model:String(i)})),{page:'usage'}, {},now);
 expect(many.models).toHaveLength(80);expect(many.modelCount).toBe(90);expect(many.truncated).toBe(true);
});
