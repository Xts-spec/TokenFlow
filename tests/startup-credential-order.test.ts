import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import type {ServiceOptions} from '../packages/core/src/service.js';

const fixture=vi.hoisted(()=>({root:'',events:[] as string[],decide:(_allowed:boolean)=>{},decision:Promise.resolve(false)}));
const storage=vi.hoisted(()=>({
 isEncryptionAvailable:vi.fn(()=>{fixture.events.push('storage-available');return true;}),
 encryptString:vi.fn(()=>{fixture.events.push('storage-encrypt');return Buffer.from('fixture');}),
}));
const service=vi.hoisted(()=>vi.fn(async(_options:ServiceOptions)=>({app:{listen:()=>new Promise<string>(()=>{})}})));
const clientRead=vi.hoisted(()=>vi.fn(async()=>null));
vi.mock('electron',()=>({
 app:{getPath:()=>fixture.root,setPath:vi.fn(),setName:vi.fn(),requestSingleInstanceLock:()=>true,whenReady:async()=>{},setAboutPanelOptions:vi.fn(),dock:{setIcon:vi.fn()},quit:vi.fn(),exit:vi.fn()},
 safeStorage:storage,session:{fromPartition:()=>({setProxy:async()=>{},resolveProxy:async()=>''}),defaultSession:{setProxy:async()=>{}}},
 Menu:{setApplicationMenu:vi.fn(),buildFromTemplate:()=>({})},nativeImage:{createFromPath:()=>({})},dialog:{showErrorBox:vi.fn()},
 BrowserWindow:class{},shell:{},ipcMain:{},clipboard:{},Tray:class{},
}));
vi.mock('../apps/desktop/src/profile.js',()=>({resolveProfile:()=>fixture.root}));
vi.mock('../apps/desktop/src/startup-window.js',()=>({createStartupWindow:async()=>({
 update:async(status:string)=>{fixture.events.push(`status:${status}`);},
 confirmCredentialAccess:()=>{fixture.events.push('confirm');return fixture.decision;},
})}));
vi.mock('../apps/desktop/src/secrets.js',()=>({createSecrets:()=>({
 get:async()=>{fixture.events.push('saved-credential');return 'fixture-local-key';},
 warnings:()=>[],
})}));
vi.mock('../packages/core/src/network-proxy.js',()=>({createNetworkProxy:async()=>({url:'http://127.0.0.1:1',installFetch:()=>{},snapshot:()=>({})})}));
vi.mock('../packages/core/src/service.js',()=>({createDesktopService:service}));
vi.mock('../apps/desktop/src/file-cleanup.js',()=>({desktopCleanupFiles:()=>({})}));
vi.mock('../apps/desktop/src/qoder-crypto.js',()=>({qoderCrypto:clientRead,qoderIdeCrypto:clientRead,runQoderCrypto:vi.fn()}));
vi.mock('../packages/core/src/claude-accounts.js',()=>({claudeKeychain:()=>({read:clientRead,write:clientRead})}));
vi.mock('../packages/core/src/agent-connections.js',()=>({agentPaths:()=>({claude:join(fixture.root,'claude/settings.json')})}));

beforeEach(async()=>{
 vi.resetModules();vi.clearAllMocks();fixture.root=await mkdtemp(join(tmpdir(),'tokenflow-startup-order-'));fixture.events=[];
 fixture.decision=new Promise(resolve=>{fixture.decide=resolve;});
});
afterEach(async()=>{await rm(fixture.root,{recursive:true,force:true});});

it.each([true,false])('shows the startup choice before any secure storage access (client access: %s)',async allowed=>{
 await import('../apps/desktop/src/main.js');
 await expect.poll(()=>fixture.events.includes('confirm')).toBe(true);
 expect(fixture.events.filter(event=>event.startsWith('storage-')||event==='saved-credential')).toEqual([]);
 expect(service).not.toHaveBeenCalled();expect(clientRead).not.toHaveBeenCalled();
 fixture.decide(allowed);
 await expect.poll(()=>service.mock.calls.length).toBe(1);
 expect(fixture.events.indexOf('saved-credential')).toBeGreaterThan(fixture.events.indexOf('confirm'));
 const crypto=service.mock.calls[0][0].desktopAccounts?.crypto;if(!crypto)throw new Error('Missing guarded client crypto');
 if(allowed){await crypto('decrypt','fixture');expect(clientRead).toHaveBeenCalledOnce();}
 else {await expect(crypto('decrypt','fixture')).rejects.toThrow('本次启动未允许');expect(clientRead).not.toHaveBeenCalled();}
});
