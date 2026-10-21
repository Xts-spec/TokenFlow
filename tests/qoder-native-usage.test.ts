import {afterEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {LocalUsageParser,mergeLocalUsageRows} from '../packages/core/src/local-usage.js';
import {totalsOf,spentByPlatform} from '../apps/console/src/usage-model.js';

const timestamp='2026-10-20T02:00:00Z';
it('keeps fractional Qoder Credits and identifies official billing without modelSource',()=>{
 const parser=new LocalUsageParser('qoder','fixture');
 parser.accept({type:'assistant',timestamp,message:{id:'response',model:'kmodel_latest',usage:{input_tokens:0,output_tokens:0,credits:1.831011546,billable:true,request_id:'request'}}});
 const rows=parser.rows();
 expect(rows).toEqual([expect.objectContaining({channel:'official',requests:1,unmeasured:1,credits:1.831011546,inputTokens:0,outputTokens:0})]);
 expect(spentByPlatform(rows[0],{id:'qoder',accounts:[]})).toBe(true);
 const combined=mergeLocalUsageRows([...rows,...rows]);expect(totalsOf(combined)).toMatchObject({requests:1,credits:1.831011546,totalTokens:0});
});

import {readQoderIdeUsage,qoderIdeUsagePath} from '../packages/core/src/qoder-ide-usage.js';
const roots:string[]=[];afterEach(async()=>{await Promise.all(roots.splice(0).map(root=>rm(root,{recursive:true,force:true})));});
async function fixture(){
 const root=await mkdtemp(join(await realpath(tmpdir()),'tf-qoder-ide-'));roots.push(root);const path=join(root,'local.db'),db=new DatabaseSync(path);
 db.exec('CREATE TABLE chat_message(id TEXT,session_id TEXT,request_id TEXT,role TEXT,token_info TEXT,model_info TEXT,gmt_create INTEGER,content TEXT); CREATE TABLE chat_record(request_id TEXT,session_id TEXT,extra TEXT);');
 db.prepare('INSERT INTO chat_record VALUES(?,?,?)').run('turn','session',JSON.stringify({modelConfig:{key:'dfmodel'},question:'PRIVATE_PROMPT'}));
 const add=(id:string,model:unknown,usage:unknown,role='assistant')=>db.prepare('INSERT INTO chat_message VALUES(?,?,?,?,?,?,?,?)').run(id,'session','turn',role,JSON.stringify(usage),JSON.stringify(model),Date.parse(timestamp),'PRIVATE_BODY');
 return {db,path,add};
}
it('reads individual IDE model calls, includes cache once and keeps unknown models',async()=>{
 const {db,path,add}=await fixture();
 add('a',{model_key:'dfmodel'},{prompt_tokens:100,completion_tokens:20,cached_tokens:60});
 add('b',{}, {prompt_tokens:50,completion_tokens:10,cached_tokens:20});
 add('tool',{model_key:'dfmodel'},{prompt_tokens:999},'tool');db.close();
 const rows=await readQoderIdeUsage(path);
 expect(rows).toHaveLength(2);expect(rows[0]).toMatchObject({target:'qoder-ide',provider:'qoder',channel:'official',model:'qoder/dfmodel',inputTokens:100,cachedTokens:60,outputTokens:20});
 expect(rows[1].model).toBe('未标注模型');expect(rows.every(r=>r.nativeAccountId===undefined)).toBe(true);
 expect(totalsOf(rows)).toMatchObject({totalTokens:180,requests:2});expect(JSON.stringify(rows)).not.toContain('PRIVATE');
 expect(rows.every(r=>spentByPlatform(r,{id:'qoder',accounts:[]}))).toBe(true);
});
it('counts third-party IDE usage for the client but not the Qoder account and excludes gateway copies',async()=>{
 const {db,path,add}=await fixture();
 const usage={prompt_tokens:80,completion_tokens:10,cached_tokens:20};
 add('external',{model_key:'external-model',modelSource:'custom',customProviderId:'company'},usage);
 add('proxied',{model_key:'token-flow/codex/model'},usage);
 add('marked',{model_key:'plain',customProviderId:'token-flow'},usage);db.close();
 const rows=await readQoderIdeUsage(path);expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({target:'qoder-ide',channel:'api',inputTokens:80,outputTokens:10});
 expect(spentByPlatform(rows[0],{id:'qoder',accounts:[]})).toBe(false);
});
it('locates IDE databases on macOS and Windows',()=>{
 expect(qoderIdeUsagePath('darwin','/home/test',{})).toBe('/home/test/Library/Application Support/Qoder/SharedClientCache/cache/db/local.db');
 expect(qoderIdeUsagePath('win32','C:\\Users\\test',{})).toBe('C:\\Users\\test\\AppData\\Roaming\\Qoder\\SharedClientCache\\cache\\db\\local.db');
});

import {LocalUsageIndex} from '../packages/core/src/local-usage-index.js';
import {agentPaths} from '../packages/core/src/agent-connections.js';
import {vi} from 'vitest';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
it('indexes IDE WAL appends, keeps Credits after restart and upgrades the existing Qoder cache',async()=>{
 const {db,path,add}=await fixture(),root=join(path,'..');
 db.exec('PRAGMA journal_mode=WAL');
 add('one',{model_key:'dfmodel'},{prompt_tokens:100,completion_tokens:20,cached_tokens:60});
 const paths=agentPaths(root),directory=join(root,'.qoder','projects');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,'history.jsonl'),JSON.stringify({type:'assistant',timestamp,message:{id:'app',model:'auto',usage:{input_tokens:0,output_tokens:0,credits:0.16,billable:true}}})+'\n');
 let index=new LocalUsageIndex(root,paths,()=>[],{'qoder-ide':[path]});
 const settled=async(count:number)=>vi.waitFor(()=>{const state=index.snapshot();expect(state.scanning).toBe(false);expect(state.warning).toBeUndefined();expect(totalsOf(state.rows)).toMatchObject({requests:count,credits:0.16});expect(state.coverage.find(c=>c.target==='qoder-ide')).toMatchObject({status:'ready',indexed:1});},{timeout:5000,interval:25});
 try{
  index.snapshot();await settled(2);
  add('two',{model_key:'dfmodel'},{prompt_tokens:50,completion_tokens:10,cached_tokens:20});index.refresh();await settled(3);
  await index.close();db.close();
  const cachePath=join(root,'local-usage-index.json'),saved=JSON.parse(await readFile(cachePath,'utf8'));saved.version=16;
  for(const entry of Object.values(saved.files) as any[])if(entry.target==='qoder')for(const row of entry.rows){delete row.credits;row.channel='unknown';}
  await writeFile(cachePath,JSON.stringify(saved));
  index=new LocalUsageIndex(root,paths,()=>[],{'qoder-ide':[path]});index.snapshot();await settled(3);
  expect(index.snapshot().rows.find(row=>row.target==='qoder')).toMatchObject({channel:'official',credits:0.16});
 }finally{await index.close();try{db.close();}catch{}}
});

import {nativeActivityTrace} from '../packages/core/src/activity-traces.js';
import {tokenTotalText} from '../apps/console/src/usage-model.js';
it('shows credit-only consumption as unknown Tokens in summaries and activity, never a measured zero',()=>{
 const parser=new LocalUsageParser('qoder','credits');parser.accept({timestamp,message:{id:'credit-only',model:'auto',usage:{credits:0.16,billable:true}}});
 const row=parser.rows()[0];expect(tokenTotalText(totalsOf([row]))).toBe('未提供');
 expect(nativeActivityTrace(row)).toMatchObject({credits:0.16,inputTokens:null,outputTokens:null,cachedTokens:null});
});
