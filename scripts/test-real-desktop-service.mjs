import { createDesktopService } from '../packages/core/src/service.js';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

console.log('=== 1. 真实初始化 TokenFlow Desktop Service ===');
const root = await mkdtemp(join(tmpdir(), 'tokenflow-service-test-'));
const token = randomBytes(32).toString('hex');
const localKey = randomBytes(32).toString('hex');
const binary = resolve('sidecars/win32-x64/cliproxyapi.exe');

const service = await createDesktopService({
  root,
  token,
  localKey,
  secrets: {
    canEncrypt: () => false,
    warnings: () => [],
    temporaryGateway: () => {},
    get: async () => '',
    set: async () => {},
  },
  binary,
});

try {
  const testPort = Number(process.env.AGENT_TEST_PORT ?? 9528);
  console.log(`=== 2. 真实监听 127.0.0.1:${testPort} ===`);
  const address = await service.app.listen({ host: '127.0.0.1', port: testPort });
  console.log('服务已在本地监听:', address);

  const headers = {
    host: `127.0.0.1:${testPort}`,
    authorization: `Bearer ${token}`,
  };

  console.log('=== 3. 真实测试 API 接口 ===');
  // 1. 设置接口
  const settingsRes = await service.app.inject({ url: '/api/settings', headers });
  console.log('GET /api/settings 状态码:', settingsRes.statusCode);
  if (settingsRes.statusCode !== 200) throw new Error('Settings API failed');

  // 2. 本地代理接口
  const localAgentRes = await service.app.inject({ url: '/api/local-agent', headers });
  console.log('GET /api/local-agent 状态码:', localAgentRes.statusCode);
  if (localAgentRes.statusCode !== 200) throw new Error('Local agent API failed');

  // 3. 模型探测
  const probeRes = await service.app.inject({ method: 'POST', url: '/api/providers/probe', headers });
  console.log('POST /api/providers/probe 状态码:', probeRes.statusCode);

  console.log('=== 4. 测试优雅关闭服务与 Sidecar ===');
  await service.app.close();
  console.log('=== 全部 TokenFlow 本地服务真实接口验证成功！ ===');
} finally {
  await rm(root, { recursive: true, force: true }).catch(() => {});
}
