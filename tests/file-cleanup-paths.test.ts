import {expect,it} from 'vitest';
import {cleanupCatalog} from '../packages/core/src/file-cleanup-catalog.js';
import {artifactLocations} from '../packages/core/src/file-cleanup-artifacts.js';
import {cleanupPathKey} from '../packages/core/src/file-cleanup-paths.js';

it.each([
 {platform:'darwin',home:'/Users/alice',profile:'/Users/alice/TokenFlow',paths:{npm:'/Users/alice/.npm/_cacache',pip:'/Users/alice/Library/Caches/pip',uv:'/Users/alice/.cache/uv',pnpm:'/Users/alice/Library/pnpm/store',go:'/Users/alice/Library/Caches/go-build',code:'/Users/alice/Library/Application Support/Code/Cache',chromium:'/Users/alice/Library/Caches/Chromium/Default/Cache'}},
 {platform:'win32',home:'C:\\Users\\Alice',profile:'C:\\Users\\Alice\\TokenFlow',paths:{npm:'C:\\Users\\Alice\\AppData\\Local\\npm-cache\\_cacache',pip:'C:\\Users\\Alice\\AppData\\Local\\pip\\Cache',uv:'C:\\Users\\Alice\\AppData\\Local\\uv\\cache',pnpm:'C:\\Users\\Alice\\AppData\\Local\\pnpm\\store',go:'C:\\Users\\Alice\\AppData\\Local\\go-build',code:'C:\\Users\\Alice\\AppData\\Roaming\\Code\\Cache',chromium:'C:\\Users\\Alice\\AppData\\Local\\Chromium\\User Data\\Default\\Cache'}},
 {platform:'linux',home:'/home/alice',profile:'/home/alice/TokenFlow',paths:{npm:'/home/alice/.npm/_cacache',pip:'/home/alice/.cache/pip',uv:'/home/alice/.cache/uv',pnpm:'/home/alice/.local/share/pnpm/store',go:'/home/alice/.cache/go-build',code:'/home/alice/.config/Code/Cache',chromium:'/home/alice/.cache/chromium/Default/Cache'}},
])('uses native $platform cache roots without mixing app data and browser caches',({platform,home,profile,paths})=>{
 const rules=cleanupCatalog(home,platform as NodeJS.Platform,profile,{});
 for(const [name,key] of [['npm 下载缓存','npm'],['pip 下载缓存','pip'],['uv 下载缓存','uv'],['pnpm 共享存储','pnpm'],['Go 构建缓存','go'],['Code · Cache','code'],['Chromium · Default · Cache','chromium']] as const){
  expect(rules.find(rule=>rule.name===name)?.path).toBe(paths[key]);
 }
 expect(rules.find(rule=>rule.name==='pnpm 共享存储')?.risk).toBe('protected');
 expect(rules.filter(rule=>rule.risk==='rebuildable').some(rule=>/^(?:Default|User Data|User|Code)$/.test(rule.path.split(/[\\/]/).at(-1)!))).toBe(false);
});

it('honors pnpm precedence on every platform and Windows case-insensitive environment names',()=>{
 for(const platform of ['darwin','linux','win32'] as const){
  const rules=cleanupCatalog('/home',platform,'/profile',{PNPM_HOME:'/pnpm-home',XDG_DATA_HOME:'/xdg-data'});
  expect(rules.find(rule=>rule.name==='pnpm 共享存储')?.path).toBe('/pnpm-home/store');
  expect(cleanupCatalog('/home',platform,'/profile',{XDG_DATA_HOME:'/xdg-data'}).find(rule=>rule.name==='pnpm 共享存储')?.path).toBe('/xdg-data/pnpm/store');
 }
 const windows=cleanupCatalog('C:\\Users\\Alice','win32','C:\\TokenFlow',{LocalAppData:'D:\\Local',AppData:'D:\\Roaming',uv_cache_dir:'E:\\uv',codex_home:'E:\\codex'});
 expect(windows.find(rule=>rule.name==='npm 下载缓存')?.path).toBe('D:\\Local\\npm-cache\\_cacache');
 expect(windows.find(rule=>rule.name==='Code · Cache')?.path).toBe('D:\\Roaming\\Code\\Cache');
 expect(windows.find(rule=>rule.name==='uv 下载缓存')?.path).toBe('E:\\uv');
 expect(windows.find(rule=>rule.name==='Codex 历史会话')?.path).toBe('E:\\codex\\sessions');
});

