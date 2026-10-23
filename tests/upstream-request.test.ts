import {afterEach,expect,it,vi} from 'vitest';
import {upstreamRequest,finishUpstream,inferenceFetch} from '../packages/core/src/upstream-request.js';
import {getGlobalDispatcher} from 'undici';
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
it('waits for delayed upstream feedback beyond the former idle and total deadlines',async()=>{
 vi.useFakeTimers();const request=upstreamRequest();
 await vi.advanceTimersByTimeAsync(24*60*60*1000);
 expect(request.signal.aborted).toBe(false);expect(vi.getTimerCount()).toBe(0);
 const response=request.watch(new Response('late answer'));
 expect(await response.text()).toBe('late answer');
});
it('keeps an active response and a later silent gap intact',async()=>{
 vi.useFakeTimers();const request=upstreamRequest();let source!:ReadableStreamDefaultController<Uint8Array>;
 const response=request.watch(new Response(new ReadableStream({start(c){source=c;}})));
 const reader=response.body!.getReader();
 for(let i=0;i<3;i++){
  await vi.advanceTimersByTimeAsync(700_000);source.enqueue(new Uint8Array([i]));expect((await reader.read()).value?.[0]).toBe(i);
 }
 const pending=reader.read();await vi.advanceTimersByTimeAsync(24*60*60*1000);
 expect(request.signal.aborted).toBe(false);source.enqueue(new Uint8Array([9]));expect((await pending).value?.[0]).toBe(9);
 source.close();expect((await reader.read()).done).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('propagates caller cancellation to a stalled upstream body',async()=>{
 const cancelled=vi.fn(),request=upstreamRequest();
 const response=request.watch(new Response(new ReadableStream({cancel:cancelled})));
 const reader=response.body!.getReader(),failure=expect(reader.read()).rejects.toThrow();request.abort();await failure;
 expect(cancelled).toHaveBeenCalledOnce();
});
it('preserves real upstream status codes and stream failures',async()=>{
 const request=upstreamRequest();const error=request.watch(Response.json({error:{code:'context_length_exceeded'}},{status:422}));
 expect(error.status).toBe(422);expect((await error.json()).error.code).toBe('context_length_exceeded');
 const response=request.watch(new Response(new ReadableStream({start(c){c.error(new Error('upstream disconnected'));}})));
 await expect(response.text()).rejects.toThrow('upstream disconnected');
});
it('detaches a completed worker while cancellation still reaches other workers',async()=>{
 const parent=upstreamRequest(),complete=upstreamRequest(),pending=upstreamRequest();
 const stopComplete=()=>complete.abort(),stopPending=()=>pending.abort();
 parent.signal.addEventListener('abort',stopComplete,{once:true});parent.signal.addEventListener('abort',stopPending,{once:true});
 const detach=vi.fn(()=>parent.signal.removeEventListener('abort',stopComplete));
 expect(await finishUpstream(complete.watch(new Response('done')),detach).text()).toBe('done');
 parent.abort();expect(detach).toHaveBeenCalledOnce();expect(complete.signal.aborted).toBe(false);expect(pending.signal.aborted).toBe(true);
});
it('disables implicit HTTP response timers while using the current network dispatcher',async()=>{
 const dispatch=vi.spyOn(getGlobalDispatcher(),'dispatch').mockImplementation((options,handler)=>{
  expect(options.headersTimeout).toBe(0);expect(options.bodyTimeout).toBe(0);
  handler.onConnect?.(()=>{});handler.onHeaders?.(503,[Buffer.from('content-type'),Buffer.from('application/json')],()=>{},'Service Unavailable');
  handler.onData?.(Buffer.from('{"error":{"code":"unavailable"}}'));handler.onComplete?.([]);return true;
 });
 const response=await inferenceFetch('http://upstream.test/v1/responses',{method:'POST',body:'{}'});
 expect(dispatch).toHaveBeenCalledOnce();expect(response.status).toBe(503);expect((await response.json()).error.code).toBe('unavailable');
});
