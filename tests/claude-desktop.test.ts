import {afterEach,expect,it} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm,realpath,stat} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import {ClaudeDesktopConnections,claudeDesktopDirectory} from '../packages/core/src/claude-desktop.js';
import {claudeDesktopModel,claudeDesktopPlan} from '../apps/shared/claude-desktop-models.js';
const roots:string[]=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(r=>rm(r,{recursive:true,force:true})));});
const sourceId='a'.repeat(24),secretName='native-login-claude-desktop';
async function fixture(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'claude-desktop-'));roots.push(root);const directory=join(root,'Claude-3p');await mkdir(join(directory,'configLibrary'),{recursive:true});
 const vault=new Map<string,string>();let pids:number[]=[],policyError=false,failSave=0;
 const secrets={get:async(k:string)=>vault.get(k)??'',set:async(k:string,v:string)=>{if(failSave&&--failSave===0)throw Error('vault unavailable');vault.set(k,v);}};
 const connections=new ClaudeDesktopConnections(secrets,{directory,processes:async()=>pids,policy:async()=>{if(policyError)throw Error('managed policy');}});
 const meta=join(directory,'configLibrary/_meta.json'),mode=join(directory,'claude_desktop_config.json');
 const connect=async(model='claude/claude-sonnet-4-6')=>connections.connect({revision:(await connections.status()).revision,selections:[{sourceId,model}],keyId:randomUUID(),key:'fixture-scoped-key',origin:'http://127.0.0.1:9527'});
 return {root,directory,vault,secrets,connections,connect,meta,mode,running:(v:number[])=>pids=v,managed:()=>policyError=true,fail:(n:number)=>failSave=n,journal:()=>JSON.parse(vault.get(secretName)!)};
}
it('uses platform-native directories, including LocalAppData instead of roaming on Windows',()=>{
 expect(claudeDesktopDirectory('darwin','/Users/test',{})).toBe('/Users/test/Library/Application Support/Claude-3p');
 expect(claudeDesktopDirectory('win32','C:\\Users\\test',{LOCALAPPDATA:'D:\\Local',APPDATA:'D:\\Roaming'})).toBe('D:\\Local\\Claude-3p');
 expect(claudeDesktopDirectory('win32','C:\\Users\\test',{})).toBe('C:\\Users\\test\\AppData\\Local\\Claude-3p');
 expect(claudeDesktopDirectory('linux','/home/test',{XDG_CONFIG_HOME:'/custom/config'})).toBe('/custom/config/Claude-3p');
});
it('writes the official gateway profile, preserves original login files, and restores selectors while retaining later preferences',async()=>{
 const f=await fixture();const originalId=randomUUID(),hybrid={configId:originalId};
 await writeFile(f.meta,JSON.stringify({appliedId:originalId,hybridPointer:hybrid,entries:[{id:originalId,name:'Original'}]}));await writeFile(f.mode,JSON.stringify({deploymentMode:'1p',theme:'light'}));
 const cookie=join(f.root,'Claude','Cookies');await mkdir(join(f.root,'Claude'));await writeFile(cookie,'untouched login fixture');
 await f.connect();const first=f.journal(),profilePath=join(f.directory,'configLibrary',`${first.id}.json`);const profile=JSON.parse(await readFile(profilePath,'utf8'));
 expect(profile).toEqual({inferenceGatewayApiKey:'fixture-scoped-key',inferenceGatewayAuthScheme:'bearer',inferenceGatewayBaseUrl:'http://127.0.0.1:9527',inferenceProvider:'gateway',inferenceModels:[{name:'claude-sonnet-5',labelOverride:'claude/claude-sonnet-4-6',supports1m:true,prefer1m:true,anthropicFamilyTier:'sonnet',isFamilyDefault:true}],coworkEgressAllowedHosts:['*'],disableDeploymentModeChooser:true});expect(first.modelAliases).toEqual({'claude-sonnet-5':'claude/claude-sonnet-4-6','claude-opus-5':'claude/claude-sonnet-4-6','claude-haiku-4-5':'claude/claude-sonnet-4-6','claude-fable-5':'claude/claude-sonnet-4-6'});expect((await stat(profilePath)).mode&0o777).toBe(0o600);
 expect(JSON.stringify(await f.connections.status())).not.toContain('fixture-scoped-key');expect(JSON.parse(await readFile(f.meta,'utf8')).hybridPointer).toBeUndefined();
 await f.connect('qoder/claude-opus-4-6');expect(f.journal().id).toBe(first.id);expect(f.journal().before).toEqual(first.before);
 const meta=JSON.parse(await readFile(f.meta,'utf8'));meta.entries.push({id:'later',name:'New user profile'});await writeFile(f.meta,JSON.stringify(meta));await writeFile(f.mode,JSON.stringify({deploymentMode:'3p',theme:'dark',keep:true}));
 await f.connections.restore((await f.connections.status()).revision);
 expect(JSON.parse(await readFile(f.mode,'utf8'))).toEqual({deploymentMode:'1p',theme:'dark',keep:true});expect(JSON.parse(await readFile(f.meta,'utf8'))).toEqual({appliedId:originalId,hybridPointer:hybrid,entries:[{id:originalId,name:'Original'},{id:'later',name:'New user profile'}]});expect(await readFile(cookie,'utf8')).toBe('untouched login fixture');await expect(readFile(profilePath)).rejects.toHaveProperty('code','ENOENT');expect((await f.connections.status()).backup).toBeNull();
});
it('maps any selected model onto the desktop slots and keeps unlisted built-in requests on the default',()=>{
 expect(claudeDesktopModel('deepseek/deepseek-chat')).toBe(false);
 expect(claudeDesktopPlan([{model:'deepseek/deepseek-v4-pro'},{model:'gpt-5.6-sol'}],{'deepseek/deepseek-v4-pro':'DeepSeek Pro','gpt-5.6-sol':'Sol'})).toEqual({visible:[{name:'claude-sonnet-5',model:'deepseek/deepseek-v4-pro',label:'DeepSeek Pro',familyDefault:true},{name:'claude-sonnet-4-6',model:'gpt-5.6-sol',label:'Sol',familyDefault:false}],aliases:{'claude-sonnet-5':'deepseek/deepseek-v4-pro','claude-sonnet-4-6':'gpt-5.6-sol','claude-opus-5':'deepseek/deepseek-v4-pro','claude-haiku-4-5':'deepseek/deepseek-v4-pro','claude-fable-5':'deepseek/deepseek-v4-pro'}});
 expect(claudeDesktopPlan([{model:'deepseek/deepseek-v4-pro'},{model:'gpt-5.6-sol'}],{'deepseek/deepseek-v4-pro':'DeepSeek Pro','gpt-5.6-sol':'Sol'},'gpt-5.6-sol').aliases).toMatchObject({'claude-opus-5':'deepseek/deepseek-v4-pro','claude-fable-5':'deepseek/deepseek-v4-pro','claude-haiku-4-5':'gpt-5.6-sol','claude-sonnet-4-6':'gpt-5.6-sol'});
 expect(()=>claudeDesktopPlan([{model:'deepseek/deepseek-v4-pro'}],{},'missing')).toThrow('快速模型必须在已选模型中');
 const many=claudeDesktopPlan([1,2,3,4,5].map(n=>({model:`m${n}`})));expect(many.visible.map(item=>item.name)).toEqual(['claude-sonnet-5','claude-sonnet-4-6','claude-opus-4-6','claude-haiku-4-6','claude-fable-4-6']);expect(many.aliases['claude-sonnet-4-6']).toBe('m2');expect(many.aliases['claude-haiku-4-5']).toBe('m1');
 expect(()=>claudeDesktopPlan(Array.from({length:201},(_,n)=>({model:`m${n}` })))).toThrow('最多接入 200');
});
it('keeps Opus and Fable on the default model and sends Haiku requests to the fast model',async()=>{
 const f=await fixture();const fast='b'.repeat(24);
 await f.connections.connect({revision:(await f.connections.status()).revision,selections:[{sourceId,model:'deepseek/deepseek-v4-pro'},{sourceId:fast,model:'deepseek/deepseek-v4-flash'}],fastModel:'deepseek/deepseek-v4-flash',keyId:randomUUID(),key:'fixture-scoped-key',origin:'http://127.0.0.1:9527',labels:{'deepseek/deepseek-v4-pro':'Pro','deepseek/deepseek-v4-flash':'Flash'}});
 expect(f.journal().fastModel).toBe('deepseek/deepseek-v4-flash');expect(f.journal().modelAliases['claude-haiku-4-5']).toBe('deepseek/deepseek-v4-flash');expect(f.journal().modelAliases['claude-opus-5']).toBe('deepseek/deepseek-v4-pro');expect(f.journal().modelAliases['claude-fable-5']).toBe('deepseek/deepseek-v4-pro');
 expect((await f.connections.status()).fastModel).toBe('deepseek/deepseek-v4-flash');
});
it('rejects running apps, managed policy, and stale revisions before changing files',async()=>{
 const f=await fixture();
 f.running([1]);await expect(f.connect()).rejects.toThrow('退出');f.running([]);
 await expect(f.connections.connect({revision:'0'.repeat(64),selections:[{sourceId,model:'claude/claude-sonnet-4-6'}],keyId:randomUUID(),key:'fixture',origin:'http://127.0.0.1:1'})).rejects.toThrow('变化');
 f.managed();await expect(f.connect()).rejects.toThrow('managed');expect(f.vault.size).toBe(0);await expect(readFile(f.mode)).rejects.toHaveProperty('code','ENOENT');
});
it('keeps backups and refuses overwriting a profile changed by the desktop app',async()=>{
 const f=await fixture();await f.connect();const path=join(f.directory,'configLibrary',`${f.journal().id}.json`);await writeFile(path,'{"user":"changed"}');
 await expect(f.connections.restore((await f.connections.status()).revision)).rejects.toThrow('已被客户端修改');await expect(f.connect()).rejects.toThrow('原备份已保留');expect(await readFile(path,'utf8')).toBe('{"user":"changed"}');
});
it('does not write config if the secure backup fails, and recovers an interrupted final journal save',async()=>{
 const f=await fixture();f.fail(1);await expect(f.connect()).rejects.toThrow('vault unavailable');await expect(readFile(f.mode)).rejects.toHaveProperty('code','ENOENT');
 f.fail(2);await expect(f.connect()).rejects.toThrow('vault unavailable');expect((await f.connections.status()).backup?.state).toBe('prepared');
 await f.connections.restore((await f.connections.status()).revision);expect((await f.connections.status()).backup).toBeNull();await expect(readFile(f.mode)).rejects.toHaveProperty('code','ENOENT');
});
it('recovers a partial application and a partial restore without losing the original third-party deployment',async()=>{
 const f=await fixture();await writeFile(f.mode,JSON.stringify({deploymentMode:'3p',theme:'light'}));await f.connect();let j=f.journal();
 j.state='prepared';f.vault.set(secretName,JSON.stringify(j));await writeFile(f.mode,j.before.mode);
 await f.connections.restore((await f.connections.status()).revision);expect(JSON.parse(await readFile(f.mode,'utf8')).deploymentMode).toBe('3p');
 await f.connect();j=f.journal();const currentMeta=await readFile(f.meta,'utf8');f.fail(2);await expect(f.connections.restore((await f.connections.status()).revision)).rejects.toThrow('vault unavailable');expect(f.journal().restoring).toBe(true);
 await writeFile(f.meta,currentMeta);await f.connections.restore((await f.connections.status()).revision);expect((await f.connections.status()).backup).toBeNull();expect(JSON.parse(await readFile(f.mode,'utf8'))).toEqual({deploymentMode:'3p',theme:'light'});
});
