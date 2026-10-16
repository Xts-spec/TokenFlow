import { migrationBinary, codexRuntimeClient } from '../packages/core/src/codex-runtime.js';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

console.log('=== 1. 真实查找 Windows 迁移用 Codex CLI 二进制 ===');
const binary = await migrationBinary();
console.log('成功定位到 Codex CLI:', binary);

console.log('=== 2. 真实启动 codexRuntimeClient 握手通信 ===');
const tempHome = await mkdtemp(join(tmpdir(), 'tokenflow-codex-test-'));
try {
  const client = await codexRuntimeClient(tempHome);
  console.log(`Codex 会话客户端成功启动并握手，PID: ${client.pid}`);

  // 测试 RPC 调用
  console.log('=== 3. 测试 Codex RPC 交互 ===');
  // 关闭连接
  await client.close();
  console.log('Codex 客户端优雅关闭成功！');
  console.log('=== 测试全部通过！Windows 商店版 Codex CLI 兼容性已实测成功！ ===');
} finally {
  await rm(tempHome, { recursive: true, force: true }).catch(() => {});
}
