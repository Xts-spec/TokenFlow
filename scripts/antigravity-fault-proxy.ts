// Test-only transport fault. Never imported by the application. The first
// inference connection for each identical request is closed before forwarding;
// the retry reaches the genuine vendor. Only aggregate metadata is retained.
import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
export async function antigravityFaultProxy(){
 const seen=new Set<string>();const summary={injected:0,forwarded:0,upstreamStatuses:{} as Record<string,number>};
 const server=createServer(async(req,res)=>{
  try{
   const chunks:Buffer[]=[];let bytes=0;for await(const b of req){bytes+=b.length;if(bytes>8*1024*1024){res.writeHead(413).end();return;}chunks.push(b);}
   const body=Buffer.concat(chunks);const inference=/^\/v1internal:(?:streamGenerateContent|generateContent)(?:\?|$)/.test(req.url??'');
   const id=createHash('sha256').update(body).digest('hex');
   if(inference&&!seen.has(id)){seen.add(id);summary.injected++;req.socket.destroy();return;}
   const headers:Record<string,string>={};for(const key of ['authorization','content-type','user-agent'])if(typeof req.headers[key]==='string')headers[key]=req.headers[key];
   if(inference)summary.forwarded++;
   const abort=new AbortController();req.on('aborted',()=>abort.abort());res.on('close',()=>{if(!res.writableEnded)abort.abort();});
   const result=await fetch('https://daily-cloudcode-pa.googleapis.com'+req.url,{method:req.method,headers,body:req.method==='GET'?undefined:body,redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(240000)])});
   if(inference)summary.upstreamStatuses[result.status]=(summary.upstreamStatuses[result.status]??0)+1;
   res.writeHead(result.status,{'content-type':result.headers.get('content-type')??'application/json'});
   if(result.body)Readable.fromWeb(result.body as any).on('error',()=>res.destroy()).pipe(res);else res.end();
  }catch{if(!res.headersSent)res.writeHead(502);res.end();}
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 return {url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,summary,close:async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
