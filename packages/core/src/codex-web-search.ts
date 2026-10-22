import {a2aCapabilities} from '@cua-sample/contracts/a2a';
type Body=Record<string,any>;
const webSearch=(tool:unknown)=>!!tool&&typeof tool==='object'&&/^web_search(?:_preview)?(?:_\d{4}_\d{2}_\d{2})?$/.test(String((tool as Body).type));
/** Codex has one search setting for its whole model picker. Adapt only the
 * current request when its receiver cannot execute server-side web search. */
export function codexWebSearch(body:Body):Body {
 if(typeof body.model!=='string'||a2aCapabilities(body.model)?.serverTools!==false||!Array.isArray(body.tools))return body;
 const tools=body.tools.filter((tool:unknown)=>!webSearch(tool));
 if(tools.length===body.tools.length)return body;
 const next:Body={...body,tools};
 if(webSearch(body.tool_choice))next.tool_choice='auto';
 if(body.tool_choice?.type==='allowed_tools'&&Array.isArray(body.tool_choice.tools)){
  const allowed=body.tool_choice.tools.filter((tool:unknown)=>!webSearch(tool));
  next.tool_choice=allowed.length?{...body.tool_choice,tools:allowed}:'auto';
 }
 if(!tools.length&&next.tool_choice==='required')next.tool_choice='auto';
 return next;
}
