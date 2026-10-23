import {execFile} from 'node:child_process';
import {access} from 'node:fs/promises';
import {networkInterfaces} from 'node:os';
import {join} from 'node:path';
import {promisify} from 'node:util';

export type InterfaceKinds=Map<string,'physical'|'virtual'>;
type Interfaces=ReturnType<typeof networkInterfaces>;
const execute=promisify(execFile);
const virtualName=/^(?:utun\d*|tun\d*|tap\d*|wg\d*|tailscale\d*|docker\d*|veth[\da-f]+|virbr\d*|vmnet\d*|vboxnet\d*|bridge\d*|br-.+|br\d+|awdl\d*|llw\d*|p2p\d*|ipsec\d*|ppp\d*|gif\d*|stf\d*|sit\d*|ip6tnl\d*|zt[\da-z]+|feth\d*|anpi\d*)(?:$|[\s:_-])|vpn|virtual|hyper-v|vethernet|wireguard|wintun|zerotier|tailscale|vmware|virtualbox|loopback/i;

/** The listener is IPv4-only. Exclude addresses that cannot identify a LAN host. */
function usableIPv4(address:string){
 if(!/^\d+\.\d+\.\d+\.\d+$/.test(address))return false;
 const octets=address.split('.').map(Number),[a,b]=octets;
 return octets.every(n=>n<=255)&&a!==0&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===198&&(b===18||b===19));
}

/** OS classification wins over user-editable interface names. No MAC/OUI or host IP allowlist. */
export function gatewayAddresses(interfaces:Interfaces,port:number,kinds?:InterfaceKinds|null):string[]{
 const addresses=Object.entries(interfaces).flatMap(([name,entries])=>{
  if(kinds?kinds.get(name)!=='physical':virtualName.test(name))return [];
  return (entries??[]).filter(entry=>entry.family==='IPv4'&&!entry.internal&&usableIPv4(entry.address)).map(entry=>entry.address);
 });
 return [...new Set(addresses)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map(address=>`http://${address}:${port}`);
}

export function macHardwareInterfaces(output:string):InterfaceKinds|null {
 const devices=[...output.matchAll(/^Device:\s*(\S+)\s*$/gm)].map(match=>match[1]);
 if(!devices.length)return null;
 // networksetup also lists Thunderbolt software bridges among its hardware ports.
 return new Map(devices.map(name=>[name,/^(bridge|awdl|llw|p2p|utun|anpi)\d*$/.test(name)?'virtual':'physical']));
}
export function windowsHardwareInterfaces(output:string):InterfaceKinds|null {
 try{
  const parsed=JSON.parse(output.replace(/^\uFEFF/,'')),rows=Array.isArray(parsed)?parsed:[parsed],kinds:InterfaceKinds=new Map();
  for(const row of rows){
   if(typeof row?.Name!=='string'||typeof row.HardwareInterface!=='boolean'||typeof row.Virtual!=='boolean')continue;
   kinds.set(row.Name,row.HardwareInterface&&!row.Virtual?'physical':'virtual');
  }
  return kinds.size?kinds:null;
 }catch{return null;}
}

/** System probes are bounded and read-only. Failure falls back to portable name/address filtering. */
export async function readGatewayInterfaceKinds(interfaces:Interfaces,platform:NodeJS.Platform=process.platform,deps={
 run:async(file:string,args:string[])=>String((await execute(file,args,{timeout:2500,maxBuffer:1024*1024,windowsHide:true})).stdout),
 hasDevice:async(name:string)=>{try{await access(join('/sys/class/net',name,'device'));return true;}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}},
}):Promise<InterfaceKinds|null>{
 try{
  if(platform==='darwin')return macHardwareInterfaces(await deps.run('/usr/sbin/networksetup',['-listallhardwareports']));
  if(platform==='win32')return windowsHardwareInterfaces(await deps.run('powershell.exe',['-NoProfile','-NonInteractive','-Command',"[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); Get-NetAdapter -IncludeHidden -ErrorAction Stop | Select-Object Name,HardwareInterface,Virtual | ConvertTo-Json -Compress"]));
  if(platform==='linux')return new Map(await Promise.all(Object.keys(interfaces).map(async name=>{
   if(name.includes('/')||name.includes('\\')||name==='.'||name==='..')throw Error('Invalid interface name');
   return [name,await deps.hasDevice(name)?'physical':'virtual'] as const;
  })));
 }catch{/* Do not block model access when system inventory is unavailable. */}
 return null;
}
