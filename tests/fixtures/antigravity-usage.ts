import {DatabaseSync} from 'node:sqlite';
const vint=(n:number):Buffer=>{const out:number[]=[];do{out.push((n%128)|(n>=128?128:0));n=Math.floor(n/128);}while(n);return Buffer.from(out);};
const field=(n:number,v:number|string|Buffer)=>typeof v==='number'?Buffer.concat([vint(n*8),vint(v)]):Buffer.concat([vint(n*8+2),vint(Buffer.byteLength(v)),Buffer.from(v)]);
const msg=(...fields:Buffer[])=>Buffer.concat(fields);
export const agGeneration=(id:string,time=Date.parse('2026-10-17T10:00:00Z'),model='gemini-test',input=20,read=80,output=30)=>msg(field(1,msg(
 field(1,'DO_NOT_STORE_PROMPT'),field(4,msg(field(2,input),field(3,output),field(5,read),field(9,10),field(11,id))),
 field(9,field(4,field(1,Math.floor(time/1000)))),field(19,model),field(21,'Gemini Test')
)),field(4,'execution-1'));
export function agDatabase(path:string,data=agGeneration('response-1')){
 const db=new DatabaseSync(path);db.exec('PRAGMA user_version=1;CREATE TABLE trajectory_meta (trajectory_id TEXT PRIMARY KEY,cascade_id TEXT,trajectory_type INTEGER,source INTEGER);CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY,data BLOB,size INTEGER);');
 db.prepare('INSERT INTO trajectory_meta VALUES (?,?,1,1)').run('trajectory-1','cascade-1');db.prepare('INSERT INTO gen_metadata VALUES (0,?,?)').run(data,data.length);db.close();
}
export {field};
