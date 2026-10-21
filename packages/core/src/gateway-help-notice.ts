// Exact help notice confirmed to trigger an upstream policy rejection.
// Normalize instruction fields at gateway ingress, independently of client and source.
export const knownClaudeCodeHelpNotice = ' - If the user asks for help or wants to give feedback inform them of the following:\n  - /help: Get help with using Claude Code\n  - To give feedback, users should report the issue at https://github.com/anthropics/claude-code/issues\n\n';

type RecordValue = Record<string,unknown>;
const record=(value:unknown):value is RecordValue=>!!value&&typeof value==='object'&&!Array.isArray(value);

export function removeKnownGatewayHelpNotice(body:unknown):{body:unknown;changed:boolean;removedChars:number}{
 if(!record(body))return {body,changed:false,removedChars:0};
 let removedChars=0;
 const remove=(text:string)=>{
  const parts=text.split(knownClaudeCodeHelpNotice);
  removedChars+=(parts.length-1)*knownClaudeCodeHelpNotice.length;
  return parts.length===1?text:parts.join('');
 };
 const content=(value:unknown):unknown=>{
  if(typeof value==='string')return remove(value);
  if(!Array.isArray(value))return value;
  let changed=false;
  const blocks=value.map(block=>{
   if(!record(block)||(block.type!=='text'&&block.type!=='input_text')||typeof block.text!=='string')return block;
   const text=remove(block.text);
   if(text===block.text)return block;
   changed=true;return {...block,text};
  });
  return changed?blocks:value;
 };
 const messages=(value:unknown):unknown=>{
  if(!Array.isArray(value))return value;
  let changed=false;
  const items=value.map(message=>{
   if(!record(message)||(message.role!=='system'&&message.role!=='developer'))return message;
   const adapted=content(message.content);
   if(adapted===message.content)return message;
   changed=true;return {...message,content:adapted};
  });
  return changed?items:value;
 };
 let adapted=body;
 for(const field of ['system','instructions','messages','input']){
  const original=body[field];
  const value=field==='messages'||field==='input'?messages(original):content(original);
  if(value!==original){if(adapted===body)adapted={...body};adapted[field]=value;}
 }
 return {body:adapted,changed:adapted!==body,removedChars};
}
