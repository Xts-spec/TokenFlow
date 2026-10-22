import {expect,it,vi} from 'vitest';
import type {NetworkInterfaceInfo} from 'node:os';
import {gatewayAddresses,macHardwareInterfaces,windowsHardwareInterfaces,readGatewayInterfaceKinds} from '../packages/core/src/gateway-network';
const entry=(address:string,extra:Partial<NetworkInterfaceInfo>={}):NetworkInterfaceInfo=>({address,netmask:'255.255.255.0',family:'IPv4',mac:'02:00:00:00:00:01',internal:false,cidr:`${address}/24`,...extra} as NetworkInterfaceInfo);

it('uses Windows hardware flags even when adapters have arbitrary or localized names',()=>{
 const kinds=windowsHardwareInterfaces(JSON.stringify([
  {Name:'公司无线网',HardwareInterface:true,Virtual:false},
  {Name:'Ethernet 12',HardwareInterface:false,Virtual:true},
  {Name:'VPN uplink label',HardwareInterface:true,Virtual:false},
 ]));
 expect(gatewayAddresses({'公司无线网':[entry('172.20.4.8')],'Ethernet 12':[entry('10.1.0.9')],'VPN uplink label':[entry('192.168.50.8')]},12000,kinds)).toEqual(['http://172.20.4.8:12000','http://192.168.50.8:12000']);
 expect(windowsHardwareInterfaces('{"Name":"以太网","HardwareInterface":true,"Virtual":false}')?.get('以太网')).toBe('physical');
});
it('uses macOS hardware ports and excludes software bridges and peer-to-peer links',()=>{
 const kinds=macHardwareInterfaces('Hardware Port: Wi-Fi\nDevice: en7\nEthernet Address: 00:00\n\nHardware Port: USB LAN\nDevice: en12\n\nHardware Port: Thunderbolt Bridge\nDevice: bridge0\n');
 expect(gatewayAddresses({en7:[entry('10.5.6.7')],en12:[entry('192.168.3.7')],bridge0:[entry('172.16.2.1')],utun9:[entry('10.8.0.1')],awdl0:[entry('10.9.0.1')]},9555,kinds)).toEqual(['http://10.5.6.7:9555','http://192.168.3.7:9555']);
});
it('uses Linux device metadata rather than a whitelist of eth/en interface names',async()=>{
 const interfaces={uplink:[entry('192.168.8.22')],renamed_tunnel:[entry('10.40.0.2')],enp0s3:[entry('10.0.2.15')],br0:[entry('172.17.0.1')]};
 const hasDevice=vi.fn(async(name:string)=>['uplink','enp0s3'].includes(name)),run=vi.fn(async()=>{throw Error('not needed');});
 const kinds=await readGatewayInterfaceKinds(interfaces,'linux',{run,hasDevice});
 expect(run).not.toHaveBeenCalled();expect(gatewayAddresses(interfaces,9556,kinds)).toEqual(['http://10.0.2.15:9556','http://192.168.8.22:9556']);
});
it.each(['utun2','awdl0','llw0','bridge100','tun0','tap9','wg0','tailscale0','docker0','vethab12','virbr0','br-ab12','vmnet8','vboxnet0','vEthernet (WSL)','WireGuard Tunnel','Clash VPN','ZeroTier One','VMware Network Adapter VMnet8'])('filters known virtual interfaces when inventory fails: %s',name=>{
 expect(gatewayAddresses({[name]:[entry('10.22.33.44')],wifi:[entry('192.168.7.9')]},9555,null)).toEqual(['http://192.168.7.9:9555']);
});
it('does not mistake arbitrary physical names or locally administered MACs for virtual devices',()=>{
 expect(gatewayAddresses({'USB Ethernet 2':[entry('172.29.8.9')],'Wi-Fi 3':[entry('192.168.99.4')]},9555)).toEqual(['http://172.29.8.9:9555','http://192.168.99.4:9555']);
});
it('excludes unusable and IPv6 addresses while the gateway listens on IPv4 only',()=>{
 const interfaces={uplink:['0.0.0.0','127.0.0.2','169.254.1.2','198.18.3.4','198.19.5.6','224.1.2.3','255.255.255.255','10.300.1.1'].map(ip=>entry(ip)).concat([entry('192.168.1.3',{internal:true}),entry('fd12::1',{family:'IPv6'})])};
 expect(gatewayAddresses(interfaces,9555)).toEqual([]);
});
it('deduplicates addresses, preserves multiple LANs and reacts to changed addresses/devices',()=>{
 const kinds=new Map([['en0','physical'],['en8','physical']] as const);
 expect(gatewayAddresses({en0:[entry('192.168.3.4'),entry('192.168.3.4')],en8:[entry('10.60.1.5')]},9555,kinds)).toEqual(['http://10.60.1.5:9555','http://192.168.3.4:9555']);
 expect(gatewayAddresses({en0:[entry('172.30.1.99')],newTunnel:[entry('10.9.0.1')]},9555,kinds)).toEqual(['http://172.30.1.99:9555']);
});
it('falls back safely on unavailable commands, malformed output or inaccessible sysfs',async()=>{
 const run=vi.fn(async()=>{throw Error('unavailable');}),hasDevice=vi.fn(async()=>{throw Error('permission denied');});
 for(const platform of ['win32','darwin','linux'] as const)expect(await readGatewayInterfaceKinds({uplink:[entry('10.2.3.4')]},platform,{run,hasDevice})).toBeNull();
 expect(windowsHardwareInterfaces('bad JSON')).toBeNull();expect(windowsHardwareInterfaces('[{"Name":"Ethernet"}]')).toBeNull();expect(macHardwareInterfaces('command failed')).toBeNull();
});
it('selects the appropriate system inventory command on each platform',async()=>{
 const run=vi.fn(async(file:string)=>file==='powershell.exe'?'[{"Name":"USB LAN","HardwareInterface":true,"Virtual":false}]':'Hardware Port: Wi-Fi\nDevice: en4\n'),hasDevice=vi.fn(async()=>false);
 expect((await readGatewayInterfaceKinds({},'win32',{run,hasDevice}))?.get('USB LAN')).toBe('physical');
 expect(run.mock.calls[0][0]).toBe('powershell.exe');
 expect((await readGatewayInterfaceKinds({},'darwin',{run,hasDevice}))?.get('en4')).toBe('physical');expect(hasDevice).not.toHaveBeenCalled();
});
