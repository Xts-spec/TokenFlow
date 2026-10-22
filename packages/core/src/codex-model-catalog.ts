import { apiModelDisplayName } from '../../../apps/shared/api-endpoint.js';
/** Compatibility trigger when the source has not published its capacity. This
 * is not a declared model window or an inference request limit. */
export const CODEX_DEFAULT_COMPACT_TOKEN_LIMIT=128000;
export function codexCompactionLimit(contextWindow?:number){
 if(typeof contextWindow==='number'&&Number.isSafeInteger(contextWindow)&&contextWindow>0)return Math.max(1,Math.floor(contextWindow*0.8));
 return CODEX_DEFAULT_COMPACT_TOKEN_LIMIT;
}
/** Codex reads this catalog at startup instead of its bundled OpenAI picker entries.
 * Keep it scoped to the models authorized by this connection's client key. */
export function codexModelCatalog(selection:string|string[],labels:Record<string,string>={},contextWindows:Record<string,number>={}){
 return {models:(typeof selection==='string'?[selection]:selection).map((model,priority)=>({
  slug:model,display_name:apiModelDisplayName(labels[model]?.trim()||model),description:'通过 TokenFlow 使用此模型',
  visibility:'list',supported_in_api:true,priority,
  default_reasoning_level:'medium',supported_reasoning_levels:[{effort:'medium',description:'默认'}],
  shell_type:'shell_command',base_instructions:'You are a coding assistant. Help the user complete their coding tasks.',
  supports_reasoning_summaries:false,support_verbosity:false,
  // A smaller declared context_window causes Codex to compact with the previous
  // model on a downshift. Publish only the trigger, based on receiver metadata.
  auto_compact_token_limit:codexCompactionLimit(contextWindows[model]),
  // Codex requires this field; its schema has no unlimited variant. Use the
  // largest exactly representable JSON integer so this catalog does not clip tools.
  apply_patch_tool_type:'freeform',truncation_policy:{mode:'bytes',limit:Number.MAX_SAFE_INTEGER},
  // Allow attachments through image-capable transports without maintaining a
  // per-model vision allowlist. The selected upstream decides model support.
  // Cursor's current text-prompt adapter cannot carry image blocks.
  input_modalities:['text','image'],experimental_supported_tools:[],
 }))};
}
