import {it,expect} from 'vitest';
// @ts-expect-error Acceptance helpers are executed directly by Node.
import {traeAcceptanceConfigPath,codexAcceptanceInvocation} from '../scripts/trae-acceptance-config.mjs';

it('locates native and legacy profiles on macOS, Windows and Linux without changing configs',()=>{
 for(const [platform,home,env,config,auth] of [
  ['darwin','/Users/test',{},'/Users/test/Library/Application Support/desktop-browser-agent/cliproxy/config.yaml','/Users/test/Library/Application Support/desktop-browser-agent/cliproxy/auth'],
  ['win32','C:\\Users\\测试 & Work',{APPDATA:'D:\\Profiles\\用户'},'D:\\Profiles\\用户\\token-flow\\cliproxy\\config.yaml','D:\\Profiles\\用户\\token-flow\\cliproxy\\auth'],
  ['linux','/home/test',{XDG_CONFIG_HOME:'/data/config'},'/data/config/token-flowb/cliproxy/config.yaml','/data/config/token-flowb/cliproxy/auth'],
 ] as const){const files=new Set<string>([config,auth]);expect(traeAcceptanceConfigPath({platform,home,env,exists:(p:string)=>files.has(p)})).toBe(config);}
 expect(traeAcceptanceConfigPath({platform:'win32',env:{AGENT_DATA_ROOT:'D:\\隔离测试 & data'},home:'C:\\Users\\test'})).toBe('D:\\隔离测试 & data\\cliproxy\\config.yaml');
 expect(traeAcceptanceConfigPath({platform:'linux',env:{TOKEN_FLOW_TRAE_CONFIG_PATH:'/tmp/test/config.yaml'},home:'/home/test'})).toBe('/tmp/test/config.yaml');
 const files=new Set(['/data/config/token-flow/cliproxy/auth','/data/config/desktop-browser-agent','/data/config/desktop-browser-agent/cliproxy/config.yaml']);expect(traeAcceptanceConfigPath({platform:'linux',home:'/home/test',env:{XDG_CONFIG_HOME:'/data/config'},exists:(p:string)=>files.has(p)})).toBe('/data/config/token-flow/cliproxy/config.yaml');
});
it('runs official Windows standalone/npm Codex without a command shell',()=>{
 const exe='C:\\Codex & Tools\\codex.exe';expect(codexAcceptanceInvocation({platform:'win32',env:{PATH:'C:\\Codex & Tools'},exists:(p:string)=>p===exe})).toEqual({command:exe,prefix:[]});
 const dir='C:\\Users\\测试 & Work\\npm',native=dir+'\\node_modules\\@openai\\codex-win32-x64\\vendor\\x86_64-pc-windows-msvc\\bin\\codex.exe';const files=new Set<string>([dir+'\\codex.cmd',native]);expect(codexAcceptanceInvocation({platform:'win32',arch:'x64',env:{Path:dir},exists:(p:string)=>files.has(p)})).toEqual({command:native,prefix:[]});
});
