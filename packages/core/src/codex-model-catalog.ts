import { apiModelDisplayName } from '../../../apps/shared/api-endpoint.js';
export const CODEX_AUTO_COMPACT_TOKEN_LIMIT=65536;
/** Codex reads this catalog at startup instead of its bundled OpenAI picker entries.
 * Keep it scoped to the models authorized by this connection's client key. */
export function codexModelCatalog(selection:string|string[],labels:Record<string,string>={}){
 return {models:(typeof selection==='string'?[selection]:selection).map((model,priority)=>({
  slug:model,display_name:apiModelDisplayName(labels[model]?.trim()||model),description:'通过 TokenFlow 使用此模型',
  visibility:'list',supported_in_api:true,priority,
  default_reasoning_level:'medium',supported_reasoning_levels:[{effort:'medium',description:'默认'}],
  shell_type:'shell_command',base_instructions:'You are a coding assistant. Help the user complete their coding tasks.',
  supports_reasoning_summaries:false,support_verbosity:false,
  // Do not declare a smaller window: Codex can otherwise compact with the old,
  // unauthorized model during a downshift. The client owns this soft trigger.
  auto_compact_token_limit:CODEX_AUTO_COMPACT_TOKEN_LIMIT,
  apply_patch_tool_type:'freeform',truncation_policy:{mode:'bytes',limit:10000},
  // Allow attachments through image-capable transports without maintaining a
  // per-model vision allowlist. The selected upstream decides model support.
  // Cursor's current text-prompt adapter cannot carry image blocks.
  input_modalities:['text','image'],experimental_supported_tools:[],
 }))};
}
