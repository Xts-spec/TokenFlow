import {afterEach,beforeEach,expect,it,vi} from 'vitest';
const fixture=vi.hoisted(()=>({failed:false,calls:[] as string[][]}));
vi.mock('node:child_process',()=>{
 const execFile=Object.assign(()=>{}, {[Symbol.for('nodejs.util.promisify.custom')]:async(_file:string,args:string[])=>{
  fixture.calls.push(args);
  if(fixture.failed)throw Error('private-command-secret');
  if(_file==='tasklist')return {stdout:'"Pi Agent Desktop.exe","999"\n"node.exe","555"'};
  if(_file==='powershell.exe')return {stdout:JSON.stringify([{ProcessId:555,CommandLine:'"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\test\\node_modules\\@earendil-works\\pi-coding-agent\\dist\\cli.js" --api-key private-command-secret'},{ProcessId:777,CommandLine:'node unrelated.js --prompt pi'}])};
  return {stdout:args.includes('pid=,comm=')?'123 node\n456 node\n678 node\n789 pi\n222 /Applications/ChatGPT.app/Contents/MacOS/ChatGPT\n223 /Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex\n224 /Applications/Codex.app/Contents/MacOS/Codex\n999 /Applications/Pi Agent Desktop.app/Contents/MacOS/Pi Agent Desktop\n':'123 node /fixture/bin/dsh --api-key private-command-secret\n456 node /fixture/unrelated.js --prompt dsh\n678 node /fixture/@earendil-works/pi-coding-agent/dist/bundle/cli.js --api-key private-command-secret\n'};
 }});return {execFile};
});
import {agentProcesses} from '../packages/core/src/agent-connections';
beforeEach(()=>{fixture.failed=false;fixture.calls=[];});
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

it('detects the Codex desktop and embedded runtime before migration',async()=>{expect(await agentProcesses('codex')).toEqual([222,223,224]);});
