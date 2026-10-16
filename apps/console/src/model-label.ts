import type { LocalAgentSnapshot } from '../../../packages/core/src/cliproxy';

import { modelLabel } from '../../../packages/core/src/model-label';
export { modelLabel };
export function qualifiedModelLabel(local:Pick<LocalAgentSnapshot,'models'>&{apiSources?:{id:string;name:string}[]},id:string){
 return modelLabel(local.models,id,local.apiSources);
}
