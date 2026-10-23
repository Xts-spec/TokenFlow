import {afterEach,expect,it} from 'vitest';
import {createServer as httpServer} from 'node:http';
import {createServer} from 'node:net';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zstdCompressSync} from 'node:zlib';
import {GatewayAccess} from '../packages/core/src/gateway-access.js';
import {ApiSources,apiModelID} from '../packages/core/src/api-sources.js';
import {defaultProvider} from '../packages/core/src/providers.js';
const cleanup:Array<()=>Promise<unknown>>=[];afterEach(async()=>{for(const fn of cleanup.splice(0).reverse())await fn();});
async function root(){const path=await mkdtemp(join(tmpdir(),'gateway-payload-'));cleanup.push(()=>rm(path,{recursive:true,force:true}));return path;}
it('accepts compressed LAN uploads whose complete decoded history exceeds 32 MiB',async()=>{
 const access=await GatewayAccess.open(await root(),{authenticate:key=>key==='fixture-key'?{access:'lan',exported:true} as any:undefined});cleanup.push(()=>access.close());
 access.app.post('/v1/responses',{bodyLimit:Number.MAX_SAFE_INTEGER},async request=>({bytes:Buffer.byteLength((request.body as {input:string}).input),ending:(request.body as {input:string}).input.slice(-6)}));
 const allocator=createServer();await new Promise<void>(r=>allocator.listen(0,'127.0.0.1',r));const port=(allocator.address() as {port:number}).port;await new Promise<void>(r=>allocator.close(()=>r()));await access.update({enabled:true,port,allowedIPs:[]});
 const text='x'.repeat(33*1024*1024)+'末尾🙂';const response=await fetch(`http://127.0.0.1:${port}/v1/responses`,{method:'POST',headers:{authorization:'Bearer fixture-key','content-type':'application/json','content-encoding':'zstd'},body:zstdCompressSync(Buffer.from(JSON.stringify({input:text})))});
 expect(response.status).toBe(200);expect(await response.json()).toEqual({bytes:Buffer.byteLength(text),ending:text.slice(-6)});
});
it('passes API inference bodies and individual response events beyond the former 16 MiB ceiling intact',async()=>{
 const text='x'.repeat(17*1024*1024)+'完整🙂';let received='';
 const upstream=httpServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);received=JSON.parse(Buffer.concat(chunks).toString()).input;
  res.writeHead(200,{'content-type':'text/event-stream'});res.end('data: '+JSON.stringify({type:'response.completed',response:{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text}]}],usage:{input_tokens:1,output_tokens:1}}})+'\n\n');
 });await new Promise<void>(r=>upstream.listen(0,'127.0.0.1',r));cleanup.push(()=>new Promise<void>(r=>{upstream.closeAllConnections();upstream.close(()=>r());}));
 const vault=new Map<string,string>();const source=await ApiSources.open(await root(),{get:async key=>vault.get(key)??'',set:async(key,value)=>{vault.set(key,value);}},defaultProvider);cleanup.push(()=>source.close());
 const saved=await source.save({name:'fixture',baseURL:`http://127.0.0.1:${(upstream.address() as {port:number}).port}/v1`,protocol:'responses',apiKey:'fixture-upstream',models:['fixture-model'],enabled:true});
 const response=await source.response(saved.id,'responses',{model:apiModelID(saved.id,'fixture-model'),input:text,stream:true} as any,new AbortController().signal);
 expect(response.status).toBe(200);const stream=await response.text();const event=JSON.parse(stream.slice(6));expect(received).toBe(text);expect(event.response.output[0].content[0].text).toBe(text);
});
