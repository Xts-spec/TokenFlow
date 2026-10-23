/** Read-only context replay for foreign checkpoints. Mirrors the rollback rules
 * in Codex 5425d3e6 context_manager/history.rs and session/rollout_reconstruction.rs:
 * select a surviving replacement first, then replay its suffix and rollbacks.
 * This never changes the user's rollout or invokes a summarizer. */
type Item=Record<string,any>;
export const CODEX_SUMMARY_PREFIX='Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:';
const texts=(item:Item):string[]=>typeof item.content==='string'?[item.content]:Array.isArray(item.content)?item.content.filter((part:Item)=>(item.role==='user'?part.type==='input_text':['input_text','output_text'].includes(part.type))&&typeof part.text==='string').map((part:Item)=>part.text):[];
const contextual=(text:string)=>{
 const value=text.trim(),lower=value.replace(/[A-Z]/g,char=>char.toLowerCase());
 for(const tag of ['environment_context','turn_aborted','user_shell_command','subagent_notification','agent_message_board_notification','recommended_plugins','skill'])if(lower.startsWith('<'+tag+'>')&&lower.endsWith('</'+tag+'>'))return true;
 const external=/^<(external_[^>]+)>/.exec(value);
 if(external&&value.endsWith('</'+external[1]+'>'))return true;
 if(value.startsWith('<goal_context>')&&value.endsWith('</goal_context>')||/^<codex_internal_context source="[a-z][a-z0-9_]*">/.test(value)&&value.endsWith('</codex_internal_context>'))return true;
 if(/^<hook_prompt\s+hook_run_id="[^"<>]+">(?:[^<&]|&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-fA-F]+);)*<\/hook_prompt>$/.test(value))return true;
 return lower.startsWith('# agents.md instructions')&&lower.endsWith('</instructions>')
  ||value.startsWith('Warning: The maximum number of unified exec processes you can keep open is')
  ||value.startsWith('Warning: Your account was flagged for potentially high-risk cyber activity')
  ||value.startsWith('Warning: apply_patch was requested via ')&&value.endsWith('Use the apply_patch tool instead of exec_command.');
};
export function codexUserTurnBoundary(item:Item){
 if(item.type==='agent_message')return true;
 if(item.type!=='message'&&item.type!==undefined)return false;
 const content=texts(item);
 if(item.role==='user')return !content.some(text=>text.startsWith(CODEX_SUMMARY_PREFIX+'\n')||contextual(text));
 if(item.role==='assistant'&&content.length===1){try{const value=JSON.parse(content[0]!);return typeof value.author==='string'&&typeof value.recipient==='string'&&typeof value.content==='string'&&typeof value.trigger_turn==='boolean';}catch{}}
 return false;
}
const count=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw Error('Invalid Codex rollback count');return Number(value);};
export function replayCodexHistory(rows:Item[],replacement:(row:Item)=>Item[]|undefined):Item[]{
 // TurnStarted is serialized as task_started. Older rollouts may omit it;
 // those use the real user-message boundary instead of a synthetic summary.
 const hasStarts=rows.some(row=>row.type==='event_msg'&&['task_started','turn_started'].includes(row.payload?.type));
 let pending=0,selected=-1,segment:{user:boolean;checkpoint:number;turnId?:string}|undefined;
 const finish=()=>{
  if(!segment)return;
  if(pending){if(segment.user)pending--;}
  else if(selected<0&&segment.checkpoint>=0)selected=segment.checkpoint;
  segment=undefined;
 };
 for(let index=rows.length-1;index>=0;index--){
  const row=rows[index]!,payload=row.payload;
  if(!payload)continue;
  if(row.type==='event_msg'&&payload.type==='thread_rolled_back'){pending+=count(payload.num_turns);continue;}
  if(row.type==='compacted'||row.type==='response_item'&&payload.type==='compaction'){
   if(replacement(row)!==undefined){segment??={user:false,checkpoint:-1};if(segment.checkpoint<0)segment.checkpoint=index;}
  }
  if(row.type==='turn_context'){segment??={user:false,checkpoint:-1};segment.turnId??=payload.turn_id;}
  const user=row.type==='response_item'&&codexUserTurnBoundary(payload)||row.type==='event_msg'&&payload.type==='user_message'||row.type==='inter_agent_communication';
  if(user){segment??={user:false,checkpoint:-1};segment.user=true;if(!hasStarts)finish();}
  if(row.type==='event_msg'&&['task_started','turn_started'].includes(payload.type)&&(!segment?.turnId||!payload.turn_id||segment.turnId===payload.turn_id))finish();
 }
 finish();
 let history:Item[]=selected>=0?[...replacement(rows[selected]!)!]:[];
 for(const row of rows.slice(selected+1)){
  const payload=row.payload;if(!payload)continue;
  if(row.type==='response_item'&&payload.type!=='compaction')history.push(payload);
  else if(row.type==='inter_agent_communication')history.push({type:'agent_message',content:[{type:'input_text',text:payload.content}],author:payload.author,recipient:payload.recipient});
  else if(row.type==='event_msg'&&payload.type==='thread_rolled_back'){
   const amount=count(payload.num_turns);if(!amount)continue;
   const positions=history.flatMap((item,index)=>codexUserTurnBoundary(item)?[index]:[]);
   if(positions.length)history=history.slice(0,positions[Math.max(0,positions.length-amount)]);
  }
 }
 return history;
}
