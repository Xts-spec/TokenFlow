export type Notice={kind:'ok'|'error';text:string};
export type Notify=(notice:Notice)=>void;
