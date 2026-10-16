// Renderer memory lasts until the app reloads. Cache failures too: only an explicit
// retry should read again, and simultaneous readers share the same request.
const reads=new Map<string,Promise<unknown>>();
const pending=new Map<string,Promise<unknown>>();
export function invalidateSessionReads(prefix:string){
 for(const key of reads.keys())if(key.startsWith(prefix)){reads.delete(key);pending.delete(key);}
}
export function readForSession<T>(key:string,read:()=>Promise<T>,reload=false):Promise<T>{
 const existing=pending.get(key)??(!reload?reads.get(key):undefined);
 if(existing)return existing as Promise<T>;
 const request=Promise.resolve().then(read);
 reads.set(key,request);pending.set(key,request);
 const settled=()=>{if(pending.get(key)===request)pending.delete(key);};
 void request.then(settled,settled);
 return request;
}
