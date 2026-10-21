import type {GatewayTrace,TraceSummary} from './gateway-traces.js';
import type {LocalUsageRow,UsageChannel} from './local-usage.js';
export type ActivityTrace=TraceSummary&{origin?:'gateway'|'native';credits?:number;channel?:UsageChannel;accountLabel?:string;accountEvidence?:LocalUsageRow['nativeAccountEvidence'];timingKnown?:boolean;statusKnown?:boolean;toolTraceKnown?:boolean};
export type ActivityTraceDetail=GatewayTrace&Pick<ActivityTrace,'origin'|'credits'|'channel'|'accountLabel'|'accountEvidence'|'timingKnown'|'statusKnown'|'toolTraceKnown'>;
export function nativeActivityTrace(row:LocalUsageRow):ActivityTraceDetail{
 if(!row.sampleId)throw new Error('Native activity requires a distinct usage sample');
 return {id:`native-${row.sampleId}`,runId:`native-${row.sampleId}`,keyId:row.keyId,agent:row.target,target:row.target,sourceId:row.sourceId,model:row.model,protocol:'native',startedAt:row.last,durationMs:0,status:0,inputTokens:row.unmeasured?null:row.inputTokens,cachedTokens:row.unmeasured?null:row.cachedTokens,cacheWriteTokens:row.cacheWriteTokens??null,outputTokens:row.unmeasured?null:row.outputTokens,reasoningTokens:row.reasoningTokens??null,inputs:{system:0,user:0,assistant:0,tool:0},tools:[],results:[],origin:'native',credits:row.credits,channel:row.channel,accountLabel:row.nativeAccountLabel,accountEvidence:row.nativeAccountEvidence,timingKnown:false,statusKnown:false,toolTraceKnown:false};
}
export function nativeActivitySummary(row:LocalUsageRow):ActivityTrace{return {...nativeActivityTrace(row),toolCalls:0,toolResults:0,toolNames:[]};}
