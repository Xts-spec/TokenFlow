# 产品收敛 P0

依据：仓库外的 `token-flow-product-refactor-plan.md` v0.2（2026-09-30）。本轮按其阶段顺序完成 P0，不实施 P1 多 API 来源、P2 系统执行与升级或 P3 连接图。

改造前版本：`backup/pre-product-refactor-20260930-1452` → `900b7d0`。运行数据继续使用原 profile，本轮不迁移数据，不自动改写客户端或登录。

## 功能去向

| 现有能力 | P0 位置与边界 |
| --- | --- |
| A2A 自动接入、切换模型、备份、冲突检查与还原 | 工作台 → 我的 Agent → 自动配置详情 |
| 手动接入、Cursor / OpenAI 兼容配置、网关测试 | 同一工作台 → 手动配置；网关测试不表示客户端调用通过 |
| 账号授权、模型目录与额度 | 模型来源；仍复用已有账号存储 |
| Key 权限、额度、启停 | 连接高级详情入口与设置 → 客户端访问密钥 |
| 原生登录切换 | Agent 详情 → 原生登录；与网关连接分开提示，复用原备份和互斥检查 |
| API 请求与用量 | 活动 → 模型请求；仅本次服务运行，不伪造永久历史 |
| 配置变更、维修 | 活动 → 配置记录 / 维修会话；配置记录来自现有备份，不声称覆盖所有变更 |
| 网关维修 | 全局气泡、右侧抽屉及桌面托盘；复用同一会话和原审批接口 |
| 网关设置、反馈 | 底部设置 |
| 旧任务 Provider / 能力探测、执行历史 | 设置 → 实验功能（明确只供旧运行时使用，不宣称为统一 API 来源） |

## 旧浏览器任务依赖分析

源码目录不是隔离边界，本轮保留下列依赖，产品主导航不展示旧任务。

| 层 | 当前依赖 | 后续拆分需要验证 |
| --- | --- | --- |
| 初始化 | `packages/core/src/service.ts` 构造 `BrowserHost`、`ExtensionRelay`、`RunControl`、`RunnerManager` | `createServer` 需要 manager，`idle()` 防止任务中修改设置；拆分需调整服务契约及 tests/service、runtime、extension |
| 执行 | `launchJavaScriptSession`、`runResponsesCodeLoop`、`providers.ts`、桌面权限模块 | 保留接入维修使用的 Pi Agent、协议适配和客户端配置逻辑；不能按关键词批量删除 |
| 路由 | `/api/browser/*`、`/api/desktop/*`、`/api/control/*`、`/api/runs*`、`/api/history` | runs 还由 `packages/core/src/server.ts` 注册；认证、同源保护和任务互斥属于共享边界 |
| 构建 | `tsup.config.ts` 默认打包 `javascript-worker`；main/headless 都引用同一 service | 后续生产 / 实验入口需要分别构建和测试，而非仅隐藏界面 |
| 发行 | `package.json` 依赖 Playwright，asarUnpack 和 extraResources 复制浏览器依赖与 `extensions/chrome` | 必须验证授权流程是否仍依赖浏览器，以及 desktop/headless 发行测试 |
| 授权与共享能力 | `cliproxy` 本地授权导入、CLIProxyAPI、Cursor SDK、模型协议与 Key 管理 | 模型来源及维修依赖这些能力，拆分浏览器任务时保留 |
| 未引用组件 | `ScreenshotPane.tsx` 尚无其他源码引用 | 删除候选；本轮未删，避免把截图组件与底层回放能力混为一谈 |

## 验收

- 主导航仅工作台、模型来源、活动；设置在底部；自动和手动接入可达。
- 首页先显示真实 Agent 连接；配置写入、进程检测、网关请求证据分别标注，未知安装不显示已安装。
- 维修关闭和导航切换保持会话及输入；停止使用原 `/api/maintenance/stop`，关闭不发送停止请求。
- 原生登录不绕过网关互斥；Key 不自动重签；备份、并发校验及还原继续使用原接口。
- 完成类型检查、现有测试、生产构建和隔离配置目录中的界面冒烟验证；真实客户端调用及真实账号额度保留手工验证。
