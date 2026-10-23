import {Dispatcher,getGlobalDispatcher} from 'undici';

/** Keep inference on the configured network route, without fetch's implicit
 * response-header/body inactivity deadlines. Connection errors still propagate. */
const inferenceDispatcher=new class extends Dispatcher {
 override dispatch(options:Dispatcher.DispatchOptions,handler:Dispatcher.DispatchHandler){
  return getGlobalDispatcher().dispatch({...options,headersTimeout:0,bodyTimeout:0},handler);
 }
};
export function inferenceFetch(url:string,options:RequestInit){
 return fetch(url,{...options,dispatcher:inferenceDispatcher} as RequestInit);
}

/** A request ends on upstream feedback or caller cancellation, not a local clock. */
export function upstreamRequest(){
 const controller=new AbortController();
 return {
  signal:controller.signal,
  abort:()=>controller.abort(),
  watch(response:Response){
   if(!response.body)return response;
   const body=response.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>(),{signal:controller.signal});
   return new Response(body,{status:response.status,statusText:response.statusText,headers:response.headers});
  }
 };
}

/** Detach a completed parallel worker from caller cancellation without affecting
 * other workers. An unfinished response still forwards cancellation upstream. */
export function finishUpstream(response:Response,detach:()=>void=()=>{}){
 if(!response.body){detach();return response;}
 const reader=response.body.getReader();
 return new Response(new ReadableStream<Uint8Array>({
  async pull(controller){try{const {done,value}=await reader.read();if(done){detach();controller.close();reader.releaseLock();}else controller.enqueue(value);}catch(error){detach();reader.releaseLock();controller.error(error);}},
  async cancel(reason){detach();await reader.cancel(reason).catch(()=>{});reader.releaseLock();}
 }),{status:response.status,statusText:response.statusText,headers:response.headers});
}
