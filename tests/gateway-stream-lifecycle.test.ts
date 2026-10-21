import {afterEach,expect,it} from 'vitest';
import {createServer,type ServerResponse} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDesktopService} from '../packages/core/src/service.js';

const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();});

it.each(['cancel','error-cancel','upstream-close','eof','complete'] as const)('records %s after Messages starts without confusing cancellation with upstream failure',async outcome=>{
 let upstreamResponse!:ServerResponse;
 const first='data: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":0}}}\n\n';
 const upstream=createServer(async(req,res)=>{
  for await(const _ of req){/* Drain the request before starting the response. */}
  upstreamResponse=res;res.writeHead(200,{'content-type':'text/event-stream'});res.write(first);
 });
 await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));
 cleanup.push(()=>new Promise<void>(r=>{upstream.closeAllConnections();upstream.close(()=>r());}));
 const root=await mkdtemp(join(tmpdir(),'gateway-stream-'));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const service=await createDesktopService({root,binary:'/missing',token:'admin',localKey:'internal',secrets:{get:async()=>'',set:async()=>{}},agentPaths:{codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),qoder:join(root,'qoder/settings.json'),workbuddy:join(root,'workbuddy/models.json')}});
 cleanup.push(()=>service.app.close());
 const origin=await service.app.listen({host:'127.0.0.1',port:0});
 const headers={host:new URL(origin).host,authorization:'Bearer admin'};
 const configured=await service.app.inject({method:'PUT',url:'/api/settings',headers,payload:{provider:{kind:'custom',baseURL:`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`,model:'fixture',historyMode:'stateless',reasoning:'off'}}});
 expect(configured.statusCode).toBe(200);
 const controller=new AbortController();
 const response=await fetch(`${origin}/v1/messages`,{method:'POST',headers:{...headers,'content-type':'application/json'},body:JSON.stringify({model:'fixture',stream:true,messages:[{role:'user',content:'hello'}]}),signal:controller.signal});
 const reader=response.body!.getReader();expect(new TextDecoder().decode((await reader.read()).value)).toContain('message_start');
 if(outcome==='cancel')controller.abort();
 else if(outcome==='error-cancel'){
  upstreamResponse.write('data: {"type":"error","error":{"type":"overloaded_error","code":"overloaded","message":"upstream overloaded"}}\n\n');
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('overloaded');
  controller.abort();
 }
 else if(outcome==='upstream-close')upstreamResponse.destroy();
 else upstreamResponse.end(outcome==='complete'?'data: {"type":"message_delta","usage":{"output_tokens":3}}\n\ndata: {"type":"message_stop"}\n\n':'');
 try{while(!(await reader.read()).done){/* Drain to completion or transport failure. */}}catch{/* Expected for cancellation and a broken transport. */}
 const traces=async()=>(await service.app.inject({url:'/api/gateway/traces',headers})).json().records;
 await expect.poll(async()=>(await traces()).length).toBe(1);
 const [trace]=await traces();
 expect(trace).toMatchObject({status:outcome==='cancel'?499:outcome==='complete'?200:502,inputTokens:7});
 if(outcome==='cancel')expect(trace.error).toEqual({code:'request_cancelled',message:'客户端已取消请求。'});
 else if(outcome==='error-cancel')expect(trace.error.code).toBe('provider_error');
 else if(outcome==='complete')expect(trace.error).toBeUndefined();
 else expect(trace.error.code).toBe(outcome==='eof'?'upstream_incomplete_response':'upstream_stream_error');
});
