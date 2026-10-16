import {it,expect} from 'vitest';
import {createServer} from 'node:http';
import {probeModelHTTP,networkFailure,modelProbeInput,type ProbeProtocol} from '../packages/core/src/maintenance-http.js';
const signal=()=>new AbortController().signal;
const sse=(events:unknown[])=>new Response(events.map(e=>`data: ${JSON.stringify(e)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
it.each<ProbeProtocol>(['responses','messages','chat/completions'])('requires real text and completion for %s without returning response contents',async protocol=>{
 const events=protocol==='responses'?[{type:'response.output_text.delta',delta:'PRIVATE-TEXT'},{type:'response.completed',response:{status:'completed'}}]:protocol==='messages'?[{type:'content_block_delta',delta:{type:'text_delta',text:'PRIVATE-TEXT'}},{type:'message_stop'}]:[{choices:[{delta:{content:'PRIVATE-TEXT'},finish_reason:'stop'}]}];
 const result=await probeModelHTTP(protocol,'test/model',async body=>{expect(JSON.stringify(body)).toContain('Reply OK only.');expect(body).toHaveProperty('stream',true);expect(body).toHaveProperty(protocol==='responses'?'max_output_tokens':'max_tokens',128);return sse(events);},signal());
 expect(result).toMatchObject({passed:true,category:'passed',httpStatus:200,complete:true,outputChars:12});expect(result.firstOutputMs).toBeGreaterThanOrEqual(0);expect(JSON.stringify(result)).not.toContain('PRIVATE-TEXT');
});
it.each([[302,'redirect'],[401,'authentication'],[403,'permission'],[429,'rate_or_quota'],[400,'request_compatibility'],[404,'model_or_endpoint'],[502,'upstream_or_gateway'],[504,'timeout']] as const)('classifies HTTP %s without echoing upstream diagnostics',async(status,category)=>{
 const result=await probeModelHTTP('responses','test',async()=>new Response(JSON.stringify({error:{code:'private-key',message:'Bearer secret private body'}}),{status}),signal());
 expect(result).toMatchObject({passed:false,httpStatus:status,category});expect(JSON.stringify(result)).not.toMatch(/private-key|secret|private body/);
});
it('does not accept incomplete streams, blank successes or embedded SSE errors as success',async()=>{
 for(const response of [sse([{type:'response.created'}]),sse([{type:'response.completed',response:{output:[]}}]),sse([{type:'response.output_text.delta',delta:'ok'},{type:'error',error:{code:'source_policy_blocked',message:'private'}}])]){
  const result=await probeModelHTTP('responses','test',async()=>response,signal());expect(result.passed).toBe(false);
 }
 const policy=await probeModelHTTP('responses','test',async()=>sse([{type:'error',error:{code:'source_policy_blocked'}}]),signal());expect(policy.category).toBe('source_policy');
});
it('bounds large bodies and rejects arbitrary commands, destinations or credentials',async()=>{
 const result=await probeModelHTTP('responses','test',async()=>new Response('x'.repeat(1024*1024+1)),signal());expect(result.category).toBe('response_limit');
 for(const field of ['command','url','headers','apiKey','prompt'])expect(modelProbeInput.safeParse({[field]:'untrusted'}).success).toBe(false);
});
it.each([['ENOTFOUND','dns'],['ECONNREFUSED','connection_refused'],['CERT_HAS_EXPIRED','tls'],['UND_ERR_HEADERS_TIMEOUT','timeout'],['ECONNRESET','connection_reset'],['PRIVATE','network_unknown']])('classifies transport code %s only',async(code,category)=>{
 const error=new Error('secret-host',{cause:{code,message:'secret-token'}});expect(networkFailure(error)).toBe(category);
 const result=await probeModelHTTP('responses','test',async()=>{throw error;},signal());expect(result.category).toBe(category);expect(JSON.stringify(result)).not.toContain('secret');
});
it('times out and cancels a real hanging HTTP response, including after headers arrive',async()=>{
 const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream'});res.write(': keepalive\n\n');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const port=(server.address() as {port:number}).port;
 try{
  const request=(body:object,s:AbortSignal)=>fetch(`http://127.0.0.1:${port}`,{method:'POST',body:JSON.stringify(body),signal:s});
  const result=await probeModelHTTP('responses','test',request,signal(),100);expect(result.category).toBe('timeout');expect(result.firstOutputMs).toBeUndefined();expect(result.durationMs).toBeLessThan(2000);
  const controller=new AbortController();controller.abort();const stopped=await probeModelHTTP('responses','test',request,controller.signal);expect(stopped.category).toBe('cancelled');
 }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
