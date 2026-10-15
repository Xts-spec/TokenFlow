import {randomUUID} from 'node:crypto';

/** Translate SDK text deltas immediately; tool proposals and usage finish only
 * after the SDK result has passed model/account/output validation. */
export function workbuddyStream(path:string,model:string,send:(text:string)=>void){
 const id=`resp_workbuddy_${randomUUID().replaceAll('-','')}`,messageId=`msg_${randomUUID()}`,created=Math.floor(Date.now()/1000);
 let sequence=0,started=false,textStarted=false,text='';
 const emit=(type:string,data:Record<string,unknown>)=>send(`event: ${type}\ndata: ${JSON.stringify({type,...data,...(path==='responses'?{sequence_number:sequence++}:{})})}\n\n`);
 const chat=(delta:unknown,finish_reason:string|null=null,usage?:unknown)=>send(`data: ${JSON.stringify({id,object:'chat.completion.chunk',created,model,choices:[{index:0,delta,finish_reason}],...(usage?{usage}:{})})}\n\n`);
 const base={id,object:'response',created_at:created,model};
 const item={id:messageId,type:'message',role:'assistant',status:'in_progress'};
 const start=()=>{
  if(started)return;started=true;
  if(path==='responses')emit('response.created',{response:{...base,status:'in_progress',output:[],usage:null}});
  else if(path==='messages')emit('message_start',{message:{id,type:'message',role:'assistant',model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});
  else chat({role:'assistant',content:''});
 };
 const delta=(value:string)=>{
  if(!value)return;start();
  if(!textStarted){textStarted=true;
   if(path==='responses'){
    emit('response.output_item.added',{output_index:0,item:{...item,content:[]}});
    emit('response.content_part.added',{item_id:messageId,output_index:0,content_index:0,part:{type:'output_text',text:'',annotations:[]}});
   }else if(path==='messages')emit('content_block_start',{index:0,content_block:{type:'text',text:''}});
  }
  text+=value;
  if(path==='responses')emit('response.output_text.delta',{item_id:messageId,output_index:0,content_index:0,delta:value});
  else if(path==='messages')emit('content_block_delta',{index:0,delta:{type:'text_delta',text:value}});
  else chat({content:value});
 };
 const finish=(result:Record<string,any>)=>{
  start();
  // This also supports test/custom SDK runners which return a complete answer.
  const finalText=path==='responses'?result.output?.filter((v:any)=>v.type==='message').flatMap((v:any)=>v.content??[]).map((v:any)=>v.text??'').join(''):path==='messages'?result.content?.filter((v:any)=>v.type==='text').map((v:any)=>v.text).join(''):result.choices?.[0]?.message?.content??'';
  if(!text&&finalText)delta(finalText);
  if(text!==finalText)throw new Error('SDK final text does not match streamed text');
  if(textStarted){
   if(path==='responses'){
    const part={type:'output_text',text,annotations:[]};
    emit('response.output_text.done',{item_id:messageId,output_index:0,content_index:0,text});
    emit('response.content_part.done',{item_id:messageId,output_index:0,content_index:0,part});
    emit('response.output_item.done',{output_index:0,item:{...item,status:'completed',content:[part]}});
   }else if(path==='messages')emit('content_block_stop',{index:0});
  }
  if(path==='responses'){
   const output=result.output.map((v:any)=>v.type==='message'?{...v,id:messageId}:v);
   output.forEach((v:any,index:number)=>{
    if(v.type==='message')return;
    emit('response.output_item.added',{output_index:index,item:{...v,status:'in_progress',...(v.type==='custom_tool_call'?{input:''}:{arguments:''})}});
    const custom=v.type==='custom_tool_call',field=custom?'input':'arguments',prefix=custom?'response.custom_tool_call_input':'response.function_call_arguments';
    emit(`${prefix}.delta`,{item_id:v.id,output_index:index,delta:v[field]});
    emit(`${prefix}.done`,{item_id:v.id,output_index:index,[field]:v[field]});
    emit('response.output_item.done',{output_index:index,item:v});
   });
   emit('response.completed',{response:{...result,id,output}});
  }else if(path==='messages'){
   let index=textStarted?1:0;
   for(const block of result.content.filter((v:any)=>v.type==='tool_use')){
    emit('content_block_start',{index,content_block:{...block,input:{}}});
    emit('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:JSON.stringify(block.input)}});
    emit('content_block_stop',{index});index++;
   }
   emit('message_delta',{delta:{stop_reason:result.stop_reason,stop_sequence:null},usage:result.usage??{output_tokens:0}});
   emit('message_stop',{});
  }else{
   const choice=result.choices[0];
   if(choice.message.tool_calls?.length)chat({tool_calls:choice.message.tool_calls.map((v:any,index:number)=>({...v,index}))});
   chat({},choice.finish_reason,result.usage);send('data: [DONE]\n\n');
  }
 };
 const fail=(error:{code?:string;type?:string;message:string})=>{
  if(path==='responses')emit('response.failed',{response:{...base,status:'failed',output:[],error}});
  else emit('error',{error});
 };
 return {delta,finish,fail};
}
