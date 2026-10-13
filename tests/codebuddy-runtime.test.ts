import {it,expect,vi,beforeEach} from 'vitest';
const sdk=vi.hoisted(()=>({query:vi.fn(),callbacks:[] as Array<(args:Record<string,unknown>)=>unknown>}));
vi.mock('../packages/codebuddy-runtime/node_modules/@tencent-ai/agent-sdk/lib/index.js',()=>({
 query:sdk.query,
 tool:(_name:unknown,_description:unknown,_schema:unknown,callback:(args:Record<string,unknown>)=>unknown)=>{sdk.callbacks.push(callback);return {};},
 createSdkMcpServer:()=>({instance:{close:async()=>{}}}),
}));
import {runOfficialSDK} from '../packages/codebuddy-runtime/index.js';
beforeEach(()=>{sdk.callbacks.length=0;sdk.query.mockReset();});

it.each([false,true,undefined])('hands back client proposals with parallelToolCalls=%s without running commands',async parallelToolCalls=>{
 const command='printf should-only-run-on-client';let options:Record<string,any>={};
 sdk.query.mockImplementation((request:{options:Record<string,any>})=>{
  options=request.options;
  return (async function*(){
   const results=await Promise.all(sdk.callbacks.map(callback=>callback({command})));
   expect(results[0]).toMatchObject({content:[{text:expect.stringContaining('has not executed')}]});
   if(parallelToolCalls===false)expect(results[1]).toMatchObject({isError:true});
   yield {type:'assistant',message:{model:'test',content:[]}};
   yield {type:'result',is_error:true,subtype:'error_max_turns'};
  })();
 });
 const result=await runOfficialSDK({token:'fixture',region:'china',model:'test',prompt:'Use client tools',tools:['first','second'].map(name=>({name,parameters:{type:'object',properties:{command:{type:'string'}},required:['command']}})),parallelToolCalls,signal:new AbortController().signal,cwd:'/tmp',configDir:'/tmp'});
 expect(options).toMatchObject({tools:[],strictMcpConfig:true,settingSources:[],maxTurns:1});
 expect(await options.canUseTool('Bash',{command})).toMatchObject({behavior:'deny'});
 expect(result.failed).toBe(false);expect(result.calls).toHaveLength(parallelToolCalls===false?1:2);
 expect(result.calls[0]).toMatchObject({name:'first',arguments:JSON.stringify({command})});
});
