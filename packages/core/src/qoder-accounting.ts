// Never forward raw sidecar lines: they may contain upstream errors or secrets.
// Keep bounded partial lines because subprocess chunks need not end at newlines.
export function qoderAccountingReader(record:(message:string)=>void) {
 let pending='',discard=false;
 return (chunk:Buffer|string)=>{
  for(const part of chunk.toString().split(/(?<=\n)/)) {
   if(!discard) {
    pending+=part;
    if(pending.length>8192){pending='';discard=true;}
   }
   if(!part.endsWith('\n'))continue;
   if(!discard) {
    const match=/qoder upstream accounting\s+([^\r\n]*)/.exec(pending);
    if(match) {
     const billable=/(?:^|\s)billable=(true|false)(?=\s|$)/.exec(match[1]);
     const credits=/(?:^|\s)credits=(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?=\s|$)/i.exec(match[1]);
     const value=credits?Number(credits[1]):NaN;
     const fields=[...(billable?[`billable=${billable[1]}`]:[]),...(Number.isFinite(value)?[`credits=${value}`]:[])];
     if(fields.length)record(`qoder upstream accounting ${fields.join(' ')}`);
    }
   }
   pending='';discard=false;
  }
 };
}
