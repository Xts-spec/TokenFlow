import {expect,it} from 'vitest';
import {LocalUsageParser,recentLocalUsageRows,mergeLocalUsageRows} from '../packages/core/src/local-usage.js';
import {nativeActivityTrace} from '../packages/core/src/activity-traces.js';
it('deduplicates native activity by response without converting daily totals into requests',()=>{
 const p=new LocalUsageParser('codex','fixture');p.accept({type:'session_meta',payload:{model_provider:'openai',auth_mode:'chatgpt'}});p.accept({type:'turn_context',payload:{model:'gpt-test'}});
 for(const [id,time]of [['response-one','2026-10-14T01:00:00Z'],['response-two','2026-10-14T02:00:00Z']])p.accept({type:'token_usage_record',timestamp:time,payload:{response_id:id,usage:{input_tokens:100,output_tokens:20}}});
 const rows=recentLocalUsageRows([...p.rows(),...p.rows(),...mergeLocalUsageRows(p.rows())]);expect(rows).toHaveLength(2);expect(rows[0].last).toBe('2026-10-14T02:00:00Z');expect(recentLocalUsageRows(rows,1)).toHaveLength(1);
 const detail=nativeActivityTrace(rows[0]);expect(detail).toMatchObject({origin:'native',channel:'official',timingKnown:false,statusKnown:false,toolTraceKnown:false,inputTokens:100,outputTokens:20});expect(detail.id).toMatch(/^native-[a-f0-9]{64}$/);expect(JSON.stringify(detail)).not.toContain('response-two');
});
it('excludes gateway responses from native activity and preserves unknown channel attribution',()=>{
 const p=new LocalUsageParser('claude','fixture',{matchesResponse:id=>id==='via-gateway'});
 for(const id of ['via-gateway','unknown-source'])p.accept({type:'assistant',timestamp:'2026-10-14T02:00:00Z',message:{id,model:'claude-test',content:[{text:'PRIVATE_MESSAGE'}],usage:{input_tokens:3,output_tokens:2}}});
 const rows=recentLocalUsageRows(p.rows());expect(rows).toHaveLength(1);const detail=nativeActivityTrace(rows[0]);expect(detail.channel).toBe('unknown');expect(JSON.stringify(detail)).not.toContain('PRIVATE_MESSAGE');
});
