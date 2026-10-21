import {afterEach,expect,it,vi} from 'vitest';
import {retryOfficialRead,OfficialReadTransportError} from '../packages/core/src/official-refresh.js';
vi.mock('node:timers/promises',()=>({setTimeout:vi.fn(async(_ms:number,_value:unknown,options:{signal?:AbortSignal})=>{options.signal?.throwIfAborted();})}));
import {setTimeout as delay} from 'node:timers/promises';
afterEach(()=>vi.clearAllMocks());

it('bounds exhausted metadata retries at three requests with a one- and two-second backoff',async()=>{
 const error=new OfficialReadTransportError('temporary');const read=vi.fn().mockRejectedValue(error);
 await expect(retryOfficialRead(read)).rejects.toBe(error);
 expect(read).toHaveBeenCalledTimes(3);expect(vi.mocked(delay).mock.calls.map(c=>c[0])).toEqual([1000,2000]);
});
it('returns the last stale snapshot after two failed refresh retries',async()=>{
 const result={status:'stale'},read=vi.fn().mockResolvedValue(result);
 expect(await retryOfficialRead<{status:string}>(read,{retryResult:r=>r.status==='stale'})).toBe(result);
 expect(read.mock.calls).toEqual([[1],[2],[3]]);
});
it.each([400,401,403,404,429])('does not retry a definitive HTTP %s failure',async status=>{
 const read=vi.fn().mockRejectedValue(Object.assign(new Error('denied'),{status}));
 await expect(retryOfficialRead(read)).rejects.toThrow('denied');expect(read).toHaveBeenCalledOnce();
});
it('stops backoff when the application closes and does not retry malformed data',async()=>{
 const controller=new AbortController(),read=vi.fn().mockRejectedValue(new OfficialReadTransportError('temporary'));
 await expect(retryOfficialRead(read,{signal:controller.signal,onRetry:()=>controller.abort()})).rejects.toThrow();expect(read).toHaveBeenCalledOnce();
 const invalid=vi.fn().mockRejectedValue(new SyntaxError('malformed'));
 await expect(retryOfficialRead(invalid)).rejects.toThrow('malformed');expect(invalid).toHaveBeenCalledOnce();
});
