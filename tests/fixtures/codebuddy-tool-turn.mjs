// SDK transport fixture. No network, credentials, or tools execute here.
// Keep the process alive after a complete model tool turn to reproduce the
// unnecessary wait for the SDK's subsequent agent inference.
import {createInterface} from 'node:readline';
import {existsSync,writeFileSync} from 'node:fs';
const lines=createInterface({input:process.stdin});
const send=value=>process.stdout.write(JSON.stringify(value)+'\n');
const emit=event=>send({type:'stream_event',session_id:'fixture',parent_tool_use_id:null,event});
lines.on('line',line=>{
 const message=JSON.parse(line);
 if(message.type==='control_request')send({type:'control_response',response:{subtype:'success',request_id:message.request_id,response:{currentModelId:'test'}}});
 if(message.type==='user'){
  const {step,stall,stallOnce}=JSON.parse(message.message.content);
  const firstStall=stallOnce&&!existsSync('.fixture-stalled');
  if(firstStall)writeFileSync('.fixture-stalled','synthetic fixture only');
  if(stall||firstStall){
   send({type:'system',subtype:'init',session_id:'fixture'});
   emit({type:'message_start',message:{model:'test',usage:{input_tokens:100,output_tokens:0}}});
   emit({type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}});
   emit({type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'synthetic progress'}});
   const heartbeat=setInterval(()=>send({type:'system',subtype:'keepalive',session_id:'fixture'}),1000);heartbeat.unref();
   return;
  }
  emit({type:'message_start',message:{model:'test',usage:{input_tokens:100,output_tokens:0,cache_read_input_tokens:25}}});
  for(let index=0;index<2;index++){
   emit({type:'content_block_start',index,content_block:{type:'tool_use',id:`call_${index}`,name:`mcp__token_flow__client_${index}`,input:{}}});
   emit({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:'{"step":'}});
   emit({type:'content_block_delta',index,delta:{type:'input_json_delta',partial_json:step+'}'}});
   emit({type:'content_block_stop',index});
  }
  emit({type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:16}});
  emit({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{input_tokens:0,output_tokens:0}});
  emit({type:'message_stop'});
 }
});
lines.on('close',()=>process.exit(0));
