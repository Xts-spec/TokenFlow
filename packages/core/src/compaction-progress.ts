import {randomUUID} from 'node:crypto';
/** Start truthful SSE progress only when compaction actually begins. No fake
 * model text or usage is generated; failures remain terminal error events. */
export function compactionProgress(task:Promise<Response>,onCancel?:()=>void,model?:string){
 const envelope={id:'resp_tf_compact_'+randomUUID().replaceAll('-',''),object:'response',created_at:Math.floor(Date.now()/1000),model,status:'failed',output:[]};
 let cancelled=false;
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({
  async start(controller){
   const pulse=()=>{if(!cancelled)controller.enqueue(encoder.encode('event: response.in_progress\ndata: '+JSON.stringify({type:'response.in_progress',response:{...envelope,status:'in_progress',usage:null}})+'\n\n'));};
   pulse();const timer=setInterval(pulse,15000);
   try{
    const response=await task;clearInterval(timer);
    if(cancelled){await response.body?.cancel();return;}
    if(!response.ok){const payload=await response.json();controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.failed',response:{...envelope,error:payload.error??payload,usage:payload.usage}})+'\n\n'));}
    else if((response.headers.get('content-type')??'').includes('text/event-stream')){
     if(response.body){const reader=response.body.getReader();try{for(;;){const {done,value}=await reader.read();if(done)break;if(cancelled){await reader.cancel();break;}controller.enqueue(value);}}finally{reader.releaseLock();}}
    }else{const value=await response.json();if(!cancelled)controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.completed',response:value})+'\n\n'));}
   }catch(error){
    if(!cancelled){const e=error as {code?:string;message?:string;usage?:unknown};controller.enqueue(encoder.encode('data: '+JSON.stringify({type:'response.failed',response:{...envelope,error:{code:typeof e.code==='string'?e.code:'compaction_transport_failed',message:typeof e.code==='string'?e.message:'Initial compaction transport failed; completed summaries remain saved.'},usage:e.usage}})+'\n\n'));}
   }finally{clearInterval(timer);if(!cancelled)controller.close();}
  },cancel(){cancelled=true;onCancel?.();}
 });
 return new Response(stream,{headers:{'content-type':'text/event-stream','x-token-flow-compaction':'model-summary-v1'}});
}
