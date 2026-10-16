import path from 'node:path';

type PathOperations=Pick<typeof path,'join'|'resolve'|'basename'|'dirname'>;

/** Match Harness home resolution, including tilde overrides and blank environment values. */
export function deepseekConfigPath(home:string,override:string|undefined,paths:PathOperations=path):string {
 const selected=override?.trim()?override:paths.join(home,'.dsh');
 const expanded=selected==='~'?home:selected.startsWith('~/')||selected.startsWith('~\\')?paths.join(home,selected.slice(2)):selected;
 return paths.join(paths.resolve(expanded),'profiles','desktop','cordis.patch.yml');
}

/** Profiles own settings; sessions and the legacy global patch belong to DSH_HOME. */
export function deepseekHome(configPath:string,paths:PathOperations=path):string {
 const directory=paths.dirname(configPath),parent=paths.dirname(directory);
 return paths.basename(parent)==='profiles'?paths.dirname(parent):directory;
}
