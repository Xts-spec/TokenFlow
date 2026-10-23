/** Shared by the renderer and server: HTTP is allowed only on loopback/private addresses. */
export function allowsHttpAPI(hostname:string):boolean {
 const host=hostname.toLowerCase();
 if(host==='localhost'||host.endsWith('.localhost')||host==='[::1]')return true;
 // mDNS names resolve on the local link only; treating them like private IPs keeps LAN setups working.
 if(host.endsWith('.local'))return true;
 if(/^\[f[cd][0-9a-f]{2}:/.test(host))return true;
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(host))return false;
 const octets=host.split('.').map(Number);
 if(octets.some(n=>n>255))return false;
 const [a,b]=octets;
 // 127/8 loopback, 10/8 and 192.168/16 private, 172.16/12 private, 169.254/16 link-local.
 return a===127||a===10||a===172&&b>=16&&b<=31||a===192&&b===168||a===169&&b===254;
}
