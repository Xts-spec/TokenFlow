import {expect,it} from 'vitest';
import {readSummaryResponse,summaryTranscript} from '../packages/core/src/context-summary.js';
const sse=(events:unknown[],chunk=7)=>{
 const bytes=Buffer.from(events.map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));let offset=0;
 return new Response(new ReadableStream({pull(controller){if(offset>=bytes.length){controller.close();return;}controller.enqueue(bytes.subarray(offset,offset+=chunk));}}),{headers:{'content-type':'text/event-stream'}});
};
const message={type:'message',role:'assistant',content:[{type:'output_text',text:'约束与下一步🙂'}]};
it.each(['flat','nested','failed'])('retains safe summary failure classification for %s SSE errors',async shape=>{
 const error={code:'qoder_resource_limit',message:'PRIVATE_UPSTREAM_BODY',type:'rate_limit_error'};
 const event=shape==='flat'?{...error,type:'error'}:shape==='nested'?{type:'error',error}:{type:'response.failed',response:{status:'failed',error,usage:{input_tokens:12,output_tokens:3}}};
 const result=await readSummaryResponse(sse([event]));
 expect(result.status).toBe('failed');expect(result.error).toMatchObject({code:'qoder_resource_limit',type:'rate_limit_error'});
 expect(result.error.message).toContain('资源限流');expect(JSON.stringify(result)).not.toContain('PRIVATE');
 if(shape==='failed')expect(result.usage).toEqual({input_tokens:12,output_tokens:3});
});
it('removes unrecognized provider error details from failed summaries',async()=>{
 const result=await readSummaryResponse(sse([{type:'response.failed',response:{status:'failed',error:{code:'PRIVATE_CODE',message:'PRIVATE_UPSTREAM_BODY',extra:'PRIVATE_FIELD'}}}]));
 expect(result.error).toMatchObject({type:'provider_error'});expect(JSON.stringify(result)).not.toContain('PRIVATE');
});
it('does not duplicate delta, done and terminal text and survives split UTF-8/events',async()=>{
 const result=await readSummaryResponse(sse([
  {type:'response.output_text.delta',delta:'约束与下一步🙂'},
  {type:'response.output_item.done',output_index:0,item:message},
  {type:'response.completed',response:{status:'completed',output:[message]}},
 ]));
 expect(result.output).toEqual([message]);
});
it('finishes at the terminal event even if the upstream keeps the connection open',async()=>{
 let cancelled=false;let controller!:ReadableStreamDefaultController<Uint8Array>;
 const body=new ReadableStream<Uint8Array>({start(c){controller=c;c.enqueue(Buffer.from('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[message]}})+'\n\n'));},cancel(){cancelled=true;}});
 const reading=readSummaryResponse(new Response(body,{headers:{'content-type':'text/event-stream'}}));
 const outcome=await Promise.race([reading,new Promise<null>(resolve=>setTimeout(()=>resolve(null),30))]);
 if(outcome===null){controller.error(Error('test cleanup'));await reading.catch(()=>{});}
 expect(outcome?.status).toBe('completed');expect(cancelled).toBe(true);
});
it('never treats a truncated stream or reasoning-only response as a summary',async()=>{
 await expect(readSummaryResponse(sse([{type:'response.output_text.delta',delta:'partial'}]))).rejects.toThrow('before completion');
 const result=await readSummaryResponse(sse([{type:'response.reasoning_summary_text.delta',delta:'thinking'},{type:'response.completed',response:{status:'completed',output:[]}}]));
 expect(result.output).toEqual([]);
});
it('retains a tool-request flag even if a bridge omits tools from terminal output',async()=>{
 const result=await readSummaryResponse(sse([{type:'response.output_item.done',item:{type:'function_call',call_id:'bad',name:'write'}},{type:'response.completed',response:{status:'completed',output:[message]}}]));
 expect(result.summary_requested_tools).toBe(true);
});
it('preserves complete tool text while omitting binary attachments from the text transcript',()=>{
 const user={role:'user',content:[{type:'input_text',text:'必须保留 API，不得删除文件。'},{type:'input_image',image_url:'data:image/png;base64,'+'x'.repeat(100000)}]};
 const value=summaryTranscript([user,{type:'custom_tool_call_output',call_id:'a',output:[{type:'text',text:'工具结果'.repeat(100000)}]}]);
 expect(JSON.parse(value)[1].output[0].text).toBe('工具结果'.repeat(100000));expect(value).toContain('必须保留 API');expect(value).not.toContain('middle omitted');expect(value).not.toContain('base64');
 expect(user.content[1]!.image_url).toContain('base64');
});

it.each(['json','sse'])('reads a large %s summary without a fixed response-byte cutoff',async format=>{
 const text='x'.repeat(5*1024*1024);
 const complete={status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}]};
 const response=format==='json'?Response.json(complete):sse([{type:'response.output_text.delta',delta:text},{type:'response.completed',response:{status:'completed',output:[]}}],64*1024);
 const result=await readSummaryResponse(response);
 expect(result.output[0].content[0].text).toHaveLength(text.length);
});

it('preserves the middle of tool arguments, string outputs and every assistant text block',()=>{
 const text='start '+ '完整🙂'.repeat(10000)+' middle fact '+ 'end '.repeat(10000);
 const input=[{type:'function_call',arguments:JSON.stringify({text})},{type:'custom_tool_call',input:text},{type:'function_call_output',output:text},{role:'assistant',content:text},{role:'assistant',content:[{type:'output_text',text}]}];
 const before=JSON.stringify(input);expect(JSON.parse(summaryTranscript(input))).toEqual(input);expect(JSON.stringify(input)).toBe(before);
});
