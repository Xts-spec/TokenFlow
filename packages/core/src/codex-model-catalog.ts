/** Codex reads this catalog at startup instead of its bundled OpenAI picker entries.
 * Keep it scoped to the models authorized by this connection's client key. */
export function codexModelCatalog(selection:string|string[],labels:Record<string,string>={}){
 return {models:(typeof selection==='string'?[selection]:selection).map((model,priority)=>({
  slug:model,display_name:labels[model]??model,description:'通过 token-flow 使用此模型',
  visibility:'list',supported_in_api:true,priority,
  default_reasoning_level:'medium',supported_reasoning_levels:[{effort:'medium',description:'默认'}],
  shell_type:'shell_command',base_instructions:'You are a coding assistant. Help the user complete their coding tasks.',
  supports_reasoning_summaries:false,support_verbosity:false,
  apply_patch_tool_type:'freeform',truncation_policy:{mode:'bytes',limit:10000},
  input_modalities:['text'],experimental_supported_tools:[],
 }))};
}
