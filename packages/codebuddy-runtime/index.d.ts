export type ClientTool={name:string;description?:string;parameters:Record<string,unknown>;custom?:boolean};
export type SDKUsage={input_tokens:number;output_tokens:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number};
export type SDKCall={name:string;arguments:string;custom?:boolean};
export type SDKFailureReason='source_policy_blocked'|'authentication_error'|'rate_limit_error'|'context_limit'|'output_limit'|'tool_schema'|'tool_protocol'|'turn_limit'|'text_mismatch'|'model_mismatch'|'transport'|'timeout'|'sdk_startup'|'sdk_execution'|'missing_result'|'unknown';
export type SDKDiagnostic={event:string;elapsedMs:number;kind?:string;status?:number;category?:string;subtype?:string;toolCalls?:number;reason?:SDKFailureReason;origin?:'stream'|'exception'|'result';errorCount?:number;fingerprint?:string;partialChars?:number;completeChars?:number};
export type SDKInput={token:string;region:'china'|'international';endpoint?:'https://www.workbuddy.ai';model:string;prompt:string;systemPrompt?:string;onText?:(text:string)=>void;onDiagnostic?:(event:SDKDiagnostic)=>void;images?:unknown[];tools:ClientTool[];parallelToolCalls?:boolean;signal:AbortSignal;cwd:string;configDir:string};
export type SDKResult={text:string;calls:SDKCall[];usage?:SDKUsage;model:string;failed:boolean;errorCode?:'source_policy_blocked'|'authentication_error'|'rate_limit_error'};
export function runOfficialSDK(input:SDKInput):Promise<SDKResult>;
