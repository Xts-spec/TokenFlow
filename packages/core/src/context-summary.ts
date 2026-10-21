/** Provider-neutral summary transport. Only completed assistant text is usable;
 * reasoning deltas are progress, never a substitute for a checkpoint. */
import {upstreamError} from './upstream-errors.js';
type Item=Record<string,any>;
export const SUMMARY_CHUNK_BYTES=48*1024;
// Baseline history-reduction target. GatewayContext expands it for fixed
// instructions/tools and the current user request; this is not a model limit.
export const CONTEXT_INPUT_BYTES=128*1024;
export const CONTEXT_TRIGGER_BYTES=96*1024;
const object=(v:unknown):v is Item=>!!v&&typeof v==='object'&&!Array.isArray(v);
export const byteSize=(v:unknown)=>Buffer.byteLength(JSON.stringify(v));
export function splitTranscript(text:string,limit=SUMMARY_CHUNK_BYTES){
 const parts:string[]=[];let chunk='',bytes=0;
 for(const c of text){const n=Buffer.byteLength(c);if(bytes+n>limit){parts.push(chunk);chunk='';bytes=0;}chunk+=c;bytes+=n;}
 if(chunk)parts.push(chunk);return parts;
}
function excerpt(text:string,limit:number){
 if(Buffer.byteLength(text)<=limit)return text;
 // Iterating codepoints keeps UTF-8 intact, including Chinese and emoji.
 const head=splitTranscript(text,Math.floor(limit/2))[0];
 const tail=splitTranscript([...text].reverse().join(''),Math.floor(limit/2))[0];
 return head+`\n[historical output excerpt; ${Buffer.byteLength(text)} original bytes; middle omitted, re-read the source if needed]\n`+[...tail].reverse().join('');
}
/** Old tool payloads and assistant work are excerpted. User text/instructions stay intact
 * for the summarizer. Binary attachments cannot be interpreted by a text summary. */
export function summaryTranscript(input:Item[]){
 return JSON.stringify(input.map(item=>{
  const value={...item};delete value.id;delete value.encrypted_content;
  if(item.type==='reasoning')return {type:'reasoning',summary:item.summary};
  if(['function_call_output','custom_tool_call_output'].includes(item.type)){
   // Codex persists tool output as either text or content blocks. Both forms
   // need the same bound; large array outputs used to bypass excerpting.
   const output=Array.isArray(item.output)?item.output.map((p:Item)=>['input_image','image_url','image','input_file','file'].includes(p.type)?{type:'text',text:'[historical attachment omitted]'}:p):item.output;
   value.output=excerpt(typeof output==='string'?output:JSON.stringify(output??''),1024);
  }
  if(['function_call','custom_tool_call'].includes(item.type))for(const key of ['arguments','input'])if(typeof item[key]==='string')value[key]=excerpt(item[key],1024);
  if(Array.isArray(item.content))value.content=item.content.map((p:Item)=>['input_image','image_url','image','input_file','file'].includes(p.type)?{type:'input_text',text:'[Historical attachment omitted from text checkpoint; consult the original conversation if needed.]'}:p);
  if(item.role==='assistant'){
   if(typeof value.content==='string')value.content=excerpt(value.content,1024);
   else if(Array.isArray(value.content))value.content=value.content.map((p:Item)=>typeof p.text==='string'?{...p,text:excerpt(p.text,1024)}:p);
  }
  return value;
 }));
}
export async function readSummaryResponse(response:Response):Promise<Item>{
 if(!response.body)throw new Error('Summary response has no body');
 const reader=response.body.getReader();const decoder=new TextDecoder();let buffer='';
 const done=new Map<number,Item>(),deltas=new Map<string,string>();let terminal:Item|undefined;
 const safeTerminal=(value:Item):Item=>value.status==='failed'?{...value,error:upstreamError(502,JSON.stringify({error:value.error}))}:value;
 const frame=(text:string)=>{
  const data=text.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trimStart()).join('\n');
  if(!data||data==='[DONE]')return;
  const event=JSON.parse(data);if(!object(event))throw new Error('Invalid summary event');
  if(event.type==='response.output_text.delta'&&typeof event.delta==='string'){
   const key=`${event.output_index??0}:${event.content_index??0}`;deltas.set(key,(deltas.get(key)??'')+event.delta);
  }
  if(event.type==='response.output_item.done'&&object(event.item))done.set(event.output_index??done.size,event.item);
  if(['response.completed','response.incomplete','response.failed'].includes(event.type)&&object(event.response))terminal=safeTerminal(event.response);
  if(event.type==='error')terminal=safeTerminal({status:'failed',output:[],usage:null,error:event.error??event});
 };
 try{
  const sse=(response.headers.get('content-type')??'').includes('text/event-stream');
  for(;;){const {done:ended,value}=await reader.read();if(ended)break;
   buffer+=decoder.decode(value,{stream:true});
   if(sse){buffer=buffer.replace(/\r\n/g,'\n');let end;while((end=buffer.indexOf('\n\n'))>=0){frame(buffer.slice(0,end));buffer=buffer.slice(end+2);if(terminal)break;}
    // A terminal Responses event ends the operation. Some bridges keep SSE
    // alive afterward; waiting for EOF would turn a finished summary into a
    // long idle timeout and cause another paid attempt.
    if(terminal){await reader.cancel().catch(()=>{});buffer='';break;}
   }
  }
  buffer+=decoder.decode();
  if(!sse){const result:unknown=JSON.parse(buffer);if(!object(result))throw new Error('Invalid summary JSON');return safeTerminal(result);}
  if(buffer.trim())frame(buffer);
  if(!terminal)throw new Error('Summary stream ended before completion');
  const output=Array.isArray(terminal.output)?terminal.output:[];
  const candidates=[...output,...done.values()];
  const hasText=candidates.some(i=>i.type==='message'&&i.role==='assistant'&&i.content?.some((p:Item)=>p.type==='output_text'&&p.text?.trim()));
  if(!hasText&&deltas.size)candidates.push({type:'message',role:'assistant',content:[{type:'output_text',text:[...deltas.values()].join('\n')}]});
  // Prefer terminal items when complete; done items/deltas are a fallback for
  // bridges that omit output in the terminal event, not additional copies.
  return {...terminal,summary_requested_tools:candidates.some(i=>['function_call','custom_tool_call'].includes(i.type)),output:output.some((i:Item)=>i.type==='message'&&i.content?.some((p:Item)=>p.text?.trim()))?output:candidates};
 }catch(error){await reader.cancel().catch(()=>{});throw error;}finally{reader.releaseLock();}
}
