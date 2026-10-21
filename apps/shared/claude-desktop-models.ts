/** Built-in names belong to internal requests, never to additional gateway menu rows. */
export const claudeDesktopSlots=['claude-sonnet-5','claude-opus-5','claude-haiku-4-5','claude-fable-5','claude-opus-4-8','claude-opus-4-7','claude-opus-4-6','claude-sonnet-4-6','claude-haiku-5-5'] as const;
/** Desktop profile schema allows this many inferenceModels entries. */
export const claudeDesktopModelLimit=200;
function privateModelName(model:string){
 // Stable names keep a reordered menu from retargeting an existing conversation.
 let hash=0xcbf29ce484222325n;
 for(const byte of new TextEncoder().encode(model))hash=BigInt.asUintN(64,(hash^BigInt(byte))*0x100000001b3n);
 return `claude-sonnet-5-tokenflow-${hash.toString(16).padStart(16,'0')}`;
}
function desktopModelName(index:number,model:string){
 if(index===0)return claudeDesktopSlots[0];
 return privateModelName(model);
}

/** Only unqualified built-in names; provider IDs and our private menu routes remain exact. */
export function claudeBuiltInFamily(model:string){
 const plain=model.replace(/\[1m\]$/i,'');
 if(/^(?:sonnet|opus|opusplan|fable|mythos)$/i.test(plain))return 'default';
 if(/^haiku$/i.test(plain))return 'fast';
 const family=plain.match(/^claude-(?:\d+(?:[.-]\d+)*-)?(sonnet|opus|haiku|fable|mythos)(?:[-.]\d+)*(?:-latest)?$/i)?.[1];
 return family?family.toLowerCase()==='haiku'?'fast':'default':undefined;
}

/** Conservative subset of names the desktop's own checker treats as Claude routes. */
export function claudeDesktopModel(model:string){
 return /^(?:(?:claude|anthropic|qoder|workbuddy|antigravity|api-[a-f0-9]{24})\/)?claude-(?:sonnet|opus|haiku|fable|[0-9])[a-zA-Z0-9._-]*$/.test(model);
}

export function claudeDesktopPlan(selections:{model:string}[],labels:Record<string,string>={},fastModel?:string){
 if(selections.length>claudeDesktopModelLimit)throw new Error('Claude Desktop 最多接入 200 个模型。');
 if(fastModel&&!selections.some(selection=>selection.model===fastModel))throw new Error('快速模型必须在已选模型中。');
 const visible=selections.map((selection,index)=>({name:desktopModelName(index,selection.model),model:selection.model,label:(labels[selection.model]||selection.model).replace(/[\r\n\t]/g,' ').trim().slice(0,120)||selection.model,familyDefault:index===0}));
 if(new Set(selections.map(item=>privateModelName(item.model))).size!==selections.length)throw new Error('所选模型的菜单标识冲突，请调整模型列表后重试。');
 const fallback=selections[0]?.model;
 const fast=fastModel||fallback;
 const aliases:Record<string,string>={};
 for(const item of selections)aliases[privateModelName(item.model)]=item.model;
 for(const item of visible)aliases[item.name]=item.model;
 // The first selection is the session default. Opus and Fable internal requests follow it.
 // Haiku is the fast path and approval classifier. Each other menu row still routes to its own model.
 if(fallback)for(const slot of claudeDesktopSlots)aliases[slot]=claudeBuiltInFamily(slot)==='fast'?fast!:fallback;
 return {visible,aliases};
}
