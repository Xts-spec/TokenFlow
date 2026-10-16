import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const steps = [
  { name: '1. 本机 Codex 真实 CLI 与 RPC 握手测试', cmd: 'npx', args: ['tsx', 'scripts/test-real-codex.mjs'] },
  { name: '2. 本机 Desktop Service 与 Native Sidecar 服务测试', cmd: 'npx', args: ['tsx', 'scripts/test-real-desktop-service.mjs'] },
  { name: '3. Windows 无边框标题栏、Snap 与主题融合检查', cmd: 'npx', args: ['electron', 'scripts/windows-window-ui-check.cjs'] },
  { name: '4. 启动窗口、授权卡片与焦点交互检查', cmd: 'npx', args: ['electron', 'scripts/startup-ui-check.cjs'] },
  { name: '5. 账号启动加载与初次轮询检查', cmd: 'npx', args: ['electron', 'scripts/account-startup-ui-check.cjs'] },
  { name: '6. Agent 启动与状态检查', cmd: 'npx', args: ['electron', 'scripts/agent-startup-ui-check.cjs'] },
  { name: '7. 本地网络诊断检查', cmd: 'npx', args: ['electron', 'scripts/network-diagnostics-ui-check.cjs'] },
  { name: '8. 本机原生垃圾清理功能检查', cmd: 'node', args: ['scripts/check-file-cleanup-native.mjs'] },
];

console.log('====================================================');
console.log('       TokenFlow Windows 本机端到端全量真实测试       ');
console.log('====================================================\n');

let allPassed = true;
const results = [];

for (const step of steps) {
  console.log(`>>> 正在执行: ${step.name}`);
  const startTime = Date.now();
  const res = spawnSync(step.cmd, step.args, {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, PATH: `C:\\Program Files\\Go\\bin;${process.env.PATH}` }
  });
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const passed = res.status === 0;
  results.push({ name: step.name, passed, duration });
  if (passed) {
    console.log(`[PASS] ${step.name} (耗时: ${duration}s)\n`);
  } else {
    console.error(`[FAIL] ${step.name} (耗时: ${duration}s, 退出码: ${res.status})\n`);
    allPassed = false;
  }
}

console.log('====================================================');
console.log('                  测试结果汇总                      ');
console.log('====================================================');
for (const r of results) {
  console.log(`${r.passed ? '✓ 通过' : '✗ 失败'} | ${r.duration}s | ${r.name}`);
}

if (!allPassed) {
  process.exit(1);
} else {
  console.log('\n全部 Windows 本机真实端到端测试 100% 通过！');
}
