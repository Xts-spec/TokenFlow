import {createReadStream} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';

const hash=/^[a-f0-9]{64}$/;
const pathFor=(root:string)=>join(root,'gateway-response-evidence.jsonl');
export type LegacyResponseRef={salt:string;keyId:string;responseRef:string};
function isLegacyRef(value:unknown):value is LegacyResponseRef{
 if(!value||typeof value!=='object')return false;
 const row=value as Partial<LegacyResponseRef>;
 return typeof row.salt==='string'&&hash.test(row.salt)&&typeof row.keyId==='string'&&row.keyId.length<=80&&typeof row.responseRef==='string'&&hash.test(row.responseRef);
}
/** Response identity only: no raw IDs, messages, keys or account information. */
export async function appendGatewayResponseHashes(root:string,hashes:Iterable<string>){
 const rows=[...new Set(hashes)].filter(value=>hash.test(value));if(!rows.length)return;
 // A leading newline isolates any torn final append left by an interrupted process.
 await appendFile(pathFor(root),'\n'+rows.map(value=>JSON.stringify(value)).join('\n')+'\n',{mode:0o600});
}
/** Legacy HMACs need their salt and internal key identifier, never the actual API key. */
export async function appendGatewayResponseRefs(root:string,refs:Iterable<LegacyResponseRef>){
 const rows=[...new Set([...refs].filter(isLegacyRef).map(({salt,keyId,responseRef})=>JSON.stringify({salt,keyId,responseRef})))];
 if(rows.length)await appendFile(pathFor(root),'\n'+rows.join('\n')+'\n',{mode:0o600});
}
/** Kept independently of short-lived activity traces so reindexing cannot count them again. */
export async function readGatewayResponseEvidence(root:string){
 const hashes=new Set<string>(),refs=new Map<string,LegacyResponseRef>(),input=createReadStream(pathFor(root)),lines=createInterface({input,crlfDelay:Infinity});
 try{for await(const line of lines){
  if(line.length>1024)continue;
  if(line.length===66&&line[0]==='"'&&line.at(-1)==='"'){const value=line.slice(1,-1);if(hash.test(value))hashes.add(value);continue;}
  try{const row:unknown=JSON.parse(line);if(isLegacyRef(row))refs.set(JSON.stringify([row.salt,row.keyId,row.responseRef]),row);}catch{/* Ignore torn or invalid records. */}
 }}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}finally{lines.close();input.destroy();}
 return {hashes,refs:[...refs.values()]};
}
