import { expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { parse, stringify } from 'smol-toml';
import { createDesktopService } from '../packages/core/src/service.js';

// Complete account -> gateway models -> account lifecycle, entirely inside a
// canonical temporary directory. No keychain, real login, or provider request.
it.each(['codex', 'claude'] as const)('%s preserves the original login through account and multi-model switches', async target => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'agent-model-switching-'));
  const allocator = createServer();
  await new Promise<void>(r => allocator.listen(0, '127.0.0.1', r));
  const port = (allocator.address() as { port: number }).port;
  await new Promise<void>(r => allocator.close(() => r()));
  const paths = {
    codex: join(root, 'codex/config.toml'),
    claude: join(root, 'claude/settings.json'),
    workbuddy: join(root, 'workbuddy/models.json'),
    qoder: join(root, 'qoder/settings.json'),
  };
  vi.stubEnv('CLAUDE_SECURESTORAGE_CONFIG_DIR', dirname(paths.claude));
  const authPath = target === 'codex' ? join(root, 'codex/auth.json') : join(root, 'claude/.credentials.json');
  const originalConfig = target === 'codex'
    ? 'model = "original-model"\napproval_policy = "on-request"\n'
    : JSON.stringify({ model: 'original-model', permissions: { defaultMode: 'default' }, env: { TERM: 'fixture' } });
  const jwt = (email: string) => `x.${Buffer.from(JSON.stringify({ email })).toString('base64url')}.x`;
  const originalAuth = target === 'codex'
    ? JSON.stringify({ tokens: { account_id: 'original-account', access_token: 'original-access', refresh_token: 'original-refresh', id_token: jwt('original@example.test') } })
    : JSON.stringify({ claudeAiOauth: { accessToken: 'original-access', refreshToken: 'original-refresh', scopes: ['user:inference'], expiresAt: 4102444800000 } });
  await mkdir(dirname(paths[target]), { recursive: true });
  await writeFile(paths[target], originalConfig);
  await writeFile(authPath, originalAuth);
  if (target === 'claude') await writeFile(join(root, 'claude/.claude.json'), JSON.stringify({ oauthAccount: { emailAddress: 'original@example.test' }, unrelatedPreference: true }));
  await mkdir(join(root, 'cliproxy/auth'), { recursive: true });
  const entries = ['a', 'b'].map(name => ({ name: `${name}.json`, provider: target, email: `${name}@example.test`, status: 'active', models: ['shared', 'exclusive'] }));
  await writeFile(join(root, 'cliproxy/fixture-accounts.json'), JSON.stringify(entries));
  const pool = new Map<string, string>();
  for (const entry of entries) {
    const raw = JSON.stringify({ type: target, email: entry.email, account_id: `account-${entry.name}`, access_token: `fixture-access-${entry.name}`, refresh_token: `fixture-refresh-${entry.name}`, id_token: jwt(entry.email), expired: '2100-01-01T00:00:00Z' });
    pool.set(entry.name, raw);
    await writeFile(join(root, 'cliproxy/auth', entry.name), raw);
  }
  let running = false;
  const options = { root, proxyPort: port, binary: resolve('tests/fixtures/fake-cliproxy.mjs'), token: 'fixture-admin', localKey: 'fixture-internal', secrets: { get: async () => '', set: async () => {} }, agentPaths: paths, agentProcesses: async () => [], nativeProcesses: async () => running ? [1234] : [], claudeCredentialStore: null };
  let service: Awaited<ReturnType<typeof createDesktopService>> | undefined;
  const headers = { host: '127.0.0.1:9527', authorization: 'Bearer fixture-admin' };
  const nativeURL = target === 'codex' ? '/api/codex-accounts' : '/api/native-accounts/claude';
  try {
    service = await createDesktopService(options);
    await service.proxy.start();
    const sources = entries.map(entry => service!.proxy.snapshot().accounts.find(a => a.label === entry.email)!);
    const nativeStatus = async () => (await service!.app.inject({ url: nativeURL, headers })).json();
    const currentTarget = async () => (await service!.app.inject({ url: '/api/a2a', headers })).json().targets.find((t: { id: string }) => t.id === target);
    const switchAccount = async (index: number) => {
      const latest = await nativeStatus();
      const response = await service!.app.inject({ method: 'POST', url: `${nativeURL}/switch`, headers, payload: { revision: latest.revision, sourceId: sources[index].id, model: `${target}/shared` } });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.body).not.toMatch(/fixture-access|fixture-refresh|original-access|original-refresh/);
      expect(response.json()).toMatchObject({ email: entries[index].email, gatewayConnected: false });
    };
    await switchAccount(0);
    await switchAccount(1);
    const nativeBeforeGateway = await readFile(paths[target], 'utf8');
    const selections = [{ sourceId: sources[0].id, model: `${target}/shared` }, { sourceId: sources[1].id, model: `${target}/exclusive` }];
    const latest = await currentTarget();
    const connected = await service.app.inject({ method: 'POST', url: '/api/a2a/connect', headers, payload: { target, revision: latest.revision, ...selections[0], selections } });
    expect(connected.statusCode, connected.body).toBe(200);
    const configText = await readFile(paths[target], 'utf8');
    const config = target === 'codex' ? parse(configText) : JSON.parse(configText);
    const key = target === 'codex' ? (config.model_providers as any).token_flow.experimental_bearer_token : config.env.ANTHROPIC_AUTH_TOKEN;
    const gatewayHeaders = { host: headers.host, authorization: `Bearer ${key}` };
    const route = target === 'codex' ? '/v1/responses' : '/v1/messages';
    const invoke = (model: string) => service!.app.inject({ method: 'POST', url: route, headers: gatewayHeaders, payload: target === 'codex' ? { model, input: 'fixture request' } : { model, max_tokens: 10, messages: [{ role: 'user', content: 'fixture request' }] } });
    for (const selection of selections) expect((await invoke(selection.model)).statusCode).toBe(200);
    expect((await invoke(`${target}/not-selected`)).statusCode).toBe(403);
    // Account B also offers shared, but must never replace its selected account A.
    await service.proxy.setAccountEnabled(sources[0].id, false);
    expect((await invoke(selections[0].model)).statusCode).toBe(503);
    expect((await invoke(selections[1].model)).statusCode).toBe(200);
    await service.proxy.setAccountEnabled(sources[0].id, true);
    // An authorized choice made in the Agent itself remains valid for restoration.
    config.model = selections[1].model;
    await writeFile(paths[target], target === 'codex' ? stringify(config) : JSON.stringify(config));
    expect((await currentTarget()).configurationState).toBe('configured');
    await service.app.close();
    service = await createDesktopService(options);
    await service.proxy.start();
    expect((await nativeStatus()).gatewayConnected).toBe(true);
    for (const selection of selections) expect((await invoke(selection.model)).statusCode).toBe(200);
    if (target === 'codex') {
      const status = await nativeStatus();
      const invalid = await service.app.inject({ method: 'POST', url: `${nativeURL}/switch`, headers, payload: { revision: status.revision, sourceId: sources[0].id, model: 'codex/not-available' } });
      expect(invalid.statusCode).toBe(409);
      expect((await currentTarget()).connection.id).toBe(connected.json().id);
    } else {
      // The UI checks a running Claude before releasing the gateway.
      running = true;
      expect((await nativeStatus()).pids).toEqual([1234]);
      expect((await currentTarget()).connection.id).toBe(connected.json().id);
      running = false;
      const current = await currentTarget();
      const restored = await service.app.inject({ method: 'POST', url: '/api/a2a/restore', headers, payload: { id: current.connection.id, revision: current.revision, allowRunning: true } });
      expect(restored.statusCode, restored.body).toBe(200);
      const native=JSON.parse(nativeBeforeGateway);delete native.model;expect(JSON.parse(await readFile(paths[target], 'utf8'))).toEqual(native);
    }
    await switchAccount(0);
    expect((await currentTarget()).connection).toBeNull();
    expect((await invoke(selections[0].model)).statusCode).toBe(401);
    expect((await service.app.inject({ url: '/api/gateway-keys', headers })).json().keys).toHaveLength(0);
    const status = await nativeStatus();
    const restored = await service.app.inject({ method: 'POST', url: `${nativeURL}/restore`, headers, payload: { revision: status.revision } });
    expect(restored.statusCode, restored.body).toBe(200);
    expect(restored.json()).toMatchObject({ email: 'original@example.test', backup: null, gatewayConnected: false });
    if (target === 'codex') {
      expect(parse(await readFile(paths[target], 'utf8'))).toEqual(parse(originalConfig));
      expect(await readFile(authPath, 'utf8')).toBe(originalAuth);
    } else {
      expect(JSON.parse(await readFile(paths[target], 'utf8'))).toEqual(JSON.parse(originalConfig));
      expect(JSON.parse(await readFile(authPath, 'utf8'))).toEqual(JSON.parse(originalAuth));
      expect(JSON.parse(await readFile(join(root, 'claude/.claude.json'), 'utf8'))).toEqual({ oauthAccount: { emailAddress: 'original@example.test' }, unrelatedPreference: true });
    }
    for (const [name, raw] of pool) expect(await readFile(join(root, 'cliproxy/auth', name), 'utf8')).toBe(raw);
  } finally {
    await service?.app.close();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
