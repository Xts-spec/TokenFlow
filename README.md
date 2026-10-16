<div align="center">
  <img src="apps/console/public/logo.svg" width="64" alt="TokenFlow" />
  <h1>TokenFlow</h1>
  <p><strong>让你的模型，流向每个 Agent。</strong></p>
</div>

TokenFlow 是本地桌面模型网关：集中管理 GPT/Codex 等平台的多个账号与独立 API，查看来源模型和额度，再把 WorkBuddy、Qoder 等账号可用的模型接入 Codex、Claude Code 等开发工具。

既可以切换 Agent 自己的官方登录，也可以通过本地网关反代所选来源。你继续在熟悉的客户端工作，TokenFlow 管理模型选择、配置备份、独立 Key、协议转换和用量记录。

**[访问官网](https://token-flow.haruinia.chatgpt.site/)** · **[观看中文使用演示](doc/media/quickstart.mp4)** · **[查看使用指南](doc/guides/usage.md)**

视频演示多账号授权与切换、重启后加载配置、WorkBuddy / Qoder 额度查看与反代接入、独立 Key 请求和用量核对。账号、额度及上游响应使用隔离模拟数据；模拟客户端加载配置并调用真实本机网关，不代表真实厂商或客户端的完整验证。

## 项目文档

所有项目说明集中在 [doc/ 文档目录](doc/README.md)：[架构](doc/architecture.md)、[当前待办](doc/TODO.md)、[用量来源与本地验证](doc/testing/usage-attribution.md)、[Windows 功能验收](doc/待修复的问题win兼容.md)。历史报告与原始证据分别归档，不作为当前功能承诺。

<a id="三个常用场景"></a>

## 常用场景

### GPT / Codex 多账号登录

在 **账号授权 → Codex** 分别添加 ChatGPT / OpenAI 账号，按账号查看模型、5 小时 / 周等可查询额度。在 **本地 Agent → Codex → 官方登录账号** 选择账号，保存工作并完全退出重开 Codex，加载新的登录状态。

切换官方账号会恢复接入前的接口；官方直连的逐次请求不经过 TokenFlow。此功能切换 Codex 的登录，不修改 ChatGPT 网页的浏览器登录。

### WorkBuddy / Qoder 官方账号切换

在 **账号授权 → WorkBuddy / Qoder IDE → 登录此账号**，或 **本地 Agent → WorkBuddy / Qoder → 官方登录账号** 切换。这里的 Qoder 目标是独立桌面版。两处共用账号状态、确认弹窗和“恢复切换前登录”；先校验官方身份，正常退出客户端，备份并写入登录后重新打开。官方登录与自定义模型分别保留，导入网关模型不取消官方身份选中，切换或恢复官方账号也不自动移除自定义模型。区别于 Codex 的当前 provider 切换，见 [共存规则](doc/testing/official-login-coexist.md)。

macOS / Windows 自动识别各自的登录目录。WorkBuddy 支持国内域名别名，并按用户和企业身份匹配；国内桌面版缺少海外登录配置，海外账号暂不自动写入。旧格式登录由官方客户端启动时迁移加密；Qoder 通过独立 Electron 进程使用官方应用的系统加密身份，首次使用可能出现钥匙串访问提示。原登录文件及退出标记保存在 TokenFlow 的系统加密存储中，连续切换仍保留第一次切换前的原件。客户端刷新令牌后可以恢复；客户端已换成其他账号时拒绝覆盖。Linux 暂不启用自动切换，并显示原因。

适配依据：WorkBuddy 5.8.2 与 Qoder 独立桌面版 0.3.4 的会话格式。无完整刷新凭据、身份不匹配、文件锁冲突、无法确认进程身份或退出未完成时停止操作。启动未确认时明确提示登录是否已经保存，并保留恢复入口。Windows 进程策略有模拟覆盖，仍需实机测试。

### WorkBuddy、Qoder 等来源额度反代

在 **账号授权** 添加来源账号，或从支持的本机登录导入，刷新模型和额度。然后在 **本地 Agent** 选择目标客户端，展开 WorkBuddy / Qoder 来源卡片，勾选模型并应用；重启目标 Agent 后选用对应模型。

例如让 Codex 使用 WorkBuddy 来源的模型，或让 Claude Code 使用 Qoder 来源的模型。调用消耗所选来源账号自己的额度；网关不会把套餐点数换算成额外额度，也不会放宽官方权限或限制。可用组合以账号、模型及客户端实测为准。

### 其他应用通过 Key 接入

在 **API 代理** 创建独立 Key，只授权需要的来源和模型，将地址、Key、精确模型 ID 填入目标应用。可以跨来源多选、修改已有 Key 的模型权限、停用或撤销。新增来源不会自动扩大旧 Key 权限。

## 核心能力与优化

| 能力 | 当前行为 |
| --- | --- |
| 多账号、多平台 | 账号标签、平台独立刷新、模型与额度详情；支持来源的本机授权导入，以及 Codex / Claude / Antigravity 原生登录切换。 |
| 多 API 来源 | 多个入口分别保存密钥和模型；多模型输入、自动识别三种协议；只改名称无需再次调用模型。 |
| 模型选择 | 按来源显示共享额度，搜索账号 / 模型、最近使用、跨来源多选、管理 Agent 模型菜单与默认模型。 |
| 统一接口 | Responses、Chat Completions、Anthropic Messages；来源固定，同名模型按来源区分。 |
| 安全接入 | 上游 Key 与客户端 Key 分开，密钥加密存储和显式显示，写前备份、配置冲突检查、原接口恢复。 |
| 连续会话 | 历史续接和上下文压缩，受管 Codex 本机历史恢复、官方切回迁移、子智能体默认模型继承。 |
| 来源兼容 | Chat 长工具名映射、Claude 模型别名识别、WorkBuddy 固定身份介绍兼容，保留任务、工具及权限。 |
| 维修与反馈 | 常驻维修对话，配置修改先预览再确认；读取可取消、写超时不自动重试、真实上游错误分类。 |
| 用量 | 来源额度、模型 / Key tokens、当前运行请求状态与配置切换记录分别展示，不将未知用量当作成功。 |

来源适配包含 Codex、Claude、Antigravity、Kimi、xAI、Qoder IDE、WorkBuddy、ZCode、Trae 和独立 Cursor SDK。自动配置目标为 Codex、Claude Code、WorkBuddy、Qoder 独立应用；**Qoder IDE 的来源授权与 Qoder 独立应用的目标配置是两个入口**。Cursor 等兼容客户端通过导出 Key 手动接入，Cursor 此类入口需要外网可访问的 HTTPS 地址，应用不自动发布公网服务。

模型响应交回目标 Agent 执行工具，文件、Shell、MCP、审批与沙箱仍由目标客户端控制。文本验证、模型目录、额度查询和实际客户端调用是不同证据；工具、图片、Auto Mode 等能力需分别验证。独立诊断和升级适配器仍有后端实现，当前简化界面未提供完整入口，不作为直接可点击功能介绍。

维护结论与原始验证范围见 [历史报告目录](doc/README.md#历史报告与证据)，当前未完成事项统一记录在 [TODO](doc/TODO.md)。

## 从源码运行

需要 Node.js **22.19+**、npm、Git 和编译 sidecar 的 Go **1.26+**。

```bash
git clone https://github.com/haruinia/TokenFlow.git
cd TokenFlow
npm ci
node scripts/fetch-upstream.mjs
npm run sidecar:build
npm run dev
```

上游版本固定，补丁冲突时停止并保留本地改动。桌面界面使用 Electron，无需安装独立浏览器或浏览器自动化组件。

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 类型检查、自动化测试、生产构建。 |
| `npm run test:sidecar-agents` | 来源执行器和协议转换验证。 |
| `npm run package` | 本地桌面目录包，不自动发布安装包。 |

自动化回归覆盖网关、账号、Agent 配置、维修和用量逻辑；桌面界面交互需启动应用检查。真实账号 / 厂商调用、目标客户端任务、真实升级和跨系统安装包需要另行验证。

Windows 自动重启会核对可执行文件路径、Electron 应用标识和进程启动时间，不按程序名批量结束进程。Qoder IDE 等已识别的其他应用不会被关闭；身份不明、多实例或运行中的独立 CLI 会要求手动处理。仅请求正常退出，托盘驻留或保存提示未处理时停止重启；Codex 在确认退出后才切换配置。重新启动使用同一安装位置，商店版 Codex 使用安装包清单中的入口。该流程有模拟测试覆盖，仍需 Windows 实机验收。

## 本地空间与版本保留规则

软件旧版本仅通过 Git 提交、分支或标签保存；需要回溯时从 Git 检出并重新构建。不在项目目录保留旧应用、旧安装包、按日期或修复名称复制的版本目录，也不创建 `release/backups/`、`artifacts/app-backups/` 等软件备份。

- `release/` 仅供当前打包临时使用，交付或安装后删除。所有 `npm run package`、`package:win`、`package:mac:arm64`、`package:mac:intel` 入口和 `node scripts/package-release.mjs` 都会在打包开始前自动清空 `release/`、`artifacts/`、`.tmp/`、`output/`；清理失败即停止打包，不累积旧版本。同一次多平台打包仅清理一次，保留本次各平台产物；分开执行打包命令会清掉上一次的产物。可用 `npm run clean:package` 单独清理。
- `artifacts/`、`.tmp/`、`output/` 是临时诊断、测试和导出目录，任务结束后清理；需要长期保留的结论整理到文档中。
- 保留源码、未提交改动、`.git/`、当前开发依赖及运行所需资源。清理旧版本不删除账号、密钥、会话和应用运行数据；客户端配置恢复所需备份按原有机制管理。
- Git 只能恢复已提交的内容。清理前检查目标目录没有需要保留的源码或未归档成果；不通过复制整个应用或工程目录来保存版本。

2026-10-15 已清理本地 `release/`、`artifacts/`、`.tmp/`、`output/` 的旧构建、应用备份与临时输出。

## 数据与许可

桌面资料保存在系统应用数据目录，可用 `AGENT_DATA_ROOT` 指定独立目录。授权文件、密钥、会话、配置备份、日志与安装包不提交 Git；API 来源和可持久保存的客户端 Key 使用桌面加密存储，headless 不接受新增 API 密钥的持久保存。模型请求仍发送到所选来源服务。配置备份不等同于软件回滚。

源码结构：`apps/console` 界面，`apps/desktop` 桌面应用，`packages/core` 网关 / 授权 / 接入，`patches/cliproxy` 来源补丁，`tests` 验证。

[MIT 许可](LICENSE) · [第三方复用](THIRD_PARTY.md) · [问题反馈](https://github.com/haruinia/TokenFlow/issues)
