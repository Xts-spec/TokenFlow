import { readFile, rename, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { networkInterfaces } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { z } from 'zod';
import type { GatewayKeys } from './gateway-keys.js';

/** Compare socket addresses directly; forwarded headers never establish membership. */
export function normalizeGatewayIP(value: string): string | undefined {
  const family = isIP(value);
  if (family === 4) return value;
  if (family !== 6) return;
  // Scoped link-local addresses cannot be represented as an exact portable allowlist entry.
  if (value.includes('%')) return;
  const normalized = new URL(`http://[${value}]`).hostname.slice(1, -1);
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(normalized);
  if (mapped) {
    const high = Number.parseInt(mapped[1], 16), low = Number.parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return normalized;
}

const ipAddress = z.string().trim().refine(value => {
  try { return normalizeGatewayIP(value) !== undefined; } catch { return false; }
}, '请输入完整的 IPv4 或 IPv6 地址').transform(value => normalizeGatewayIP(value)!);

export const gatewayAccessInput = z.object({
  enabled: z.boolean().default(false),
  port: z.number().int().min(1).max(65535).default(9555),
  allowedIPs: z.array(ipAddress).max(256).default([]).transform(values => [...new Set(values)]),
}).strict();

export type GatewayAccessConfig = z.infer<typeof gatewayAccessInput>;
export type GatewayAccessSnapshot = GatewayAccessConfig & {
  running: boolean;
  lastError: string | null;
  addresses: string[];
};

const failure = (message: string, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const bindError = (error: unknown, port: number) => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'EADDRINUSE') return `局域网访问端口 ${port} 已被占用，请选择其他端口。`;
  if (code === 'EACCES') return `无法使用局域网访问端口 ${port}，请选择其他端口。`;
  return `局域网访问启动失败：${error instanceof Error ? error.message : String(error)}`;
};

/** An opt-in model gateway. Only model routes are registered on this app by the service. */
export class GatewayAccess {
  readonly app = Fastify({ logger: false, bodyLimit: 32 * 1024 * 1024, trustProxy: false });
  private config: GatewayAccessConfig = gatewayAccessInput.parse({});
  private lastError: string | null = null;
  private pending: Promise<unknown> = Promise.resolve();
  private closed = false;

  private constructor(private path: string, private gatewayKeys: Pick<GatewayKeys, 'authenticate'>) {
    this.app.setErrorHandler((error, _request, reply) => {
      if (error instanceof z.ZodError) return reply.code(400).send({ error: { message: '请求参数无效', type: 'invalid_request_error' } });
      const requestedStatus = error instanceof Error && 'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
      const status = requestedStatus >= 400 && requestedStatus < 500 ? requestedStatus : 500;
      return reply.code(status).send({ error: { message: status === 500 || !(error instanceof Error) ? '请求处理失败' : error.message, type: status === 500 ? 'server_error' : 'invalid_request_error' } });
    });
    this.app.addHook('onRequest', async (request, reply) => {
      const deny = (message: string, status = 403) => reply.code(status).send({ error: { message, type: 'access_denied' } });
      if (!this.config.enabled) return deny('局域网访问未启用');
      // Browsers send Origin on cross-origin requests, including simple requests.
      if (request.headers.origin !== undefined) return deny('此入口仅供 API 客户端使用');
      const remote = request.raw.socket.remoteAddress;
      const address = remote ? normalizeGatewayIP(remote) : undefined;
      if (!address || (this.config.allowedIPs.length && !this.config.allowedIPs.includes(address))) return deny('此设备未获准访问');

      const authorization = request.headers.authorization;
      const apiKey = request.headers['x-api-key'];
      const bearer = typeof authorization === 'string' ? /^Bearer ([^\s]+)$/i.exec(authorization)?.[1] : undefined;
      if ((authorization !== undefined && !bearer) || (apiKey !== undefined && typeof apiKey !== 'string')) return deny('请提供有效的客户端 Key', 401);
      if (bearer && apiKey !== undefined && bearer !== apiKey) return deny('客户端 Key 不一致', 401);
      const key = this.gatewayKeys.authenticate(bearer ?? (typeof apiKey === 'string' ? apiKey : ''));
      if (!key || key.access !== 'lan' || key.exported !== true) return deny('此客户端 Key 未获准局域网访问', 401);
    });
  }

  static async open(root: string, gatewayKeys: Pick<GatewayKeys, 'authenticate'>): Promise<GatewayAccess> {
    const access = new GatewayAccess(join(root, 'gateway-access.json'), gatewayKeys);
    try {
      access.config = gatewayAccessInput.parse(JSON.parse(await readFile(access.path, 'utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        access.lastError = '局域网访问配置读取失败，已暂停此入口。请检查 gateway-access.json，或重新保存访问设置；已有文件未被重置。';
      }
    }
    return access;
  }

  snapshot(): GatewayAccessSnapshot {
    const running = this.app.server.listening;
    const addresses = running ? [...new Set(Object.values(networkInterfaces()).flatMap(entries => (entries ?? [])
      .filter(entry => entry.family === 'IPv4' && !entry.internal)
      .map(entry => `http://${entry.address}:${this.config.port}`)))].sort() : [];
    return { ...structuredClone(this.config), running, lastError: this.lastError, addresses };
  }

  private mutate<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.pending.then(fn);
    this.pending = task.catch(() => undefined);
    return task;
  }

  private async listen(port: number) {
    await this.app.ready();
    // Node servers can listen again after close; Fastify.close() is reserved for final shutdown.
    await new Promise<void>((resolve, reject) => {
      const server = this.app.server;
      const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
      const onListening = () => { server.off('error', onError); resolve(); };
      server.once('error', onError);
      server.once('listening', onListening);
      try { server.listen({ port, host: '0.0.0.0' }); }
      catch (error) { server.off('error', onError); server.off('listening', onListening); reject(error); }
    });
  }

  private async stopListening() {
    if (!this.app.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      // Let short requests finish, then end long streams so settings and shutdown stay bounded.
      // Destroying the response socket triggers the shared gateway's cancellation/usage settlement.
      const timer = setTimeout(() => this.app.server.closeAllConnections(), 2000);
      timer.unref();
      this.app.server.close(error => {
        clearTimeout(timer);
        error ? reject(error) : resolve();
      });
      this.app.server.closeIdleConnections();
    });
  }

  start(): Promise<GatewayAccessSnapshot> {
    return this.mutate(async () => {
      if (this.closed || !this.config.enabled || this.app.server.listening) return this.snapshot();
      try { await this.listen(this.config.port); this.lastError = null; }
      catch (error) { this.lastError = bindError(error, this.config.port); }
      return this.snapshot();
    });
  }

  update(input: GatewayAccessConfig): Promise<GatewayAccessSnapshot> {
    return this.mutate(async () => {
      if (this.closed) throw failure('局域网访问已关闭');
      const next = gatewayAccessInput.parse(input);
      const previous = this.config;
      const wasRunning = this.app.server.listening;
      const needsRestart = previous.port !== next.port;
      try {
        if (wasRunning && (!next.enabled || needsRestart)) await this.stopListening();
        if (next.enabled && !this.app.server.listening) await this.listen(next.port);
        await writeFile(`${this.path}.tmp`, JSON.stringify(next, null, 2), { mode: 0o600 });
        await rename(`${this.path}.tmp`, this.path);
        this.config = next;
        this.lastError = null;
        return this.snapshot();
      } catch (error) {
        this.lastError = (error as NodeJS.ErrnoException).code?.startsWith('EADDR') || (error as NodeJS.ErrnoException).code === 'EACCES'
          ? bindError(error, next.port) : `局域网访问设置保存失败：${error instanceof Error ? error.message : String(error)}`;
        if (this.app.server.listening && (!wasRunning || needsRestart)) await this.stopListening();
        if (wasRunning && !this.app.server.listening) {
          try { await this.listen(previous.port); }
          catch (rollbackError) { this.lastError += ` 原有入口恢复失败：${bindError(rollbackError, previous.port)}`; }
        }
        throw failure(this.lastError);
      }
    });
  }

  stop(): Promise<GatewayAccessSnapshot> {
    return this.mutate(async () => { await this.stopListening(); return this.snapshot(); });
  }

  close(): Promise<void> {
    return this.mutate(async () => {
      if (this.closed) return;
      this.closed = true;
      await this.stopListening();
      await this.app.close();
    });
  }
}
