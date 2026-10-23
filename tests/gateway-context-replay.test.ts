import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
it('continues with summary, recent exchanges and current instructions/tools without resurrecting short old user turns',async()=>{
 const root=await mkdtemp(join(tmpdir(),'context-window-'));roots.push(root);
 const context=await GatewayContext.open(root);
 const rule={role:'developer',content:'Current workspace rules.'};
 const oldUser={role:'user',content:'Earlier task: keep the public API compatible.'};
 const latest={role:'user',content:'Now finish testing.'};
 const tools=[{type:'function',name:'read',parameters:{type:'object',properties:{}}}];
 const tail=[latest,{type:'function_call',call_id:'pending',name:'read',arguments:'{}'}];
 const history=[rule,oldUser,...Array.from({length:24},(_,i)=>({role:'assistant',content:`Completed work ${i}. `.repeat(500)})),...tail];
 const original=structuredClone(history);const requests:Record<string,any>[]=[];
 const summary='API compatibility retained; implementation complete; testing pending.';
 const send=async(_path:string,body:Record<string,any>)=>{requests.push(body);return Response.json({id:'test',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:summary}]}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}});};
 const compact=await (await context.response('responses/compact',{model:'m',input:history,instructions:'Current instructions.',tools},'a','s',send)).json();
 const checkpoint=compact.output.at(-1);
 expect(JSON.stringify(requests[0].input)).toContain(oldUser.content);
 const restarted=await GatewayContext.open(root);
 const result={type:'function_call_output',call_id:'pending',output:'Tests passed.'};
 // A client may replay the original window along with its replacement.
 await restarted.response('responses',{model:'m',input:[...history,checkpoint,result],instructions:'Current instructions.',tools,store:false},'a','s',send);
 const sent=requests.at(-1)!;
 expect(sent.instructions).toBe('Current instructions.');expect(sent.tools).toEqual(tools);
 expect(sent.input).toContainEqual(rule);expect(sent.input).not.toContainEqual(oldUser);
 expect(sent.input.slice(-3)).toEqual([...tail,result]);
 expect(sent.input.filter((item:Record<string,unknown>)=>item.role==='user')).toEqual([latest]);
 expect(JSON.stringify(sent.input)).toContain(summary);
 expect(JSON.stringify(sent.input)).not.toContain('Completed work 0.');
 expect(sent.input.some((item:Record<string,unknown>)=>item.type==='compaction')).toBe(false);
 expect(history).toEqual(original);
 // Resending the same text after the checkpoint is an intentional new turn.
 await restarted.response('responses',{model:'m',input:[checkpoint,result,oldUser],store:false},'a','s',send);
 expect(requests.at(-1)!.input.at(-1)).toEqual(oldUser);
});
it('does not resurrect covered user attachments, but keeps fresh messages and explicitly resent images',async()=>{
 const root=await mkdtemp(join(tmpdir(),'context-replay-'));roots.push(root);
 const context=await GatewayContext.open(root),scope={owner:'a',model:'m',source:'s'};
 const oldImage={role:'user',content:[{type:'input_text',text:'Read the primary label only.'},{type:'input_image',image_url:'data:image/png;base64,'+'A'.repeat(350_000)}]};
 const history=[oldImage,...Array.from({length:20},(_,i)=>({role:i%2?'user':'assistant',content:i%2?'Continue read-only.':'Old observation '.repeat(400)})),{role:'user',content:'Recall the text labels.'}];
 const sent:Record<string,any>[]=[];
 const send=async(_path:string,body:Record<string,any>)=>{sent.push(body);return Response.json({id:'test',status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Historical image omitted; continue read-only verification.'}]}],usage:{input_tokens:100,output_tokens:10,total_tokens:110}});};
 const first=await (await context.response('responses/compact',{model:'m',input:history,store:false},'a','s',send)).json();
 const checkpoint=first.output.at(-1);
 expect(JSON.stringify(context.decodeCheckpoint(checkpoint.encrypted_content,[scope]))).not.toContain('data:image');
 const fresh={role:'user',content:'New constraint: keep output in Chinese.'};
 const rule={role:'developer',content:'Use the new workspace.'};
 const restarted=await GatewayContext.open(root);
 const stored=await (await restarted.response('responses',{model:'m',input:[...history,fresh,rule,checkpoint]},'a','s',send)).json();
 expect(JSON.stringify(sent.at(-1)!.input).includes('data:image')).toBe(false);
 expect(sent.at(-1)!.input).toContainEqual(fresh);expect(sent.at(-1)!.input).toContainEqual(rule);
 // A later explicit resend is a new input even when its content is identical.
 await restarted.response('responses',{model:'m',input:[checkpoint,oldImage],store:false},'a','s',send);
 expect(sent.at(-1)!.input).toContainEqual(oldImage);
 // Covered-message identities survive replacement checkpoints and restarts.
 const second=await (await restarted.response('responses/compact',{model:'m',previous_response_id:stored.id,input:[...Array.from({length:20},()=>({role:'assistant',content:'Later completed observation '.repeat(400)})),fresh],store:false},'a','s',send)).json();
 const again=await GatewayContext.open(root);
 await again.response('responses',{model:'m',input:[oldImage,...second.output],store:false},'a','s',send);
 expect(JSON.stringify(sent.at(-1)!.input).includes('data:image')).toBe(false);
 expect(history[0]).toEqual(oldImage);
});
