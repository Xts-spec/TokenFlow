/** Conservative subset accepted by Claude Desktop's official Anthropic gateway configuration. No model aliases or renaming. */
export function claudeDesktopModel(model:string){
 return /^(?:(?:claude|anthropic|qoder|workbuddy|antigravity|api-[a-f0-9]{24})\/)?claude-(?:sonnet|opus|haiku|fable|[0-9])[a-zA-Z0-9._-]*$/.test(model);
}
