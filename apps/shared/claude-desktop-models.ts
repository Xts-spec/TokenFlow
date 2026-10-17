/** Family defaults Claude Desktop requests internally. Extra menu rows use other unique Claude ids. */
export const claudeDesktopSlots=['claude-sonnet-5','claude-opus-5','claude-haiku-4-5','claude-fable-5'] as const;
/** Desktop profile schema allows this many inferenceModels entries. */
export const claudeDesktopModelLimit=200;
const families=['sonnet','opus','haiku','fable'] as const;
function desktopModelName(index:number){
 if(index===0)return claudeDesktopSlots[0];
 const extra=index-1;
 return `claude-${families[extra%families.length]}-4-${6+Math.floor(extra/families.length)}`;
}

/** Conservative subset of names the desktop's own checker treats as Claude routes. */
export function claudeDesktopModel(model:string){
 return /^(?:(?:claude|anthropic|qoder|workbuddy|antigravity|api-[a-f0-9]{24})\/)?claude-(?:sonnet|opus|haiku|fable|[0-9])[a-zA-Z0-9._-]*$/.test(model);
}

export function claudeDesktopPlan(selections:{model:string}[],labels:Record<string,string>={},fastModel?:string){
 if(selections.length>claudeDesktopModelLimit)throw new Error('Claude Desktop 最多接入 200 个模型。');
 if(fastModel&&!selections.some(selection=>selection.model===fastModel))throw new Error('快速模型必须在已选模型中。');
 const visible=selections.map((selection,index)=>({name:desktopModelName(index),model:selection.model,label:(labels[selection.model]||selection.model).replace(/[\r\n\t]/g,' ').trim().slice(0,120)||selection.model,familyDefault:index===0}));
 const fallback=selections[0]?.model;
 const fast=fastModel||fallback;
 const aliases:Record<string,string>={};
 for(const item of visible)aliases[item.name]=item.model;
 // The first selection is the session default. Opus and Fable internal requests follow it.
 // Haiku is the fast path and approval classifier. Each other menu row still routes to its own model.
 if(fallback)for(const slot of claudeDesktopSlots)aliases[slot]=slot==='claude-haiku-4-5'?fast!:fallback;
 return {visible,aliases};
}
