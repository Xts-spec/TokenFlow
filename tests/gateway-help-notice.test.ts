import {expect,it} from 'vitest';
import {removeKnownGatewayHelpNotice,knownClaudeCodeHelpNotice as notice} from '../packages/core/src/gateway-help-notice.js';

it('removes exactly the known 233 characters from a system string',()=>{
 expect(notice).toHaveLength(233);
 const original={system:`before\n${notice}after`,model:'workbuddy/test',metadata:{user_id:'test'}};
 const result=removeKnownGatewayHelpNotice(original);
 expect(result).toEqual({body:{...original,system:'before\nafter'},changed:true,removedChars:233});
 expect(original.system).toBe(`before\n${notice}after`);
 expect(result.body).not.toBe(original);
});

it('clones only the matching text block and preserves metadata, tools and messages',()=>{
 const other={type:'text',text:'Keep all rules.',cache_control:{type:'ephemeral'}};
 const target={type:'text',text:`prefix${notice}suffix`,cache_control:{type:'ephemeral',ttl:'1h'},extra:{keep:true}};
 const messages=[{role:'user',content:notice},{role:'assistant',content:[{type:'tool_use',id:'a',name:'read',input:{}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:'done'}]}];
 const tools=Array.from({length:115},(_,i)=>({name:`tool_${i}`,description:notice,input_schema:{type:'object',properties:{}}}));
 const original={system:[other,target,{type:'image',text:notice}],messages,tools,metadata:{test:true}};
 const snapshot=structuredClone(original);
 const result=removeKnownGatewayHelpNotice(original);
 const adapted=result.body as typeof original;
 expect(result.changed).toBe(true);expect(result.removedChars).toBe(233);
 expect(original).toEqual(snapshot);
 expect(adapted.system[0]).toBe(other);expect(adapted.system[1]).not.toBe(target);
 expect(adapted.system[1]).toEqual({...target,text:'prefixsuffix'});
 expect(adapted.messages).toBe(messages);expect(adapted.messages).toEqual(snapshot.messages);
 expect(adapted.tools).toBe(tools);expect(adapted.tools).toEqual(snapshot.tools);expect(adapted.tools).toHaveLength(115);
 expect(adapted.metadata).toBe(original.metadata);expect(adapted.system[2]).toBe(original.system[2]);
});

it.each([
 {system:'Use /help for support.'},
 {system:'Keep rules.',messages:[{role:'user',content:notice}],tools:[{name:'help',description:notice}]},
 {system:[{type:'image',text:notice}]},
 {},null,[],
])('returns the original object when no exact instruction notice exists: %j',body=>{
 const result=removeKnownGatewayHelpNotice(body);
 expect(result.body).toBe(body);expect(result.changed).toBe(false);expect(result.removedChars).toBe(0);
});


it('removes all exact instruction matches across Messages, Chat and Responses fields',()=>{
 const user={role:'user',content:notice};
 const tool={role:'tool',content:notice};
 const assistant={role:'assistant',content:notice};
 const original={system:`a${notice}${notice}b`,instructions:notice,messages:[{role:'system',content:notice},{role:'developer',content:[{type:'text',text:`c${notice}d`,cache_control:{type:'ephemeral'}}]},user,tool,assistant],input:[{type:'message',role:'developer',content:[{type:'input_text',text:`e${notice}f`}]},user]};
 const result=removeKnownGatewayHelpNotice(original);
 expect(result.removedChars).toBe(6*233);
 expect(result.body).toEqual({...original,system:'ab',instructions:'',messages:[{role:'system',content:''},{role:'developer',content:[{type:'text',text:'cd',cache_control:{type:'ephemeral'}}]},user,tool,assistant],input:[{type:'message',role:'developer',content:[{type:'input_text',text:'ef'}]},user]});
 expect((result.body as typeof original).messages[2]).toBe(user);
 expect(original.instructions).toBe(notice);
 expect(removeKnownGatewayHelpNotice(result.body)).toEqual({body:result.body,changed:false,removedChars:0});
});

it('preserves similar wording, user input strings and unknown block types',()=>{
 const original={system:notice.trim(),instructions:notice.replace('/help:','/HELP:'),input:notice,messages:[{role:'system',content:[{type:'image',text:notice}]}]};
 expect(removeKnownGatewayHelpNotice(original)).toEqual({body:original,changed:false,removedChars:0});
});
