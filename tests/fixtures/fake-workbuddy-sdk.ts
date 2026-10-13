import type {CLIProxyManager} from '../../packages/core/src/cliproxy.js';

// Existing routing tests use the protocol fixture as their SDK boundary.
// Real SDK semantics, tools and usage are tested in codebuddy-sdk.test.ts/live probes.
export function fakeWorkbuddySDK(proxy:CLIProxyManager){
 return {close:async()=>{},response:async(sourceId:string,path:string,body:unknown,signal:AbortSignal)=>{
  const model=(body as {model:string}).model;const pin=proxy.sourceAuth(sourceId,model,true),gateway=proxy.gateway();
  return fetch(`${gateway.baseURL}/${path}`,{method:'POST',headers:{Authorization:`Bearer ${gateway.apiKey}`,'X-Token-Flow-Auth':pin,'Content-Type':'application/json'},body:JSON.stringify(body),signal});
 }};
}
