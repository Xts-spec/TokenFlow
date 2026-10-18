import {createReadStream} from 'node:fs';
import {appendFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {join} from 'node:path';

const hash=/^[a-f0-9]{64}$/;
const pathFor=(root:string)=>join(root,'gateway-response-evidence.jsonl');
/** Response identity only: no raw IDs, messages, keys or account information. */
export async function appendGatewayResponseHashes(root:string,hashes:Iterable<string>){
 const rows=[...new Set(hashes)].filter(value=>hash.test(value));if(!rows.length)return;
 // A leading newline isolates any torn final append left by an interrupted process.
 await appendFile(pathFor(root),'\n'+rows.map(value=>JSON.stringify(value)).join('\n')+'\n',{mode:0o600});
}
/** Kept independently of short-lived activity traces so reindexing cannot count them again. */
export async function readGatewayResponseHashes(root:string){
 const hashes=new Set<string>(),input=createReadStream(pathFor(root)),lines=createInterface({input,crlfDelay:Infinity});
 try{for await(const line of lines){if(line.length!==66||line[0]!=='"'||line.at(-1)!=='"')continue;const value=line.slice(1,-1);if(hash.test(value))hashes.add(value);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}finally{lines.close();input.destroy();}
 return hashes;
}
