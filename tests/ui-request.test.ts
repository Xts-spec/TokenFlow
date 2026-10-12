import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJSON } from '../apps/console/src/request';

afterEach(()=>vi.unstubAllGlobals());
describe('UI request recovery',()=>{
  it('never retries a timed out mutation and marks the result uncertain',async()=>{
    const fetch=vi.fn((_path,init)=>new Promise((_resolve,reject)=>{
      init.signal.addEventListener('abort',()=>reject(init.signal.reason));
    }));
    vi.stubGlobal('fetch',fetch);
    await expect(requestJSON('/api/a2a/connect',{method:'POST'},5)).rejects.toThrow('操作结果尚未确认');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('gives actionable read-timeout recovery',async()=>{
    vi.stubGlobal('fetch',(_path:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal!.addEventListener('abort',()=>reject(init.signal!.reason));
    }));
    await expect(requestJSON('/api/a2a',{},5)).rejects.toThrow('网络或代理设置');
  });
  it('cancels a verification without confusing it with a server failure',async()=>{
    const controller=new AbortController();
    vi.stubGlobal('fetch',(_path:unknown,init:RequestInit)=>new Promise((_resolve,reject)=>{
      init.signal!.addEventListener('abort',()=>reject(init.signal!.reason));
    }));
    const operation=requestJSON('/v1/models',{signal:controller.signal});
    controller.abort();
    await expect(operation).rejects.toThrow('已取消验证');
  });
  it('preserves the server refusal without issuing another request',async()=>{
    const fetch=vi.fn().mockResolvedValue(new Response(JSON.stringify({error:{message:'配置已变化'}}),{status:409}));
    vi.stubGlobal('fetch',fetch);
    await expect(requestJSON('/api/a2a/restore',{method:'POST'})).rejects.toThrow('配置已变化');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
