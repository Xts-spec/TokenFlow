import {DatabaseSync} from 'node:sqlite';
import {lstat} from 'node:fs/promises';
import {homedir} from 'node:os';
import {win32,posix} from 'node:path';
import {safePath} from './agent-connections.js';
import {qoderIdeLoginPath} from './qoder-ide-login.js';
import {LocalUsageParser,type LocalUsageEvidence,type LocalUsageRow} from './local-usage.js';

export function qoderIdeUsagePath(platform:NodeJS.Platform=process.platform,home=homedir(),env:NodeJS.ProcessEnv=process.env){
 const p=platform==='win32'?win32:posix;
 return p.join(p.dirname(p.dirname(p.dirname(qoderIdeLoginPath(platform,home,env)))),'SharedClientCache','cache','db','local.db');
}
const object=(value:unknown):Record<string,any>=>{try{const parsed=JSON.parse(String(value??''));return parsed&&typeof parsed==='object'&&!Array.isArray(parsed)?parsed:{};}catch{return {};}};
const count=(value:unknown)=>typeof value==='number'&&Number.isFinite(value)&&value>=0?Math.round(value):0;
/** SharedClientCache stores one token_info per assistant inference, not per user turn.
 * Only usage/model metadata is selected. Session ownership and the current login are
 * deliberately not used as historical proof of the account that paid for a request. */
export async function readQoderIdeUsage(path:string,evidence:LocalUsageEvidence={}):Promise<LocalUsageRow[]>{
 for(const file of [path,path+'-wal',path+'-shm'])await safePath(file);
 const info=await lstat(path);if(!info.isFile()||info.size>512*1024*1024)throw Error('Unsupported Qoder IDE database');
 const db=new DatabaseSync(path,{readOnly:true}),parser=new LocalUsageParser('qoder-ide',path,evidence);
 try{
  db.exec('PRAGMA busy_timeout=1000;BEGIN');
  const rows=db.prepare(`SELECT m.id,m.gmt_create,m.token_info,m.model_info,
   CASE WHEN json_valid(r.extra) THEN json_extract(r.extra,'$.modelConfig') END AS model_config
   FROM chat_message m LEFT JOIN chat_record r ON r.request_id=m.request_id AND r.session_id=m.session_id
   WHERE m.role='assistant' AND m.token_info IS NOT NULL AND m.token_info!=''
   ORDER BY m.gmt_create LIMIT 200001`).all();
  if(rows.length>200000)throw Error('Large Qoder IDE usage table');
  for(const row of rows){
   const u=object(row.token_info),model=object(row.model_info),config=object(row.model_config),time=Number(row.gmt_create);
   if(!Number.isFinite(time)||time<946684800000)continue;
   const name=typeof model.model_key==='string'&&model.model_key?model.model_key:'未标注模型';
   const provider=model.provider??config.provider,custom=model.modelSource==='custom'||config.modelSource==='custom'||!!model.customProviderId||!!config.customProviderId;
   const read=Math.min(count(u.cached_tokens),count(u.prompt_tokens));
   parser.accept({id:String(row.id),timestamp:new Date(time).toISOString(),requestedModel:name,provider,customProviderId:model.customProviderId??config.customProviderId,
    modelSource:custom?'custom':typeof config.key==='string'&&config.key?'official':undefined,
    message:{model:name,usage:{input_tokens:Math.max(0,count(u.prompt_tokens)-read),...(u.cached_tokens!==undefined?{cache_read_input_tokens:read}:{}),output_tokens:count(u.completion_tokens),...(typeof u.credits==='number'?{credits:u.credits}:{}),billable:u.billable}}});
  }
  return parser.rows();
 }finally{db.close();}
}
