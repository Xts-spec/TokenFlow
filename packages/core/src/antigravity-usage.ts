import {DatabaseSync} from 'node:sqlite';
import {lstat} from 'node:fs/promises';
import {safePath} from './agent-connections.js';
import {LocalUsageParser,type LocalUsageRow} from './local-usage.js';

// A deliberately small protobuf reader: only usage metadata is decoded. Prompts,
// tool arguments, response headers and generated text are never returned or saved.
type Field={tag:number;value:bigint|Buffer};
function fields(data:Buffer):Field[]{
 let offset=0;const result:Field[]=[];
 const read=()=>{let n=0n;for(let shift=0n;shift<70n;shift+=7n){if(offset>=data.length)throw Error('Truncated metadata');const b=data[offset++];n|=BigInt(b&127)<<shift;if(!(b&128))return n;}throw Error('Invalid metadata');};
 while(offset<data.length){
  if(result.length>=20000)throw Error('Large metadata');
  const key=read(),tag=Number(key>>3n),wire=Number(key&7n);if(!tag||tag>536870911)throw Error('Invalid field');
  if(wire===0)result.push({tag,value:read()});
  else if(wire===2){const size=Number(read());if(!Number.isSafeInteger(size)||size>data.length-offset)throw Error('Truncated field');result.push({tag,value:data.subarray(offset,offset+size)});offset+=size;}
  else if(wire===1||wire===5)offset+=wire===1?8:4;
  else throw Error('Invalid wire type');
  if(offset>data.length)throw Error('Truncated metadata');
 }
 return result;
}
const bytes=(list:Field[],tag:number)=>list.find(f=>f.tag===tag&&Buffer.isBuffer(f.value))?.value as Buffer|undefined;
const nested=(list:Field[],tag:number)=>fields(bytes(list,tag)??Buffer.alloc(0));
const counter=(list:Field[],tag:number)=>{const value=list.find(f=>f.tag===tag&&typeof f.value==='bigint')?.value??0n;const n=Number(value);if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid counter');return n;};
const text=(list:Field[],tag:number)=>{const b=bytes(list,tag);return b&&b.length<=300?b.toString('utf8'):undefined;};

/** Antigravity IDE's SQLite trajectory v1, CortexStepGeneratorMetadata →
 * ChatModelMetadata → ModelUsageStats. Field numbers were checked against the
 * installed language server's own protobuf descriptors; steps contain copies
 * of generation usage and must not be added a second time. */
export async function readAntigravityUsage(path:string,matchesResponse?:(id:string)=>boolean):Promise<LocalUsageRow[]>{
 for(const p of [path,path+'-wal',path+'-shm'])await safePath(p);
 const stat=await lstat(path);if(!stat.isFile()||stat.size>512*1024*1024)throw Error('Unsupported trajectory');
 const db=new DatabaseSync(path,{readOnly:true}),parser=new LocalUsageParser('antigravity',path,{matchesResponse});
 try{
  db.exec('PRAGMA busy_timeout=1000;BEGIN');
  if(Number(db.prepare('PRAGMA user_version').get()?.user_version)!==1)throw Error('Unsupported trajectory version');
  const meta=db.prepare('SELECT trajectory_id FROM trajectory_meta LIMIT 2').all();if(meta.length!==1||typeof meta[0].trajectory_id!=='string')throw Error('Unsupported trajectory identity');
  const records=db.prepare('SELECT idx,data FROM gen_metadata WHERE length(data)<=4194304 ORDER BY idx LIMIT 100001').all();if(records.length>100000)throw Error('Large trajectory');
  for(const record of records){
   try{
    if(!(record.data instanceof Uint8Array))continue;
    const gen=fields(Buffer.from(record.data)),chat=nested(gen,1),usage=nested(chat,4);if(!usage.length)continue;
    const timestamp=nested(nested(chat,9),4),seconds=counter(timestamp,1),nanos=counter(timestamp,2);
    if(seconds<946684800||seconds>253402300799||nanos>=1e9)continue;
    const model=text(chat,21)??text(chat,19);if(!model)continue;
    const responseId=text(usage,11)??text(usage,12)??text(usage,7);
    // Input here is the uncached portion; cache read/write are disjoint. Output
    // already contains thinking, so reasoning is a subset, never added again.
    parser.accept({id:`${meta[0].trajectory_id}:${record.idx}`,timestamp:new Date(seconds*1000+Math.floor(nanos/1e6)).toISOString(),authType:'oauth',requestedModel:model,message:{id:responseId,model:text(chat,19)??model,usage:{input_tokens:counter(usage,2),cache_read_input_tokens:counter(usage,5),cache_creation_input_tokens:counter(usage,4),output_tokens:counter(usage,3),output_tokens_details:{thinking_tokens:counter(usage,9)}}}});
   }catch{/* One torn/unknown generation must not discard other measured calls. */}
  }
  return parser.rows();
 }finally{db.close();}
}
