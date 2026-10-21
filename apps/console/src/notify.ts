export type Notice={kind:'ok'|'error'|'warning';text:string;title?:string};
export type Notify=(notice:Notice)=>void;
