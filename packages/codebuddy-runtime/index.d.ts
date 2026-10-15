export type ClientTool={name:string;description?:string;parameters:Record<string,unknown>;custom?:boolean};
export type SDKUsage={input_tokens:number;output_tokens:number;cache_read_input_tokens?:number;cache_creation_input_tokens?:number};
export type SDKCall={name:string;arguments:string;custom?:boolean};
export type SDKInput={token:string;region:'china'|'international';model:string;prompt:string;systemPrompt?:string;onText?:(text:string)=>void;images?:unknown[];tools:ClientTool[];parallelToolCalls?:boolean;signal:AbortSignal;cwd:string;configDir:string};
export type SDKResult={text:string;calls:SDKCall[];usage?:SDKUsage;model:string;failed:boolean;errorCode?:'source_policy_blocked'|'authentication_error'|'rate_limit_error'};
export function runOfficialSDK(input:SDKInput):Promise<SDKResult>;
