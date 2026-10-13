import {it,expect} from 'vitest';
import {upstreamError} from '../packages/core/src/upstream-errors.js';
it('reports safe parameter errors separately from source cooldown without leaking payloads',()=>{
 const result=upstreamError(400,JSON.stringify({error:{code:'a2a_invalid_request',message:'private request contents'}}));
 expect(result).toMatchObject({code:'a2a_invalid_request',type:'invalid_request_error'});
 expect(result.message).not.toContain('private request');
 expect(upstreamError(503,JSON.stringify({error:{message:'auth_unavailable: no auth available'}})).code).toBe('source_cooldown');
});
it('keeps safe WorkBuddy field paths while discarding provider text and arbitrary fields',()=>{
 const result=upstreamError(400,JSON.stringify({error:{code:'workbuddy_invalid_request',fields:['tools.2.name','reasoning.summary','private-token','input.secret'],message:'private request contents'}}));
 expect(result.message).toContain('tools.2.name');expect(result.message).toContain('reasoning.summary');expect(result.message).not.toMatch(/private|secret/);
});
