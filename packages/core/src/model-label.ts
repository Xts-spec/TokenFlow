import { apiModelDisplayName } from '../../../apps/shared/api-endpoint.js';
// Names describe the catalog entry; IDs remain unchanged for permissions and routing.
export function modelLabel(models: {id:string;provider?:string;displayName?:string}[], id: string, sources:readonly {id:string;name:string}[]=[]) {
 const source=sources.find(source=>id.startsWith(`api-${source.id}/`));
 if(source)return `${source.name} · ${apiModelDisplayName(id)}`;
 const model=models.find(item=>item.id===id);
 if(model?.provider==='api'&&model.displayName?.trim())return apiModelDisplayName(model.displayName.trim());
 if(!model?.provider||!model.displayName?.trim())return apiModelDisplayName(id);
 const name=model.displayName.trim().replace(/\s*\(Qoder\)$/i,'').replace(/\s+/g,'-');
 return `${model.provider}/${name}`;
}
