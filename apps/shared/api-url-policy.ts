/** Shared by the renderer and server: HTTP is allowed only on loopback/private IPs. */
export function allowsHttpAPI(hostname:string):boolean {
 const host=hostname.toLowerCase();
 if(host==='localhost'||host==='[::1]')return true;
 if(/^\[f[cd][0-9a-f]{2}:/.test(host))return true;
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(host))return false;
 const octets=host.split('.').map(Number);
 if(octets.some(n=>n>255))return false;
 const [a,b]=octets;
 return a===127||a===10||a===172&&b>=16&&b<=31||a===192&&b===168;
}
