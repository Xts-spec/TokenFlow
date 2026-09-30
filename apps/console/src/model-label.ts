import type { LocalModel, LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

// Names describe the catalog entry; IDs remain unchanged for permissions and routing.
export function modelLabel(models: LocalModel[], id: string) {
 const model=models.find(item=>item.id===id);
 if(model?.provider==='api'&&model.displayName?.trim())return model.displayName;
 if(model?.provider!=='qoder'||!model.displayName?.trim())return id;
 const name=model.displayName.trim().replace(/\s*\(Qoder\)$/i,'').replace(/\s+/g,'-');
 return `qoder/${name}`;
}
export function qualifiedModelLabel(local:LocalAgentSnapshot,id:string){
 const source=local.apiSources?.find(s=>id.startsWith(`api-${s.id}/`));
 return source?`${source.name} · ${id.slice(`api-${source.id}/`.length)}`:modelLabel(local.models,id);
}
