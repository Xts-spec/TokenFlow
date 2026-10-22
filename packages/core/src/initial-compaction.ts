import {readFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
/** Prefer provider metadata. Only the Codex account route may use Codex's
 * cached catalog; an API with the same model name need not have the same window. */
export async function compactionModelWindow(model:string,models:{id:string;contextWindow?:number}[],configPath:string){
 const advertised=models.find(item=>item.id===model)?.contextWindow;
 if(advertised&&advertised>0)return advertised;
 if(model.startsWith('codex/'))try{
  const catalog=JSON.parse(await readFile(join(dirname(configPath),'models_cache.json'),'utf8'));
  const entry=catalog.models?.find((entry:{slug:string})=>entry.slug===model.slice(6));
  if(Number.isSafeInteger(entry?.context_window)&&entry.context_window>0)return entry.context_window as number;
 }catch{/* Unknown capacity is probed by the upstream, never a local rejection. */}
 return undefined;
}
export type InitialPart={text:string;detail:'overview'|'decisions'|'working-detail'};
/** Time affects summary detail, not which source bytes reach the model.
 * Bytes/2 is a planning estimate, not a token limit. Real context errors cause
 * lossless subdivision, including when a provider's advertised window differs. */
export function initialParts(transcript:string,contextWindow?:number):InitialPart[]{
 const capacity=contextWindow?Math.max(1024,Math.floor(contextWindow*0.8)*2):512*1024;
 const total=Buffer.byteLength(transcript);let offset=0;const result:InitialPart[]=[];
 // Chronological tiers are contiguous; never cut a UTF-8 codepoint.
 const tiers=[{end:0.5,scale:1,detail:'overview' as const},{end:0.8,scale:0.75,detail:'decisions' as const},{end:1,scale:0.5,detail:'working-detail' as const}];
 let current=0,chunk='',bytes=0;
 const flush=()=>{if(chunk){result.push({text:chunk,detail:tiers[current]!.detail});offset+=bytes;chunk='';bytes=0;}};
 for(const char of transcript){
  const n=Buffer.byteLength(char);const tier=tiers[current]!;
  if(bytes&&bytes+n>capacity*tier.scale)flush();
  if(current<tiers.length-1&&offset+bytes>=total*tier.end){flush();current++;}
  chunk+=char;bytes+=n;
 }
 flush();return result;
}
export function smallerParts(text:string){const chars=[...text];if(chars.length<2)return [text];const middle=Math.ceil(chars.length/2);return [chars.slice(0,middle).join(''),chars.slice(middle).join('')];}
/** Workers only change scheduling. Results retain order and completed work is
 * awaited on failure so its cache and usage accounting are not abandoned. */
export async function initialParallel<T,R>(parts:T[],run:(part:T,index:number)=>Promise<R>,parallel=4):Promise<R[]>{
 const result:R[]=new Array(parts.length);let next=0,error:unknown,failed=false;
 await Promise.all(Array.from({length:Math.min(parallel,parts.length)},async()=>{
  while(!failed&&next<parts.length){const index=next++;try{result[index]=await run(parts[index]!,index);}catch(cause){failed=true;error=cause;}}
 }));
 if(failed)throw error;return result;
}
