import {afterEach,expect,it,vi} from 'vitest';
import {LoginController} from '../packages/core/src/login/controller.js';
import type {LoginHost} from '../packages/core/src/login/types.js';

afterEach(()=>vi.useRealTimers());
it('keeps successful authorization when account discovery fails after credentials are saved',async()=>{
  vi.useFakeTimers();
  const host:LoginHost={start:async()=>{},request:async path=>path==='/workbuddy-auth-url'?{status:'ok',state:'fixture-state',url:'https://copilot.tencent.com/login?state=fixture-state',flow:'device',expires_in:300}:{status:'ok'},
    refreshAccounts:async()=>{throw new Error('catalog timed out');},accounts:()=>[],modelCount:()=>0,log:vi.fn(),closing:()=>false,options:{pollIntervalMs:10}};
  const controller=new LoginController(host);
  try{
    await controller.login('workbuddy');await vi.advanceTimersByTimeAsync(10);
    expect(controller.snapshot()).toMatchObject({status:'completed',message:expect.stringContaining('凭据已保存')});
    expect(controller.snapshot()?.message).toContain('无需重复登录');
  }finally{controller.close();}
});

it('reports a device-poll network failure with a safe category and no callback-port advice',async()=>{
  vi.useFakeTimers();const logs:string[]=[];
  const host:LoginHost={start:async()=>{},request:async path=>path==='/workbuddy-auth-url'?{status:'ok',state:'private-state',url:'https://copilot.tencent.com/login?state=private-state',flow:'device',expires_in:300}:{status:'error',error:'Authentication failed: Get https://copilot.tencent.com/?code=private-code: proxyconnect tcp: connection refused Authorization Bearer private-token'},
    refreshAccounts:async()=>{},accounts:()=>[],modelCount:()=>0,log:s=>logs.push(s),closing:()=>false,options:{pollIntervalMs:10}};
  const controller=new LoginController(host);
  try{
    await controller.login('workbuddy');await vi.advanceTimersByTimeAsync(10);
    expect(controller.snapshot()).toMatchObject({status:'failed',diagnostic:{stage:'device_poll',code:'connection_refused'}});
    expect(controller.snapshot()?.message).not.toContain('回调端口');
    expect(JSON.stringify({snapshot:controller.snapshot(),logs})).not.toMatch(/private-|Authorization|Bearer/);
  }finally{controller.close();}
});
