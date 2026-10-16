export const PROJECT_LINKS={
 home:'https://github.com/haruinia/TokenFlow',
 guide:'https://github.com/haruinia/TokenFlow#三个常用场景',
 feedback:'https://github.com/haruinia/TokenFlow/issues',
} as const;

const allowed=new Set(Object.values(PROJECT_LINKS).map(url=>new URL(url).href));

/** Open supported project links in the browser, without creating an app window. */
export function projectWindowOpenHandler(openExternal:(url:string)=>Promise<void>,onError:(url:string)=>void){
 return ({url}:{url:string}):{action:'deny'}=>{
  let accepted=false;
  try{accepted=allowed.has(new URL(url).href);}catch{/* Invalid URLs stay blocked. */}
  if(accepted)void openExternal(url).catch(()=>onError(url));
  return {action:'deny'};
 };
}
