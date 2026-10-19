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
it('retains safe Cursor schema paths and failure categories through compaction error handling',()=>{
 const bad=upstreamError(400,JSON.stringify({error:{code:'cursor_invalid_request',fields:['messages.149.content','private-token','input.secret'],message:'private request'}}));
 expect(bad).toMatchObject({code:'cursor_invalid_request',type:'invalid_request_error'});expect(bad.message).toContain('messages.149.content');expect(bad.message).not.toMatch(/private|secret/);
 for(const code of ['cursor_network_error','cursor_timeout','cursor_rate_limited','cursor_permission_denied','cursor_plan_required','cursor_authentication_failed','cursor_backend_override','cursor_upstream_error','cursor_upstream_unavailable','cursor_upstream_internal','cursor_request_rejected','cursor_tls_error','cursor_dns_error']){
  const result=upstreamError(502,JSON.stringify({error:{code,message:'private upstream payload'}}));
  expect(result.code).toBe(code);expect(result.message).not.toContain('private');
 }
});
it('keeps structural upstream 400 parameters without exposing provider messages or arbitrary names',()=>{
 const result=upstreamError(400,JSON.stringify({error:{type:'invalid_request_error',param:'input[42].content',message:'PRIVATE_PROMPT'}}));
 expect(result).toMatchObject({code:'upstream_invalid_request'});expect(result.message).toContain('input[42].content');expect(result.message).not.toContain('PRIVATE');
 const bad=upstreamError(400,JSON.stringify({error:{type:'invalid_request_error',param:'input.PRIVATE_TOKEN',message:'PRIVATE_PROMPT'}}));
 expect(bad.message).not.toContain('PRIVATE');
 expect(upstreamError(400,JSON.stringify({error:{code:'context_length_exceeded',message:'PRIVATE_PROMPT'}})).code).toBe('upstream_context_length');
});

it.each(['workbuddy_sdk_failed','workbuddy_output_failed','workbuddy_timeout','a2a_parallel_tools_violated'])('retains safe category %s without upstream payload',code=>{
 expect(upstreamError(502,JSON.stringify({error:{code,message:'private payload'}}))).toMatchObject({code});
 expect(upstreamError(502,JSON.stringify({error:{code,message:'private payload'}})).message).not.toContain('private');
});
