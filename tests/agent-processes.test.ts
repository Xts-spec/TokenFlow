import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({failed:false,onlyHelpers:false,windowsCodex:false,calls:[] as string[][]}));
vi.mock('node:child_process',()=>{
 const execFile=Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:async(_file:string,args:string[])=>{
  fixture.calls.push(args);
  if(fixture.failed)throw Error('private-command-secret');
  if(fixture.onlyHelpers)return {stdout:'900 /Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/browser_crashpad_handler\n901 /Users/test/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService\n'};
  if(_file==='tasklist')return {stdout:fixture.windowsCodex?'"Codex.exe","1001"\n"CodexCLI.exe","1002"\n"ChatGPT.exe","1003"\n"node.exe","555"':'"Pi Agent Desktop.exe","999"\n"node.exe","555"'};
  if(_file==='powershell.exe')return {stdout:JSON.stringify([{ProcessId:555,CommandLine:'"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\test\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" --api-key private-command-secret'},{ProcessId:777,CommandLine:'node unrelated.js --prompt pi'}])};
  return {stdout:args.includes('pid=,comm=')?'123 node\n456 node\n678 node\n789 pi\n222 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n223 /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex\n224 /Applications/Codex.app/Contents/MacOS/Codex\n225 /usr/local/bin/codex\n900 /Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/browser_crashpad_handler\n901 /Users/test/.codex/computer-use/Codex Computer Use.app/Contents/MacOS/SkyComputerUseService\n902 /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex-code-mode-host\n903 /Applications/ChatGPT.app/Contents/Frameworks/Codex Framework.framework/Helpers/Codex (Renderer).app/Contents/MacOS/Codex (Renderer)\n999 /Applications/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop\n':'123 node /fixture/bin/dsh --api-key private-command-secret\n456 node /fixture/unrelated.js --prompt dsh\n678 node /fixture/@earendil-works/pi-coding-agent/dist/bundle/cli.js --api-key private-command-secret\n'};
 }});return {execFile};
});
import {agentProcesses} from '../packages/core/src/agent-connections';
beforeEach(()=>{fixture.failed=false;fixture.onlyHelpers=false;fixture.windowsCodex=false;fixture.calls=[];});
const platformDescriptor=Object.getOwnPropertyDescriptor(process,'platform')!;
afterEach(()=>{Object.defineProperty(process,'platform',platformDescriptor);vi.restoreAllMocks();});
it('identifies a DeepSeek Node launcher without treating prompt arguments as program names or exposing them',async()=>{
 expect(await agentProcesses('deepseek')).toEqual([123]);expect(await agentProcesses('pi')).toEqual([789,678]);
 expect(fixture.calls).toContainEqual(['-p','123,456,678','-o','pid=,args=']);
});
it('keeps process-query failures opaque and refuses an unsafe write',async()=>{
 fixture.failed=true;await expect(agentProcesses('deepseek')).rejects.toThrow('无法检查 Agent 进程');
});

it('finds official Pi Node launcher on Windows and excludes community desktop and prompt mentions',async()=>{
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});
 expect(await agentProcesses('pi')).toEqual([555]);
 expect(fixture.calls[1]).toContain('-EncodedCommand');
});

it('reports Windows Codex runtime PIDs without requiring a desktop ASAR so migration can exclude its own child',async()=>{
 Object.defineProperty(process,'platform',{value:'win32',configurable:true});fixture.windowsCodex=true;
 const pids=await agentProcesses('codex');expect(pids).toEqual([1001,1002,1003]);
 expect(pids.filter(pid=>pid!==1001)).toEqual([1002,1003]);
 expect(fixture.calls).toEqual([['/FO','CSV','/NH']]);
});

it('blocks on real Codex clients but ignores crash reporters and helpers that survive desktop exit',async()=>{expect(await agentProcesses('codex')).toEqual([222,223,224,225]);});

it('allows migration once the Mac desktop exits even while its crash reporter remains',async()=>{fixture.onlyHelpers=true;expect(await agentProcesses('codex')).toEqual([]);});
