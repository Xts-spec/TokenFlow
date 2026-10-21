import type {LocalAgentSnapshot} from '../../../packages/core/src/cliproxy';
import type {UsageData} from './usage-data';
import {UsageSummary,SourceUsage,ModelUsage} from './UsagePanel';
import {NativeUsageCoverage} from './NativeUsageCoverage';

/** The emitter is independent of the billing account, model catalog and current configuration. */
export function AgentUsageDetails({target,local,usage,open}:{target:string;local:LocalAgentSnapshot;usage:UsageData;open?:boolean}){
 const rows=usage.combinedRows.filter(row=>row.target===target);
 return <details className="tfUsageDetails" open={open}><summary>按来源与模型查看用量</summary>
  <UsageSummary rows={rows} range={usage.range} onRange={usage.setRange} loaded={usage.loaded} hint="统计本机此客户端发出的已采集请求，包含官方登录、其他账号和自定义 API；切换账号或模型后保留历史。"/>
  <SourceUsage local={local} rows={rows} showQuota={false} empty="暂无已采集的消费来源"/>
  <ModelUsage local={local} rows={rows} empty="暂无已采集的模型用量"/>
  <NativeUsageCoverage coverage={usage.coverage.filter(item=>item.target===target)} scanning={usage.scanning}/>
 </details>;
}
