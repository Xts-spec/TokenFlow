export type ApiProtocol='responses'|'chat'|'messages';

/** Keep source identities in routing IDs, not in fallback menu labels. */
export function apiModelDisplayName(value:string){
 return value.replace(/^api-[a-f0-9]{24}\//,'');
}

/** Hosts where plain HTTP stays on the machine or the local network. */
export function isLocalHttpHost(hostname:string){
 const host=hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host==='[::1]')return true;
 const parts=host.split('.');
 if(parts.length!==4||parts.some(part=>!/^\d{1,3}$/.test(part)))return false;
 const [a,b,c,d]=parts.map(Number);
 if([a,b,c,d].some(part=>part>255))return false;
 return a===10||a===127||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===169&&b===254);
}

/** A version suffix alone cannot distinguish OpenAI protocols. */
export function protocolFromURL(value:string):ApiProtocol|undefined{
 try{
  const path=new URL(value.trim()).pathname.replace(/\/+$/,'');
  if(/\/chat\/completions$/.test(path))return 'chat';
  if(/\/responses$/.test(path))return 'responses';
  if(/\/(?:messages|anthropic)(?:\/v\d+)?$/.test(path))return 'messages';
 }catch{/* Invalid URLs are reported by the form validator. */}
 return undefined;
}

export function normalizeApiBaseURL(value:string){
 return value.trim().replace(/\/+$/,'').replace(/\/(?:chat\/completions|responses|messages|models)$/,'');
}

export type ApiModelRoute={protocol:ApiProtocol;baseURL:string};
export type RoutedApiSource={id:string;protocol:ApiProtocol;baseURL:string;modelRoutes?:Record<string,ApiModelRoute>};

/** Old sources retain their default route until their models are verified. */
export function apiModelRoute(source:RoutedApiSource,model:string):ApiModelRoute{
 const prefix=`api-${source.id}/`;
 const upstream=model.startsWith(prefix)?model.slice(prefix.length):model;
 const route=source.modelRoutes&&Object.hasOwn(source.modelRoutes,upstream)?source.modelRoutes[upstream]:{protocol:source.protocol,baseURL:source.baseURL};
 return {...route,baseURL:normalizeApiBaseURL(route.baseURL)};
}
