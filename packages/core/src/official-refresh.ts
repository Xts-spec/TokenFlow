import {setTimeout as delay} from 'node:timers/promises';

export const refreshNetworkHint='可以切换网络后刷新试试。';
export class OfficialReadTransportError extends Error {}
export function transientOfficialRead(error:unknown):boolean {
 const e=error as {status?:number;statusCode?:number;code?:string;name?:string;cause?:unknown}|undefined;
 const status=e?.status??e?.statusCode;
 if(status!==undefined)return [408,500,502,503,504].includes(status);
 return error instanceof OfficialReadTransportError||e?.name==='TimeoutError'||e?.name==='NetworkError'||e?.code==='deadline_exceeded'||e?.code==='unavailable'||
  ['ECONNRESET','ECONNREFUSED','ETIMEDOUT','ENOTFOUND','EAI_AGAIN','UND_ERR_CONNECT_TIMEOUT','UND_ERR_SOCKET'].includes(e?.code??'')||
  e?.name==='TypeError'&&error instanceof Error&&/fetch|network/i.test(error.message)||!!e?.cause&&transientOfficialRead(e.cause);
}

/** Read-only account metadata only: one initial request and at most two retries. */
export async function retryOfficialRead<T>(read:(attempt:number)=>Promise<T>,options:{signal?:AbortSignal;retryError?:(error:unknown)=>boolean;retryResult?:(result:T)=>boolean;onRetry?:(attempt:number)=>void}={}):Promise<T>{
 for(let attempt=1;;attempt++){
  options.signal?.throwIfAborted();
  try{
   const result=await read(attempt);
   options.signal?.throwIfAborted();
   if(attempt===3||!options.retryResult?.(result))return result;
  }catch(error){
   options.signal?.throwIfAborted();
   if(attempt===3||!(options.retryError??transientOfficialRead)(error))throw error;
  }
  options.onRetry?.(attempt+1);
  await delay(1000*2**(attempt-1),undefined,{signal:options.signal});
 }
}