it('uses XDG and explicit tool overrides, never relative, empty, root or off paths',()=>{
 const rules=cleanupCatalog('/home/alice','linux','/profile',{XDG_CACHE_HOME:'/cache',XDG_CONFIG_HOME:'/config',UV_CACHE_DIR:'/uv',PIP_CACHE_DIR:'/pip',GOCACHE:'/go',GRADLE_USER_HOME:'/gradle',PLAYWRIGHT_BROWSERS_PATH:'0'});
 expect(rules.find(rule=>rule.name==='Chromium · Default · Cache')?.path).toBe('/cache/chromium/Default/Cache');
 expect(rules.find(rule=>rule.name==='Code · Cache')?.path).toBe('/config/Code/Cache');
 for(const [name,path] of [['uv 下载缓存','/uv'],['pip 下载缓存','/pip'],['Go 构建缓存','/go'],['Gradle 构建缓存','/gradle/caches']])expect(rules.find(rule=>rule.name===name)?.path).toBe(path);
 expect(rules.some(rule=>rule.name==='ms-playwright 运行时')).toBe(false);
 const invalid=cleanupCatalog('/home/alice','linux','/profile',{NPM_CONFIG_CACHE:'',PIP_CACHE_DIR:'relative-cache',UV_CACHE_DIR:'/',XDG_CONFIG_HOME:'relative-config',GOCACHE:'off'});
 expect(invalid.find(rule=>rule.name==='npm 下载缓存')?.path).toBe('/home/alice/.npm/_cacache');
 expect(invalid.find(rule=>rule.name==='pip 下载缓存')?.path).toBe('/home/alice/.cache/pip');
 expect(invalid.find(rule=>rule.name==='uv 下载缓存')?.path).toBe('/home/alice/.cache/uv');
 expect(invalid.some(rule=>rule.name==='Go 构建缓存')).toBe(false);
 expect(invalid.every(rule=>rule.path.startsWith('/')&&rule.path!=='/')).toBe(true);
 const mac=cleanupCatalog('/Users/alice','darwin','/profile',{HOMEBREW_CACHE:'/brew',CHROME_CONFIG_HOME:'/ignored-on-mac'});
 expect(mac.find(rule=>rule.name==='Homebrew 下载缓存')?.path).toBe('/brew');
 const customChromium=cleanupCatalog('/home/alice','linux','/profile',{CHROME_CONFIG_HOME:'/custom-config',XDG_CACHE_HOME:'/cache'});
 expect(customChromium.find(rule=>rule.name==='Chromium · Default · Cache')?.path).toBe('/custom-config/chromium/Default/Cache');
});

it('shows native redirected user folders, Windows Program Files and UNC cache paths',()=>{
 const env={LocalAppData:'D:\\Local',ProgramFiles:'D:\\Apps','ProgramFiles(x86)':'D:\\Apps32',UV_CACHE_DIR:'\\\\server\\share\\uv'};
 const rules=cleanupCatalog('C:\\Users\\Alice','win32','C:\\TokenFlow',env);
 expect(rules.find(rule=>rule.name==='uv 下载缓存')?.path).toBe('\\\\server\\share\\uv');
 const locations=artifactLocations('C:\\Users\\Alice','win32',env,undefined,{desktop:'D:\\OneDrive\\Desktop',downloads:'E:\\Downloads'});
 expect(locations.map(location=>location.path)).toEqual(['D:\\Local\\Programs','D:\\Apps','D:\\Apps32','C:\\Users\\Alice','E:\\Downloads','D:\\OneDrive\\Desktop']);
});

it('rejects drive-relative and device paths while accepting equivalent Win32 long paths',()=>{
 const cache=(UV_CACHE_DIR:string)=>cleanupCatalog('C:\\Users\\Alice','win32','C:\\TokenFlow',{UV_CACHE_DIR}).find(rule=>rule.name==='uv 下载缓存')!.path;
 for(const invalid of ['\\cache','C:cache','C:\\','\\\\server\\share\\','\\\\.\\PhysicalDrive0','\\\\?\\GLOBALROOT\\Device\\HarddiskVolume1'])expect(cache(invalid)).toBe('C:\\Users\\Alice\\AppData\\Local\\uv\\cache');
 expect(cache('\\\\?\\D:\\缓存\\uv')).toBe('D:\\缓存\\uv');
 expect(cache('\\\\?\\UNC\\server\\share\\uv')).toBe('\\\\server\\share\\uv');
 expect(cleanupPathKey('\\\\?\\C:\\Users\\Alice\\Cache','win32')).toBe(cleanupPathKey('c:/users/alice/cache','win32'));
 expect(cleanupPathKey('\\\\?\\UNC\\server\\share\\Cache','win32')).toBe(cleanupPathKey('\\\\SERVER\\share\\cache','win32'));
 expect(cleanupPathKey('C:\\junction','win32')).not.toBe(cleanupPathKey('C:\\target','win32'));
 expect(cleanupPathKey('/home/Alice/cache','linux')).not.toBe(cleanupPathKey('/home/alice/cache','linux'));
});
