/** One request may contain a summary followed by inference. Activity at the
 * upstream boundary keeps both buffered and streamed calls alive.
 *
 * The idle timer guards against a silent upstream: every forwarded chunk
 * resets it, while the separate total deadline bounds the whole request.
 * 120s was shorter than the first-byte time
 * observed on qoder models that answer only after long reasoning, so a single
 * idle budget of 300s is used for both buffered and streamed calls. */
export const UPSTREAM_IDLE_TIMEOUT_MS=300_000;
export const UPSTREAM_TOTAL_TIMEOUT_MS=600_000;
export function upstreamIdle(milliseconds=UPSTREAM_IDLE_TIMEOUT_MS,totalMilliseconds=UPSTREAM_TOTAL_TIMEOUT_MS) {
 const controller=new AbortController();
 let timeoutKind:'idle'|'total'|undefined;
 let timer:ReturnType<typeof setTimeout>|undefined;
 let totalTimer:ReturnType<typeof setTimeout>|undefined;
 const close=()=>{clearTimeout(timer);clearTimeout(totalTimer);};
 const touch=()=>{
  clearTimeout(timer);
  if(!controller.signal.aborted)timer=setTimeout(()=>{timeoutKind='idle';controller.abort(new Error('Upstream idle timeout'));},milliseconds);
 };
 controller.signal.addEventListener('abort',close,{once:true});
 totalTimer=setTimeout(()=>{timeoutKind='total';controller.abort(new Error('Upstream total deadline'));},totalMilliseconds);
 touch();
 return {
  signal:controller.signal,
  get timedOut(){return timeoutKind!==undefined;},
  get timeoutKind(){return timeoutKind;},
  abort:()=>controller.abort(),
  close,
  watch(response:Response) {
   touch();
   if(!response.body)return response;
   const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({
    transform(chunk,output){touch();output.enqueue(chunk);}
   }),{signal:controller.signal});
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
 };
}
