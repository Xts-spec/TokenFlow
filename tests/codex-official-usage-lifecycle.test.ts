import {EventEmitter} from 'node:events';
import {PassThrough,Writable} from 'node:stream';
import {expect,it,vi,afterEach} from 'vitest';
const processFixture=vi.hoisted(()=>({child:undefined as any,options:undefined as any,methods:[] as string[]}));
vi.mock('../packages/core/src/codex-runtime.js',()=>({runtimeLaunch:async(binary:string)=>({file:binary,args:[],env:{}})}));
vi.mock('node:child_process',()=>({spawn:(_file:string,_args:string[],options:unknown)=>{processFixture.options=options;return processFixture.child;}}));
import {readOfficialUsage} from '../packages/core/src/codex-official-usage.js';
afterEach(()=>{processFixture.methods=[];vi.restoreAllMocks();});
it('aborts a pending official lookup and waits for its child to exit without exposing RPC data',async()=>{
 const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stdin:undefined as any,kill:vi.fn((_signal:string)=>{queueMicrotask(()=>child.emit('exit',0));return true;})});
 child.stdin=new Writable({write(chunk,_encoding,done){const message=JSON.parse(chunk.toString());processFixture.methods.push(message.method);if(message.method==='initialize')child.stdout.write(JSON.stringify({id:message.id,result:{}})+'\n');if(message.method==='account/read')child.stdout.write(JSON.stringify({id:message.id,result:{account:{type:'chatgpt',email:'fixture@example.test'}}})+'\n');done();}});
 processFixture.child=child;const controller=new AbortController(),pending=readOfficialUsage('/fixture/codex',{home:'/fixture/home',signal:controller.signal});
 const rejected=expect(pending).rejects.toThrow('unavailable');
 await expect.poll(()=>processFixture.methods.includes('account/usage/read')).toBe(true);controller.abort();await rejected;
 expect(child.kill).toHaveBeenCalledWith('SIGTERM');expect(processFixture.options).toMatchObject({windowsHide:true,env:{CODEX_HOME:'/fixture/home'},stdio:['pipe','pipe','ignore']});
 expect(processFixture.methods).toEqual(['initialize','initialized','account/read','account/usage/read']);
});
