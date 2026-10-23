import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { GatewayAccess, gatewayAccessInput, normalizeGatewayIP, gatewayAddresses } from '../packages/core/src/gateway-access.js';
import { GatewayKeys, gatewayKeyInput } from '../packages/core/src/gateway-keys.js';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function allocator() {
  const server = createServer();
  await new Promise<void>(resolve => server.listen(0, '0.0.0.0', resolve));
  const port = (server.address() as { port: number }).port;
  const close = () => new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return { port, close };
}
async function freePort() { const server = await allocator(); await server.close(); return server.port; }
async function setup(persisted?: string) {
  const root = await mkdtemp(join(tmpdir(), 'gateway-access-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  if (persisted !== undefined) await writeFile(join(root, 'gateway-access.json'), persisted);
  const keys = await GatewayKeys.open(root);
  const create = (access: 'local' | 'lan', exported = true) => keys.create(gatewayKeyInput.parse({ name: access, access, models: ['codex/test'] }), exported);
  const lan = await create('lan');
  const access = await GatewayAccess.open(root, keys);
  access.app.get('/v1/models', async () => ({ data: [{ id: 'codex/test' }] }));
  access.app.post('/v1/responses', async request => z.object({ model: z.string() }).parse(request.body));
  access.app.get('/v1/failure', async () => { throw new Error('upstream-secret'); });
  cleanup.push(() => access.close());
  const headers = { authorization: `Bearer ${lan.apiKey}` };
  const save = (enabled: boolean, port: number, allowedIPs: string[] = []) => access.update(gatewayAccessInput.parse({ enabled, port, allowedIPs }));
  return { root, access, keys, lan, create, headers, save };
}

it('defaults to a stopped entrance and validates exact normalized IPs and valid ports', async () => {
  const { root, access } = await setup();
  expect(await access.start()).toEqual({ enabled: false, port: 9555, allowedIPs: [], running: false, lastError: null, addresses: [] });
  await expect(readFile(join(root, 'gateway-access.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  expect(gatewayAccessInput.parse({ allowedIPs: ['::ffff:192.0.2.1', '192.0.2.1', '2001:0DB8:0:0:0:0:0:1'] }).allowedIPs).toEqual(['192.0.2.1', '2001:db8::1']);
  expect(normalizeGatewayIP('::ffff:c000:201')).toBe('192.0.2.1');
  for (const value of ['192.168.1.0/24', '*', 'localhost', '999.1.1.1', 'fe80::1%en0']) expect(gatewayAccessInput.safeParse({ allowedIPs: [value] }).success).toBe(false);
  for (const port of [0, 65536, 9958555, 2.5]) expect(gatewayAccessInput.safeParse({ port }).success).toBe(false);
});

it('accepts only exported LAN keys without cookie or administrator fallback and rejects conflicting credentials and browsers', async () => {
  const { access, create, lan, headers, save } = await setup();
  const local = await create('local'), internal = await create('lan', false);
  await save(true, await freePort());
  for (const rejected of [{}, { authorization: 'Bearer administrator' }, { cookie: 'agent_session=administrator' }, { authorization: `Bearer ${local.apiKey}` }, { authorization: `Bearer ${internal.apiKey}` }, { ...headers, 'x-api-key': 'different' }, { authorization: 'Basic arbitrary', 'x-api-key': lan.apiKey }]) {
    expect((await access.app.inject({ url: '/v1/models', headers: rejected })).statusCode).toBe(401);
  }
  for (const accepted of [headers, { 'x-api-key': lan.apiKey }, { authorization: `bearer ${lan.apiKey}` }, { ...headers, 'x-api-key': lan.apiKey }]) {
    expect((await access.app.inject({ url: '/v1/models', headers: accepted })).statusCode).toBe(200);
  }
  expect((await access.app.inject({ url: '/v1/models', headers: { ...headers, origin: 'https://example.test' } })).statusCode).toBe(403);
  for (const url of ['/api/settings', '/health', '/']) expect((await access.app.inject({ url, headers })).statusCode).toBe(404);
});

it('checks the socket peer rather than forwarded headers and normalizes mapped addresses', async () => {
  const { access, headers, save } = await setup();
  await save(true, await freePort(), ['192.168.1.23', '2001:db8::1']);
  for (const remoteAddress of ['192.168.1.23', '::ffff:192.168.1.23', '2001:0db8:0:0:0:0:0:1']) {
    expect((await access.app.inject({ url: '/v1/models', headers, remoteAddress })).statusCode).toBe(200);
  }
  expect((await access.app.inject({ url: '/v1/models', remoteAddress: '192.168.1.24', headers: { ...headers, 'x-forwarded-for': '192.168.1.23', forwarded: 'for=192.168.1.23' } })).statusCode).toBe(403);
});

it('keeps source IP restrictions separate for each exported key',async()=>{
 const {access,keys,save}=await setup();await save(true,await freePort());
 const a=await keys.create(gatewayKeyInput.parse({name:'a',access:'lan',models:['codex/test'],allowedIPs:['192.168.1.23']}),true);
 const b=await keys.create(gatewayKeyInput.parse({name:'b',access:'lan',models:['codex/test']}),true);
 const call=(apiKey:string,remoteAddress:string)=>access.app.inject({url:'/v1/models',remoteAddress,headers:{authorization:`Bearer ${apiKey}`,'x-forwarded-for':'192.168.1.23'}});
 expect((await call(a.apiKey,'::ffff:192.168.1.23')).statusCode).toBe(200);
 expect((await call(a.apiKey,'192.168.1.24')).statusCode).toBe(403);
 expect((await call(b.apiKey,'192.168.1.24')).statusCode).toBe(200);
});

it('persists explicit settings, supports port changes and re-enable, and starts the saved entrance on restart', async () => {
  const { root, access, keys, headers, save } = await setup();
  const first = await freePort(), second = await freePort();
  expect((await save(true, first)).running).toBe(true);
  expect(access.app.server.address()).toMatchObject({ address: '0.0.0.0', port: first });
  const origin = `http://127.0.0.1:${first}`;
  expect((await fetch(`${origin}/v1/models`, { headers })).status).toBe(200);
  await save(true, second);
  expect(access.app.server.address()).toMatchObject({ port: second });
  await Promise.all([save(false, second), save(true, second)]);
  expect(access.snapshot().running).toBe(true);
  expect(access.snapshot().addresses.every(address => !address.includes('0.0.0.0') && address.endsWith(`:${second}`))).toBe(true);
  expect(JSON.parse(await readFile(join(root, 'gateway-access.json'), 'utf8'))).toEqual({ enabled: true, port: second, allowedIPs: [] });
  await access.close();
  const restored = await GatewayAccess.open(root, keys); cleanup.push(() => restored.close());
  restored.app.get('/v1/models', async () => ({ restored: true }));
  expect((await restored.start()).running).toBe(true);
  const response = await fetch(`http://127.0.0.1:${second}/v1/models`, { headers });
  expect(await response.json()).toEqual({ restored: true });
  await restored.close();
  await expect(restored.update(gatewayAccessInput.parse({ enabled: true, port: second }))).rejects.toThrow('已关闭');
});

it('rolls back active settings and persisted config when a replacement port is occupied', async () => {
  const { root, access, headers, save } = await setup();
  const original = await freePort(); await save(true, original);
  const occupied = await allocator(); cleanup.push(occupied.close);
  await expect(save(true, occupied.port)).rejects.toThrow('已被占用');
  expect(access.snapshot()).toMatchObject({ enabled: true, port: original, running: true, lastError: expect.stringContaining('已被占用') });
  expect(JSON.parse(await readFile(join(root, 'gateway-access.json'), 'utf8')).port).toBe(original);
  const response = await fetch(`http://127.0.0.1:${original}/v1/models`, { headers });
  expect(response.status).toBe(200); await response.text();
});

it('gives active streams a bounded grace period before disabling and can reuse the listener afterward', async () => {
  const { access, headers, save } = await setup();
  let disconnected = false;
  access.app.get('/v1/stream', async (_request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
    reply.raw.write('data: active\n\n');
    reply.raw.once('close', () => { disconnected = true; });
  });
  const port = await freePort(); await save(true, port);
  const stream = await fetch(`http://127.0.0.1:${port}/v1/stream`, { headers });
  const reader = stream.body!.getReader();
  expect((await reader.read()).done).toBe(false);
  const disconnectedClient = reader.read().then(result => result.done, () => true);
  const started = Date.now();
  expect((await save(false, port)).running).toBe(false);
  expect(Date.now() - started).toBeLessThan(4000);
  expect(Date.now() - started).toBeGreaterThanOrEqual(1500);
  await expect(disconnectedClient).resolves.toBe(true);
  await expect.poll(() => disconnected).toBe(true);
  expect((await save(true, port)).running).toBe(true);
  const response = await fetch(`http://127.0.0.1:${port}/v1/models`, { headers });
  expect(response.status).toBe(200); await response.text();
});

it('rolls back a new listener if saving fails and preserves the existing listener', async () => {
  const { root, access, headers, save } = await setup();
  const original = await freePort(); await save(true, original);
  await rm(join(root, 'gateway-access.json')); await mkdir(join(root, 'gateway-access.json'));
  await expect(save(true, await freePort())).rejects.toThrow('保存失败');
  expect(access.snapshot()).toMatchObject({ port: original, running: true });
  const response = await fetch(`http://127.0.0.1:${original}/v1/models`, { headers });
  expect(response.status).toBe(200); await response.text();
});

it('keeps malformed saved configuration stopped without replacing the file, and reports startup collisions', async () => {
  const invalid = '{"enabled":true,"port":9958555}';
  const { root, access } = await setup(invalid);
  expect(await access.start()).toMatchObject({ enabled: false, running: false, lastError: expect.stringContaining('gateway-access.json') });
  expect(await readFile(join(root, 'gateway-access.json'), 'utf8')).toBe(invalid);
  const occupied = await allocator(); cleanup.push(occupied.close);
  const config = JSON.stringify({ enabled: true, port: occupied.port, allowedIPs: [] });
  const other = await setup(config);
  expect(await other.access.start()).toMatchObject({ enabled: true, running: false, lastError: expect.stringContaining('已被占用') });
  expect(await readFile(join(other.root, 'gateway-access.json'), 'utf8')).toBe(config);
});

it('returns validation failures as 400 and hides unexpected server error details', async () => {
  const { access, headers, save } = await setup();
  await save(true, await freePort());
  expect((await access.app.inject({ method: 'POST', url: '/v1/responses', headers, payload: {} })).statusCode).toBe(400);
  const failed = await access.app.inject({ url: '/v1/failure', headers });
  expect(failed.statusCode).toBe(500); expect(failed.body).not.toContain('upstream-secret');
});

it('excludes tunnels and discards disappeared addresses',()=>{
 const entry=(address:string)=>({address,netmask:'255.255.255.0',family:'IPv4' as const,mac:'00:00:00:00:00:00',internal:false,cidr:`${address}/24`});
 expect(gatewayAddresses({utun2:[entry('198.18.0.1')],en0:[entry('10.2.6.48')]},9555)).toEqual(['http://10.2.6.48:9555']);
 expect(gatewayAddresses({en0:[entry('10.15.11.5')]},9555)).toEqual(['http://10.15.11.5:9555']);
 expect(gatewayAddresses({en0:[entry('10.2.6.48')]},9555)).not.toContain('http://10.15.11.5:9555');
});
