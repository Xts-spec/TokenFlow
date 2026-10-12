import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

import { modelLabel } from '../../../packages/core/src/model-label';
export { modelLabel };
export function qualifiedModelLabel(local:LocalAgentSnapshot,id:string){
 const source=local.apiSources?.find(s=>id.startsWith(`api-${s.id}/`));
 return source?`${source.name} · ${id.slice(`api-${source.id}/`.length)}`:modelLabel(local.models,id);
}
