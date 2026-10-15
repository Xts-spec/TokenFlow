// Opt-in CLI telemetry for synthetic stress probes only. Never records headers,
// URLs, prompts, response bodies, credentials, or thinking text.
const dc=require('node:diagnostics_channel');
const {openSync,closeSync}=require('node:fs');
const {createHash}=require('node:crypto');
const {monitorEventLoopDelay}=require('node:perf_hooks');
const begin=Date.now(),requests=new WeakMap(),streams=new Set();let next=0;
const emit=value=>process.stderr.write('[TF_NETWORK_PROBE]'+JSON.stringify({elapsedMs:Date.now()-begin,...value})+'\n');
function entry(request,path){let value=requests.get(request);if(!value){value={id:++next,endpoint:createHash('sha256').update(String(path??'').split('?')[0]).digest('hex').slice(0,12)};requests.set(request,value);}return value;}
for(const [name,event] of [['undici:request:create','start'],['undici:request:headers','headers'],['undici:request:trailers','end'],['undici:request:error','error']])dc.channel(name).subscribe(({request,response,error})=>emit({transport:'undici',event,...entry(request,request.path),status:response?.statusCode,code:typeof error?.code==='string'?error.code:undefined}));
dc.channel('http.client.request.start').subscribe(({request})=>{
 const details=entry(request,request.path);emit({transport:'http',event:'start',...details});
 request.once('response',response=>{
  if(details.endpoint==='1fa0cbaf115c'){const stream={response,details};streams.add(stream);response.once('close',()=>streams.delete(stream));}
  // Explicit fault injection in an isolated probe only: hold a model stream
  // after synthetic thinking, suppressing its body/end without changing the
  // remote request, credentials, or any non-model endpoint. Marker is shared
  // across attempts so the next actual model request is left untouched.
  if(process.env.TF_PROBE_STALL_ONCE&&details.endpoint==='1fa0cbaf115c'&&response.statusCode===200){
   let inject=false;try{closeSync(openSync(process.env.TF_PROBE_STALL_ONCE,'wx'));inject=true;}catch(error){if(error.code!=='EEXIST')throw error;}
   if(inject){
    const original=response.emit;let first=true;
    response.emit=function(event,...args){
     if(event==='data'){
      if(first){first=false;const model=process.argv[process.argv.indexOf('--model')+1];emit({event:'injected_thinking_stall',...details});
       return original.call(this,'data',Buffer.from('data: '+JSON.stringify({id:'synthetic-idle',object:'chat.completion.chunk',model,choices:[{index:0,delta:{role:'assistant',reasoning_content:'synthetic diagnostic stall'},finish_reason:null}]})+'\n\n'));
      }return true;
     }
     if(event==='end'||event==='close')return true;
     return original.call(this,event,...args);
    };
   }
  }
  emit({transport:'http',event:'headers',...details,status:response.statusCode});
  response.once('end',()=>emit({transport:'http',event:'end',...details}));
  response.once('aborted',()=>emit({transport:'http',event:'aborted',...details}));
 });
 request.once('error',error=>emit({transport:'http',event:'error',...details,code:typeof error?.code==='string'?error.code:undefined}));
});
const histogram=monitorEventLoopDelay({resolution:20});histogram.enable();
const timer=setInterval(()=>{for(const {response,details} of streams)emit({event:'model_stream_state',...details,complete:response.complete,ended:response.readableEnded,paused:response.isPaused(),bufferedBytes:response.readableLength,socketBytesRead:response.socket?.bytesRead});emit({event:'event_loop',maxMs:Math.round(histogram.max/1e6),meanMs:Math.round(histogram.mean/1e6),rssMB:Math.round(process.memoryUsage().rss/1024/1024)});histogram.reset();},5000);timer.unref();
