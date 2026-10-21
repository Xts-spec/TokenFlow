import {afterEach,expect,it,vi} from 'vitest';
import {upstreamIdle,UPSTREAM_IDLE_TIMEOUT_MS} from '../packages/core/src/upstream-idle.js';
afterEach(()=>vi.useRealTimers());
it('stops an indefinitely active upstream at the total deadline',async()=>{
 vi.useFakeTimers();const idle=upstreamIdle(100,250);
 await vi.advanceTimersByTimeAsync(80);idle.watch(new Response(null));
 await vi.advanceTimersByTimeAsync(80);idle.watch(new Response(null));
 await vi.advanceTimersByTimeAsync(80);idle.watch(new Response(null));
 expect(idle.signal.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(11);expect(idle.timedOut).toBe(true);expect(vi.getTimerCount()).toBe(0);
});
it('allows active streams past the original deadline, then aborts stalled input',async()=>{
 vi.useFakeTimers();const idle=upstreamIdle(100);
 let source!:ReadableStreamDefaultController<Uint8Array>;
 const response=idle.watch(new Response(new ReadableStream({start(c){source=c;}})));
 const reader=response.body!.getReader();
 for(let i=0;i<5;i++){
  await vi.advanceTimersByTimeAsync(80);source.enqueue(new Uint8Array([i]));expect((await reader.read()).value?.[0]).toBe(i);expect(idle.signal.aborted).toBe(false);
 }
 const pending=reader.read();const failure=expect(pending).rejects.toThrow(/idle timeout/);
 await vi.advanceTimersByTimeAsync(101);await failure;expect(idle.signal.aborted).toBe(true);idle.close();
});
it('propagates cancellation to upstream and clears the deadline',async()=>{
 vi.useFakeTimers();const cancelled=vi.fn();const idle=upstreamIdle(100);
 const response=idle.watch(new Response(new ReadableStream({cancel:cancelled})));
 const reader=response.body!.getReader();const failure=expect(reader.read()).rejects.toThrow();idle.abort();await failure;
 await vi.advanceTimersByTimeAsync(0);expect(cancelled).toHaveBeenCalledOnce();expect(vi.getTimerCount()).toBe(0);
});

it('defaults to a budget long enough for slow first-byte reasoning',async()=>{
 vi.useFakeTimers();const idle=upstreamIdle();
 expect(UPSTREAM_IDLE_TIMEOUT_MS).toBe(300_000);
 await vi.advanceTimersByTimeAsync(120_001);expect(idle.signal.aborted).toBe(false);
 await vi.advanceTimersByTimeAsync(300_000-120_001);expect(idle.signal.aborted).toBe(true);expect(idle.timedOut).toBe(true);idle.close();
});
it('distinguishes an upstream deadline from client cancellation',async()=>{
 vi.useFakeTimers();const idle=upstreamIdle(100);await vi.advanceTimersByTimeAsync(101);
 expect(idle.timedOut).toBe(true);idle.abort();expect(idle.timedOut).toBe(true);
 const cancelled=upstreamIdle(100);cancelled.abort();expect(cancelled.timedOut).toBe(false);
});
