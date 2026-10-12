import {it,expect} from 'vitest';
import {upstreamError} from '../packages/core/src/upstream-errors.js';
it('reports safe parameter errors separately from source cooldown without leaking payloads',()=>{
 const result=upstreamError(400,JSON.stringify({error:{code:'a2a_invalid_request',message:'private request contents'}}));
 expect(result).toMatchObject({code:'a2a_invalid_request',type:'invalid_request_error'});
 expect(result.message).not.toContain('private request');
 expect(upstreamError(503,JSON.stringify({error:{message:'auth_unavailable: no auth available'}})).code).toBe('source_cooldown');
});
