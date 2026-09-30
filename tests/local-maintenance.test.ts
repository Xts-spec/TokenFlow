import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentConnections } from '../packages/core/src/agent-connections.js';
import { LocalMaintenance, runBounded, type Installation, type CommandRunner } from '../packages/core/src/local-maintenance.js';
const cleanup:Array<()=>Promise<unknown>>=[];
afterEach(async()=>{vi.restoreAllMocks();for(const fn of cleanup.splice(0).reverse())await fn();});
async function fixture(){
 const root=await realpath(await mkdtemp(join(tmpdir(),'local-care-')));cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const paths={codex:join(root,'codex/config.toml'),claude:join(root,'claude/settings.json'),workbuddy:join(root,'workbuddy/models.json'),qoder:join(root,'qoder/settings.json')};await mkdir(join(root,'codex'));await writeFile(paths.codex,'model = "original"\napi_key = "fixture-config-secret"\n');
 let installed:Installation={target:'codex',path:'/fixture/codex',version:'1.0.0',channel:'npm-global',reason:'matched',npm:'/fixture/npm-cli.js',prefix:'/fixture',fingerprint:'install-original',reference:'https://learn.chatgpt.com/docs/codex/cli'};let pids:number[]=[];
 const runner=vi.fn<CommandRunner>(async()=>{installed={...installed,version:'1.1.0',fingerprint:'install-new'};return {exitCode:0,stdout:'fixture-output-secret',interrupted:false,truncated:false};});
 const connections=new AgentConnections(root,paths,async()=>pids);
 const options={source:async()=>undefined,gateway:()=>({port:9,state:'stopped'}),installation:async()=>structuredClone(installed),latest:async()=>({version:'1.1.0',integrity:'sha512-aaaa'}),processes:async()=>pids,runner};
 const care=new LocalMaintenance(root,connections,options);await care.load();cleanup.push(()=>care.close());
 return {root,paths,care,runner,options,connections,setInstall:(next:Partial<Installation>)=>{installed={...installed,...next};},setPids:(next:number[])=>{pids=next;}};
}
it('diagnoses offline without a model and persists only facts across restart',async()=>{
 const {root,care,connections,options}=await fixture();await care.startDiagnostic('codex');await expect.poll(()=>care.snapshot().active).toBeUndefined();
 const snapshot=care.snapshot();expect(snapshot.runs[0].status).toBe('completed');expect(snapshot.runs[0].steps).toHaveLength(4);expect(JSON.stringify(snapshot)).not.toContain('fixture-config-secret');
 expect(snapshot.runs[0].steps.find(s=>s.name==='ports')?.data).toMatchObject({state:'stopped',evidence:{reachable:false}});
 const reopened=new LocalMaintenance(root,connections,options);await reopened.load();expect(reopened.snapshot().runs).toEqual(snapshot.runs);await reopened.close();
 await expect(care.diagnostic({check:'configuration',target:'codex',path:'/etc/passwd'} as never,new AbortController().signal)).rejects.toThrow();
});
it('only prepares a pinned npm-global upgrade and executes once with protected backup and real postconditions',async()=>{
 const {root,care,runner,paths}=await fixture();const plan=await care.prepareUpgrade();expect(runner).not.toHaveBeenCalled();plan.command.args.push('INJECTED');
 expect(care.snapshot().plan?.command.args).not.toContain('INJECTED');await expect(care.executeUpgrade('stale')).rejects.toThrow('过期');
 await care.executeUpgrade(plan.id);await expect.poll(()=>care.snapshot().active).toBeUndefined();expect(runner).toHaveBeenCalledOnce();expect(runner.mock.calls[0][0].args).toContain('@openai/codex@1.1.0');
 const run=care.snapshot().runs[0];expect(run.status).toBe('completed');expect(run.steps.at(-1)?.data).toMatchObject({version:'1.1.0',liveCallVerified:false});
 expect(await readFile(join(root,'backups',`codex-upgrade-${run.id}`,'config.toml'),'utf8')).toBe(await readFile(paths.codex,'utf8'));
 expect(await readFile(join(root,'local-maintenance.json'),'utf8')).not.toContain('fixture-output-secret');expect(JSON.stringify(care.snapshot())).not.toContain('fixture-config-secret');await expect(care.executeUpgrade(plan.id)).rejects.toThrow();
});
it('refuses unknown installation channels, downgrades and running clients without executing',async()=>{
 const {care,setInstall,setPids,runner}=await fixture();setInstall({channel:'unknown',reason:'unknown channel'});await expect(care.prepareUpgrade()).rejects.toThrow('unknown channel');
 setInstall({channel:'npm-global',version:'2.0.0'});await expect(care.prepareUpgrade()).rejects.toThrow('不执行降级');setInstall({version:'1.0.0'});setPids([4321]);await expect(care.prepareUpgrade()).rejects.toThrow('正在运行');expect(runner).not.toHaveBeenCalled();
});
it.each(['config','installation','process','metadata','expiry'] as const)('blocks %s changes after plan approval and preserves the external state',async mode=>{
 const {care,setInstall,setPids,runner,paths,options}=await fixture();const plan=await care.prepareUpgrade();
 if(mode==='config')await writeFile(paths.codex,'model = "external"\n');if(mode==='installation')setInstall({fingerprint:'changed'});if(mode==='process')setPids([111]);if(mode==='metadata')options.latest=async()=>({version:'1.1.0',integrity:'sha512-changed'});
 if(mode==='expiry'){vi.spyOn(Date,'now').mockReturnValue(Date.parse(plan.expiresAt)+1);await expect(care.executeUpgrade(plan.id)).rejects.toThrow('过期');}
 else{await care.executeUpgrade(plan.id);await expect.poll(()=>care.snapshot().active).toBeUndefined();expect(care.snapshot().runs[0].status).toBe('failed');}
 expect(runner).not.toHaveBeenCalled();if(mode==='config')expect(await readFile(paths.codex,'utf8')).toContain('external');
});
it('stops an upgrade, retains partial results and marks interrupted startup honestly',async()=>{
 const {care,root,connections,options}=await fixture();options.runner=vi.fn<CommandRunner>(async(_command,signal)=>new Promise(resolve=>signal.addEventListener('abort',()=>resolve({exitCode:null,stdout:'not logged',interrupted:true,truncated:false}),{once:true})));
 const stopped=new LocalMaintenance(root,connections,options);await stopped.load();const plan=await stopped.prepareUpgrade();await stopped.executeUpgrade(plan.id);await expect.poll(()=>options.runner.mock.calls.length).toBe(1);await stopped.stop();
 expect(stopped.snapshot().runs[0].status).toBe('stopped');expect(JSON.stringify(stopped.snapshot())).toContain('可能部分安装');await stopped.close();
 const record={...stopped.snapshot().runs[0],status:'running',endedAt:undefined};await writeFile(join(root,'local-maintenance.json'),JSON.stringify([record]));const reopened=new LocalMaintenance(root,connections,options);await reopened.load();expect(reopened.snapshot().runs[0].status).toBe('interrupted');expect(JSON.stringify(reopened.snapshot())).toContain('未自动重试');await reopened.close();await care.close();
});
it('requires configured source targets and rejects credentials and arbitrary command requests',async()=>{
 const {care,root,connections,options}=await fixture();await expect(care.diagnostic({check:'network',target:'codex',sourceId:'abcdefabcdefabcdefabcdef'},new AbortController().signal)).rejects.toThrow('不存在');
 await expect(care.diagnostic({check:'network',target:'codex',url:'https://evil.invalid',command:'curl'} as never,new AbortController().signal)).rejects.toThrow();
 await writeFile(join(root,'local-maintenance.json'),'broken');const corrupted=new LocalMaintenance(root,connections,options);await corrupted.load();expect(corrupted.snapshot().warning).toContain('原文件保留');await expect(corrupted.startDiagnostic('codex')).rejects.toThrow();expect(await readFile(join(root,'local-maintenance.json'),'utf8')).toBe('broken');await corrupted.close();
});
it('runs bounded processes without shell parsing or credential environment, and cancels output floods',async()=>{
 const {root}=await fixture();process.env.LOCAL_REPAIR_TEST_SECRET='never-inherited';try{
  const result=await runBounded({executable:process.execPath,args:['-e','process.stdout.write(JSON.stringify([process.env.LOCAL_REPAIR_TEST_SECRET,process.argv[1]]))','$(echo injected)'],cwd:root,timeoutMs:5000,outputLimit:32768},new AbortController().signal);expect(JSON.parse(result.stdout)).toEqual([null,'$(echo injected)']);
  const flood=await runBounded({executable:process.execPath,args:['-e','setInterval(()=>process.stdout.write("x".repeat(2048)),1)'],cwd:root,timeoutMs:5000,outputLimit:4096},new AbortController().signal);expect(flood.interrupted&&flood.truncated).toBe(true);expect(Buffer.byteLength(flood.stdout)).toBeLessThanOrEqual(4096);
 }finally{delete process.env.LOCAL_REPAIR_TEST_SECRET;}
});

