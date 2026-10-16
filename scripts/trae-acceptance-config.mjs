import {existsSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import path from 'node:path';
import {parse} from 'yaml';

// Match Electron's appData/profile precedence on each host; do not assume the
// historical macOS profile or require users to move/edit an application config.
export function traeAcceptanceConfigPath({platform=process.platform,env=process.env,home=homedir(),exists=existsSync}={}){
 const p=platform==='win32'?path.win32:path.posix;
 if(env.TOKEN_FLOW_TRAE_CONFIG_PATH)return p.resolve(env.TOKEN_FLOW_TRAE_CONFIG_PATH);
 if(env.AGENT_DATA_ROOT)return p.join(p.resolve(env.AGENT_DATA_ROOT),'cliproxy','config.yaml');
 const appData=platform==='win32'?(env.APPDATA??p.join(home,'AppData','Roaming')):platform==='darwin'?p.join(home,'Library','Application Support'):(env.XDG_CONFIG_HOME??p.join(home,'.config'));
 const roots=['token-flow','token-flowb','desktop-browser-agent','Browser Agent'].map(name=>p.join(appData,name));
 const root=roots.find(r=>exists(p.join(r,'cliproxy','auth')))??roots.find(r=>exists(r))??roots[0];
 return p.join(root,'cliproxy','config.yaml');
}
export async function readTraeAcceptanceConfig(){
 const cfg=parse(await readFile(traeAcceptanceConfigPath(),'utf8'));
 if(!Number.isInteger(cfg.port)||cfg.port<1||cfg.port>65535||!Array.isArray(cfg['api-keys'])||typeof cfg['api-keys'][0]!=='string'||!cfg['api-keys'][0])throw Error('Installed sidecar configuration has no usable port/key.');
 return cfg;
}

// Resolve the native exe from standalone or official npm installs. No shell or
// wrapper process; paths may contain spaces, ampersands or Unicode.
export function codexAcceptanceInvocation({platform=process.platform,arch=process.arch,env=process.env,exists=existsSync}={}){
 if(platform!=='win32')return {command:'codex',prefix:[]};
 const dirs=(env.PATH??env.Path??'').split(';').map(s=>s.replace(/^"|"$/g,''));
 for(const dir of dirs){const exe=path.win32.join(dir,'codex.exe');if(exists(exe))return {command:exe,prefix:[]};
  if(exists(path.win32.join(dir,'codex.cmd'))){const modules=path.win32.join(dir,'node_modules'),root=path.win32.join(modules,'@openai','codex'),pkg=`codex-win32-${arch}`,triple=arch==='arm64'?'aarch64-pc-windows-msvc':'x86_64-pc-windows-msvc';for(const vendor of [path.win32.join(root,'node_modules','@openai',pkg,'vendor'),path.win32.join(modules,'@openai',pkg,'vendor'),path.win32.join(root,'vendor')])for(const leaf of ['bin','codex']){const native=path.win32.join(vendor,triple,leaf,'codex.exe');if(exists(native))return {command:native,prefix:[]};}}
 }
 throw Error('Official Codex native executable was not found on PATH or in its npm package.');
}
