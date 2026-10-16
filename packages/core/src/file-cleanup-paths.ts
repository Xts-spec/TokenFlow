import {posix,win32} from 'node:path';

export type CleanupUserFolders={downloads?:string;desktop?:string};

// Node may return a Win32 extended-length path from realpath. It still names
// the same file; removing this prefix must not hide a junction's target change.
const ordinaryWindowsPath=(value:string)=>value.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\(?=[a-z]:[\\/])/i,'');
export const cleanupPathKey=(value:string,platform:NodeJS.Platform)=>platform==='win32'?win32.normalize(ordinaryWindowsPath(value)).toLowerCase():posix.normalize(value);

/** Use the target's path syntax, while permitting POSIX-hosted Windows fixtures. */
export function cleanupPaths(home:string,platform:NodeJS.Platform,env:NodeJS.ProcessEnv){
 const path=platform==='win32'&&/^(?:[a-z]:[\\/]|\\\\)/i.test(home)?win32:posix;
 const value=(name:string)=>platform==='win32'?Object.entries(env).find(([key])=>key.toLowerCase()===name.toLowerCase())?.[1]:env[name];
 // Relative/empty overrides must never turn into scans of the app's working directory.
 const absolute=(candidate:string|undefined)=>{
  if(!candidate)return undefined;
  const normalized=path.normalize(path===win32?ordinaryWindowsPath(candidate):candidate);
  // Win32 considers \cache absolute, but that still depends on the current drive.
  if(path===win32&&!/^(?:[a-z]:[\\/]|\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$))/i.test(normalized))return undefined;
  return path.isAbsolute(normalized)&&path.parse(normalized).root!==normalized?normalized:undefined;
 };
 const envPath=(name:string)=>absolute(value(name));
 const local=envPath('LOCALAPPDATA')??path.join(home,'AppData','Local');
 const config=envPath('XDG_CONFIG_HOME')??path.join(home,'.config');
 const cache=envPath('XDG_CACHE_HOME')??path.join(home,'.cache');
 const data=envPath('XDG_DATA_HOME')??path.join(home,'.local','share');
 const appData=platform==='darwin'?path.join(home,'Library','Application Support'):platform==='win32'?(envPath('APPDATA')??path.join(home,'AppData','Roaming')):config;
 return {path,value,absolute,envPath,local,config,cache,data,appData};
}