it('identifies the actual npm-global CLI and refuses a competing installation',async()=>{
 const {root,connections,options}=await fixture();const prefix=join(root,'prefix');const packageRoot=join(prefix,'lib/node_modules/@openai/codex');const npm=join(prefix,'lib/node_modules/npm/bin/npm-cli.js');await mkdir(join(packageRoot,'bin'),{recursive:true});await mkdir(join(prefix,'bin'),{recursive:true});await mkdir(join(prefix,'lib/node_modules/npm/bin'),{recursive:true});
 const script=`#!${process.execPath}\nconsole.log('codex-cli 1.0.0');\n`;await writeFile(join(packageRoot,'bin/codex.js'),script,{mode:0o755});await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'@openai/codex',version:'1.0.0',bin:{codex:'bin/codex.js'}}));await writeFile(npm,`console.log(process.argv.includes('root')?${JSON.stringify(join(prefix,'lib/node_modules'))}:${JSON.stringify(prefix)});\n`,{mode:0o755});await symlink(join(packageRoot,'bin/codex.js'),join(prefix,'bin/codex'));await symlink(npm,join(prefix,'bin/npm'));
 vi.stubEnv('PATH',`${join(prefix,'bin')}:${process.env.PATH}`);try{
  const real=new LocalMaintenance(root,connections,{...options,installation:undefined,runner:runBounded});await real.load();const found=await real.installation('codex');expect(found).toMatchObject({channel:'npm-global',path:join(packageRoot,'bin/codex.js'),version:'1.0.0',prefix});expect(found.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  await writeFile(join(packageRoot,'package.json'),JSON.stringify({name:'untrusted-package',version:'1.0.0',bin:{codex:'bin/codex.js'}}));expect((await real.installation('codex')).channel).toBe('unknown');await real.close();
 }finally{vi.unstubAllEnvs();}
});
