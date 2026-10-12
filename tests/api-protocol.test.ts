import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { detectProtocol, sourceNameFromURL, validateQuickSource } from '../packages/core/src/api-protocol.js';

const servers:Server[]=[];
afterEach(async()=>{await Promise.all(servers.splice(0).map(s=>new Promise(r=>s.close(()=>r(null)))));});
type Handler=(path:string,headers:Record<string,unknown>,body:Record<string,unknown>)=>{status:number;json:unknown};
async function upstream(handler:Handler){
 const calls:string[]=[];
 const server=createServer(async(req,res)=>{
  let raw='';for await(const chunk of req)raw+=chunk;
  calls.push(req.url!);const result=handler(req.url!,req.headers,raw?JSON.parse(raw):{});
  res.writeHead(result.status,{'content-type':'application/json'});res.end(JSON.stringify(result.json));
 });
 servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 return {origin:`http://127.0.0.1:${(server.address() as {port:number}).port}`,calls};
}
const notFound={status:404,json:{error:{message:'not found'}}};

describe('API source protocol detection',()=>{
 it('validates the three fields locally before any request',()=>{
  expect(()=>validateQuickSource({baseURL:'nope',apiKey:'k',model:'m'})).toThrow('API 地址');
  expect(()=>validateQuickSource({baseURL:'http://example.com/v1',apiKey:'k',model:'m'})).toThrow('HTTPS');
  expect(()=>validateQuickSource({baseURL:'https://example.com/v1',apiKey:'bad key',model:'m'})).toThrow('API Key');
  expect(()=>validateQuickSource({baseURL:'https://example.com/v1',apiKey:'k',model:' , '})).toThrow('模型名称');
  expect(validateQuickSource({baseURL:'https://example.com/v1/chat/completions/',apiKey:'k',model:'a, b\na'})).toEqual({baseURL:'https://example.com/v1',models:['a','b']});
 });
 it('finds Chat Completions on a chat-only relay and does not need a protocol from the user',async()=>{
  const {origin,calls}=await upstream((path,headers,body)=>path==='/v1/chat/completions'&&headers.authorization==='Bearer sk-test'&&body.model==='m'
   ?{status:200,json:{choices:[{message:{content:'OK'}}]}}:notFound);
  await expect(detectProtocol({baseURL:`${origin}/v1`,apiKey:'sk-test',model:'m'})).resolves.toEqual({protocol:'chat',baseURL:`${origin}/v1`});
  expect(calls).toEqual(['/v1/responses','/v1/chat/completions']);
 });
 it('detects Anthropic Messages using x-api-key and tries it first for Claude models',async()=>{
  const {origin,calls}=await upstream((path,headers)=>path==='/v1/messages'&&headers['x-api-key']==='sk-ant'
   ?{status:200,json:{type:'message',content:[{type:'text',text:'OK'}]}}:notFound);
  await expect(detectProtocol({baseURL:`${origin}/v1`,apiKey:'sk-ant',model:'claude-sonnet'})).resolves.toMatchObject({protocol:'messages'});
  expect(calls).toEqual(['/v1/messages']);
 });
 it('retries Chat with max_completion_tokens for models that reject max_tokens',async()=>{
  const {origin}=await upstream((path,_headers,body)=>path!=='/v1/chat/completions'?notFound:'max_tokens' in body
   ?{status:400,json:{error:{message:"Unsupported parameter: 'max_tokens'. Use 'max_completion_tokens'."}}}:{status:200,json:{choices:[]}});
  await expect(detectProtocol({baseURL:`${origin}/v1`,apiKey:'k',model:'o-series'})).resolves.toMatchObject({protocol:'chat'});
 });
 it('adds /v1 to a bare host',async()=>{
  const {origin}=await upstream(path=>path==='/v1/responses'?{status:200,json:{object:'response',output:[]}}:notFound);
  await expect(detectProtocol({baseURL:origin,apiKey:'k',model:'m'})).resolves.toEqual({protocol:'responses',baseURL:`${origin}/v1`});
 });
 it('reports a bad key without echoing it, and a wrong URL separately',async()=>{
  const {origin}=await upstream(()=>({status:401,json:{error:{message:'Invalid key sk-secret'}}}));
  const error=await detectProtocol({baseURL:`${origin}/v1`,apiKey:'sk-secret',model:'m'}).catch(e=>e);
  expect(error.code).toBe('api_source_auth');expect(error.message).toContain('API Key');expect(error.message).not.toContain('sk-secret');
  const missing=await upstream(()=>notFound);
  await expect(detectProtocol({baseURL:`${missing.origin}/v1`,apiKey:'k',model:'m'})).rejects.toMatchObject({code:'api_source_not_found'});
 });
 it('stops at the first network failure instead of trying every protocol',async()=>{
  const {origin}=await upstream(()=>notFound);const dead=origin.replace(/:\d+$/,':1');
  await expect(detectProtocol({baseURL:`${dead}/v1`,apiKey:'k',model:'m'})).rejects.toMatchObject({code:'api_source_unreachable'});
 });
 it('names a source after its host',()=>{
  expect(sourceNameFromURL('https://api.openai.com/v1')).toBe('openai.com');
  expect(sourceNameFromURL('http://127.0.0.1:8080/v1')).toBe('本机 8080');
 });
});
