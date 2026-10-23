import {expect,it} from 'vitest';
import {codexWebSearch} from '../packages/core/src/codex-web-search.js';
import {codexModelCatalog} from '../packages/core/src/codex-model-catalog.js';
import {connectedConfig} from '../packages/core/src/agent-connections.js';
import {parse} from 'smol-toml';
const tools=[{type:'function',name:'read'},{type:'web_search',external_web_access:true}];
it('keeps search enabled in a mixed picker and on Luna requests',()=>{
 const models=['qoder/model','codex/gpt-6-luna'];
 const config=parse(connectedConfig('codex','web_search="live"','http://127.0.0.1:9527',models[0],'key',undefined,models));
 expect(config.web_search).toBe('live');
 const body={model:models[1],tools,tool_choice:'auto'};expect(codexWebSearch(body)).toBe(body);
});
it.each(['cursor','qoder','workbuddy'])('adapts web search only for the current %s model without changing function tools or input',provider=>{
 const body={model:provider+'/model',tools,tool_choice:{type:'web_search'},input:[{role:'user',content:'search using available tools'}]};
 const result=codexWebSearch(body);expect(result).toEqual({...body,tools:[tools[0]],tool_choice:'auto'});expect(body.tools).toBe(tools);expect(result.input).toBe(body.input);
 expect(codexWebSearch({...body,model:'codex/gpt-6-luna'}).tools).toBe(tools);
});
it('removes an unavailable search choice from allowed_tools and handles a search-only request',()=>{
 expect(codexWebSearch({model:'qoder/model',tools,tool_choice:{type:'allowed_tools',mode:'required',tools}}).tool_choice).toEqual({type:'allowed_tools',mode:'required',tools:[tools[0]]});
 expect(codexWebSearch({model:'qoder/model',tools:[tools[1]],tool_choice:'required'})).toMatchObject({tools:[],tool_choice:'auto'});
});
it('uses a schema-valid catalog policy without the 10000-byte tool clipping',()=>{
 const catalog=codexModelCatalog('codex/gpt-6-luna');expect(catalog.models[0].truncation_policy).toEqual({mode:'bytes',limit:Number.MAX_SAFE_INTEGER});
});
