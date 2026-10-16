import {afterEach, expect, it, vi} from 'vitest';
import {createServer, type Server} from 'node:http';
import {mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {parse} from 'yaml';
import {CLIProxyManager} from '../packages/core/src/cliproxy.js';
import {createNetworkProxy,environmentProxy,systemProxy,isLoopback} from '../packages/core/src/network-proxy.js';
import {safeEnvironment} from '../packages/core/src/process-environment.js';
import {request} from 'node:http';
import {connect} from 'node:net';

const cleanup: Array<()=>Promise<unknown>>=[];
afterEach(async()=>{for(const close of cleanup.splice(0).reverse())await close();vi.unstubAllEnvs();});
async function listen(server:Server){
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  cleanup.push(()=>new Promise<void>(r=>{server.closeAllConnections();server.close(()=>r());}));
  return (server.address() as {port:number}).port;
}

it('lets the real gateway reach an external quota endpoint through the configured proxy',async()=>{
  const requests:string[]=[];
  const proxyPort=await listen(createServer((req,res)=>{
    requests.push(req.url!);
    res.setHeader('content-type','application/json');res.end('{"viaProxy":true}');
  }));
  for(const name of ['HTTP_PROXY','HTTPS_PROXY','http_proxy','https_proxy'])vi.stubEnv(name,`http://127.0.0.1:${proxyPort}`);
  for(const name of ['NO_PROXY','no_proxy','ALL_PROXY','all_proxy'])vi.stubEnv(name,'');
  const root=await mkdtemp(join(tmpdir(),'tokenflow-network-'));
  cleanup.push(()=>rm(root,{recursive:true,force:true}));
  const reservation=createServer();const port=await listen(reservation);
  await new Promise<void>(r=>reservation.close(()=>r()));
  const binary=resolve('sidecars',`${process.platform}-${process.arch}`,process.platform==='win32'?'cliproxyapi.exe':'cliproxyapi');
  const manager=new CLIProxyManager(root,binary,'network-test-key',port);
  cleanup.push(()=>manager.shutdown());
  await manager.configure();
  const config=parse(await readFile(join(root,'cliproxy/config.yaml'),'utf8'));
  await manager.start();
  const response=await fetch(`http://127.0.0.1:${port}/v0/management/api-call`,{
    method:'POST',headers:{authorization:`Bearer ${config['remote-management']['secret-key']}`,'content-type':'application/json'},
    body:JSON.stringify({method:'GET',url:'http://tokenflow-network-test.invalid/quota'}),signal:AbortSignal.timeout(3000),
  });
  const result=await response.json();
  expect(result).toMatchObject({status_code:200,body:'{"viaProxy":true}'});
  expect(requests,'The gateway must reach the proxy even when the origin cannot be reached directly').toEqual(['http://tokenflow-network-test.invalid/quota']);
});

it('follows per-site system proxy decisions for Node fetch and keeps loopback direct',async()=>{
  const proxied:string[]=[];
  const upstream=await listen(createServer((req,res)=>{proxied.push(req.url!);res.end('proxy reached');}));
  const local=await listen(createServer((_req,res)=>res.end('local reached')));
  const resolver=vi.fn(async()=>`PROXY 127.0.0.1:${upstream}`);
  const network=await createNetworkProxy(resolver,{});cleanup.push(()=>network.close());network.installFetch();
  expect(await (await fetch('http://example.invalid/models')).text()).toBe('proxy reached');
  expect(resolver).toHaveBeenCalledWith('http://example.invalid/models');
  expect(await (await fetch(`http://127.0.0.1:${local}/api/local-agent`)).text()).toBe('local reached');
  expect(proxied).toEqual(['http://example.invalid/models']);
  expect(resolver).toHaveBeenCalledTimes(1);
  resolver.mockResolvedValue('DIRECT');
  const failed=await fetch('http://another-host.invalid/models',{signal:AbortSignal.timeout(2000)}).catch(()=>null);
  expect(failed?.ok??false).toBe(false);await failed?.body?.cancel();
  expect(proxied).toHaveLength(1);
});

it('tunnels HTTPS bytes using the system proxy and requires local bridge authentication',async()=>{
  const tunnels:string[]=[];
  const echo=createServer();echo.on('connect',(req,socket)=>{cleanup.push(async()=>{socket.destroy();});tunnels.push(req.url!);socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');socket.on('data',data=>socket.write(data));});
  const proxyPort=await listen(echo);
  const resolver=vi.fn(async()=>`PROXY 127.0.0.1:${proxyPort}`);
  const network=await createNetworkProxy(resolver,{});cleanup.push(()=>network.close());
  const bridge=new URL(network.url);
  const unauthenticated=await new Promise<number>(r=>{request({host:bridge.hostname,port:bridge.port,path:'http://example.invalid/'},res=>{res.resume();r(res.statusCode!);}).end();});
  expect(unauthenticated).toBe(407);expect(resolver).not.toHaveBeenCalled();
  const socket=connect(Number(bridge.port),bridge.hostname);cleanup.push(async()=>{socket.destroy();});
  const auth=Buffer.from(`${bridge.username}:${bridge.password}`).toString('base64');
  const received=new Promise<string>((resolve,reject)=>{let data='';socket.on('error',reject);socket.on('data',chunk=>{data+=chunk;if(data.includes('tunnel-payload'))resolve(data);});});
  socket.write(`CONNECT auth.example.invalid:443 HTTP/1.1\r\nHost: auth.example.invalid:443\r\nProxy-Authorization: Basic ${auth}\r\n\r\ntunnel-payload`);
  expect(await received).toContain('200 Connection Established');
  expect(tunnels).toEqual(['auth.example.invalid:443']);
  expect(resolver).toHaveBeenCalledWith('https://auth.example.invalid/');
});

it('preserves explicit proxy settings without forwarding unrelated secrets',()=>{
  vi.stubEnv('HTTPS_PROXY','http://127.0.0.1:7890');vi.stubEnv('OPENAI_API_KEY','test-secret');
  expect(safeEnvironment().HTTPS_PROXY).toBe('http://127.0.0.1:7890');
  expect(safeEnvironment().OPENAI_API_KEY).toBeUndefined();
  expect(environmentProxy(new URL('https://example.test'),{HTTPS_PROXY:'http://127.0.0.1:7890'})).toBe('http://127.0.0.1:7890/');
  expect(environmentProxy(new URL('https://sub.example.test:8443'),{NO_PROXY:'.example.test:8443',ALL_PROXY:'socks5://127.0.0.1:7891'})).toBe('');
  expect(environmentProxy(new URL('https://sub.example.test'),{NO_PROXY:'.example.test:8443',ALL_PROXY:'socks5://127.0.0.1:7891'})).toBe('socks5://127.0.0.1:7891');
  expect(environmentProxy(new URL('https://example.test'),{})).toBeUndefined();
  for(const host of ['localhost','127.0.0.2','[::1]','[::ffff:7f00:1]'])expect(isLoopback(host)).toBe(true);
  expect(isLoopback('localhost.attacker.test')).toBe(false);
  expect(systemProxy('PROXY 127.0.0.1:7890; DIRECT')).toBe('http://127.0.0.1:7890/');
  expect(systemProxy('SOCKS5 127.0.0.1:7891')).toBe('socks5h://127.0.0.1:7891');
  expect(systemProxy('DIRECT')).toBe('');
  expect(()=>systemProxy('UNSUPPORTED proxy.test:80')).toThrow();
});
