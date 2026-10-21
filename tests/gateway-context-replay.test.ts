import {afterEach,expect,it} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {GatewayContext} from '../packages/core/src/gateway-context.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
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
