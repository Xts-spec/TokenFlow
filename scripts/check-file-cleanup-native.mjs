import {build} from 'esbuild';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const require=createRequire(import.meta.url),root=fileURLToPath(new URL('../',import.meta.url));
const outfile=fileURLToPath(new URL('../.tmp/file-cleanup-native-check.cjs',import.meta.url));
await build({entryPoints:[fileURLToPath(new URL('./file-cleanup-native-check.ts',import.meta.url))],bundle:true,platform:'node',format:'cjs',target:'node22',external:['electron'],outfile});
const environment={...process.env};delete environment.ELECTRON_RUN_AS_NODE;
const result=spawnSync(require('electron'),[outfile],{cwd:root,env:environment,stdio:'inherit',timeout:60000});
if(result.error)throw result.error;
process.exitCode=result.status??1;
