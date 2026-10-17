> 历史记录：保留当时的结论与验证范围；当前待办以 [TODO](../../TODO.md) 为准，产品行为以当前源码和 [使用指南](../../guides/usage.md) 为准。

# 2026-10-15 修复进度与验收记录

结论：已经定位的网关缺陷已修复；本次新增修复 Qoder 重接冲突与 macOS 重启身份识别。追加长对话压测已复现并修复 SDK 轮数误报、工具完成后继续推理和取消启动竞态；首轮思考停滞也已用海外 Flash 再次复现并补齐有界恢复，见 10.15.26.6 追加记录。上游额度限制与缺失原始文件的一段 Codex 历史仍保留为未完成项，不能概括为“所有 502 都解决”。

## 来源调用与旧对话

| 项目 | 变更和证据 | 状态 |
| --- | --- | --- |
| Qoder 模型计费 | 保留顶层 `model_config.key`，与请求头和上下文模型一致；不再添加多余的 `business.model_key` | 已修复 |
| Qoder EOF | 历史日志表明错误发生在收到响应头前；故障注入复现后，增加同来源、最多一次、可取消的重试；已开始输出的流不重放 | 修复已验证；真实上游 EOF 本轮未复现 |
| Qoder 长对话并发 | 16 并发、100 轮历史工具、3 轮实际工具请求，48/48 通过 | 真实来源压测通过 |
| WorkBuddy SDK 崩溃 | 真正复现关闭 transport 后的 MCP 回调抛出 `Transport not started`；仅丢弃该已关闭 transport 的控制回复 | 已修复 |
| WorkBuddy 工具轮数 | thrown `error_max_turns` 中已有的合法待执行工具不再丢失 | 已修复，回归通过 |
| WorkBuddy 静默超时 | 取消时主动关闭本次 transport 并清理自身 CLI，不再等下个事件才能退出 | 8 并发真实 SDK 取消全部结束，最长 264ms；包内取消 509ms |
| WorkBuddy HY4 | 12 并发、80 轮历史工具、4 轮实际工具请求，48/48；另一次 4 并发共 12/12 | 真实来源压测通过 |
| WorkBuddy 额度未知 | 空资源包/缺失数据不再解释为无限制（FIX-003） | 已修复，额度解析回归通过 |
| Codex 来回切换 | 移除供应商前恢复持久化路由；包含网关子任务，修复分页字节偏移与派生索引 | 真实 Codex 隔离测试：3 轮切换、模型增删、3 个新项目、5 段历史继续 |
| Codex 指定旧对话 | 清理来源条目 ID，custom tool call 使用 `ctc_`；保留 `call_id` 和子智能体上下文 | 本机修复 50 个历史文件；用户指定目标实际 resume 成功、外来 ID 为 0 |

压测通过按完整协议结果及工具调用统计，不仅检查 HTTP 200。

本机证据（均位于忽略提交的 `artifacts/`）：`qoder-final-stress.json`、`workbuddy-hy4-final-stress.json`、`workbuddy-hy4-second-stress.json`、`502-migration-verification.json`、`codex-history-id-verification.json`、`local-codex-history-repair.json`、`codex-repeat-switch-verification.log`。

## 本轮 Qoder 重接与重启

### 已复现的原因

1. 无接入记录但设置里有 `providers.token-flow` 时，原代码主动拒绝，随后统一转换成“配置格式无法安全解析”。输入实际上是合法 JSON。此场景可由复制配置或删除旧接入记录后遗留供应商触发。
2. 有接入记录、用户在 Qoder 中改过 TokenFlow 的 API Key / 模型时，切换先执行严格还原，触发“接入字段存在外部修改”。
3. macOS 重启固定匹配目录名而按 bundle ID 退出，检测与操作身份不一致；独立 ChatGPT 与旧名称 Codex 共存的模拟场景复现“尚未退出”。改名目录也不能正确确认启动。

`artifacts/qoder-reconnect-before.log` 和 `agent-restart-before.log` 保存修复前失败。没有获取另一台设备的原始设置；以上是对相同错误路径的确定性复现，不推断那台设备一定只有这些原因。

### 当前行为

- 普通“启动/应用模型”即可覆盖 TokenFlow 自己的供应商字段，无需先删除记录或进入维修审批。首次覆盖保存原始完整字节；重复接入另外保存本次写入前的完整字节。
- 保留其他供应商、工具、权限和偏好；还原时保留接入后的无关修改。损坏 JSON、旧 revision、写入期间的并发修改仍不覆盖。
- macOS 检测 `CFBundleIdentifier` 和 `CFBundleExecutable`，退出、重新打开使用同一实际应用路径；短暂 LaunchServices 失败仍最多重试三次。
- 两个不同安装路径的同一应用同时运行时，不猜测应该关闭哪一个。普通重启没有新增强制结束进程行为。

### 验证范围

| 环境/场景 | 方法 | 结果 |
| --- | --- | --- |
| macOS ARM64 Qoder 0.3.4 | 已安装客户端实际退出、重新打开和进程确认 | 通过，`qoder-034-restart-live.log` |
| macOS ARM64 Qoder 0.4.8 | 官方 zip 下载并核对 SHA-256；独立目录、独立 HOME/配置/用户资料；实际退出、重开 | 通过，`qoder-048-restart-live.json` |
| macOS ARM64 WorkBuddy 5.8.2 | 已安装客户端实际退出、重开 | 通过，`workbuddy-582-restart-live.log` |
| 旧名称 Codex 与独立 ChatGPT 并存 | 模拟进程 + 真实身份匹配代码 | 通过，未重启当前 Codex 聊天 |
| 改名/中文/用户目录、IDE 与 helper 并存、两个版本同时运行 | 进程与应用身份 fixture | 通过 |
| Qoder 手动 API、孤立供应商、模型新增删除、多次切换、还原 | 临时配置和真实 `AgentConnections` | 通过，完整 preimage 保留 |
| Windows 各目标、安装根目录、运行路径、开始菜单、托盘无法退出 | 模拟系统命令回归 | 通过；没有 Windows 实机验收 |

0.4.8 使用官方更新源 `https://download.qoder.com.cn/qoder-app/releases/latest-mac.yml`，包 SHA-256 为 `e388a9831ac5a77af9ba6a2ad5cb3b5c11065c7f06a1fd18c11714b2525aeeda`。实际生成的设置仍为 JSON，bundle ID 为 `com.qoder.app`、主程序为 `Qoder`。隔离资料没有登录账号，因此本轮不声称完成 0.4.8 界面添加 API 后的真实模型生成；配置覆盖由回归测试验证。重启探针只在 launch 时附加隔离环境，不改应用识别和退出逻辑。

复查命令：

```sh
npx vitest run tests/agent-connections.test.ts tests/agent-lifecycle.test.ts tests/agent-installation.test.ts tests/agent-processes.test.ts tests/a2a-service.test.ts tests/quota.test.ts
npm run typecheck
npm run build
```

## 尚未关闭的事项

- 已复现 `error_during_execution` 的具体路径：SDK 将 `Max turns (1) exceeded` 放进此 subtype；现已修复。历史 54.5 秒那次没有保存错误正文，不能追认一定是相同原因。此后首轮 thinking 停滞已用海外 Flash 再现，证实该次不是 SDK 重试循环；20 分钟 SDK 空闲门槛与 4 分钟网关时限不匹配，使其无法自行恢复。10.15.26.6 增加无输出时最多一次的同来源恢复，真实故障注入已验证。上游内部为何停流仍无服务端证据，不等同于网关恢复缺口未修复。
- GLM/Kimi 真实账户额度触发 429；不轮换账号绕过、不误算成配置修复失败。
- 一段“请只回复：OK”的历史原文件和备份均缺失，未伪造原始历史或删除记录。
- FIX-001 并发恢复问题本轮未重新验收；Windows/Intel 与其他版本仍需实机证据。Codex 迁移主动停止使用的 `agentProcesses` 与本轮普通重启不是同一流程，尚需统一身份匹配。
- 未提供另一台设备原始配置，不能证明那台设备已现场恢复；新版覆盖规则应先应用到实际设备再确认。

## 本机交付

- 修复包构建号：**10.15.26.4**；106 项相关回归、类型检查、生产构建通过。
- 安装包内容复查确认 Qoder 自动覆盖和真实应用身份识别代码存在，旧供应商拒绝分支已移除；包内 WorkBuddy SDK 成功加载。
- `/Applications/TokenFlow.app` 与 `release/mac-arm64/TokenFlow.app` 均已替换，旧包保留在 `artifacts/app-backups/`。本轮发现运行的是开发版 Electron，正常退出后已启动 Applications 下的修复版。
- 修复版 HTTP 返回 200；从实际安装版界面执行 Qoder 重启成功，仍显示接入已启用。
- Qoder 0.4.8 临时应用与资料目录已清理，本机原有 Qoder 0.3.4 已恢复打开。
- 汇总证据：`artifacts/agent-repair-verification.json`、`agent-repair-package-check.json`、`agent-repair-regressions.log`。


## 追加 SDK 异常与超时复现（10.15.26.5）

### 确认并修复的根因

1. **轮数误报**：24 并发、100 轮历史、最多 4 轮新工具调用中，复现 3 次 `error_during_execution`，正文均为 `Max turns (1) exceeded`。旧实现只识别 `error_max_turns`，丢弃已产生的工具提议。新增窄匹配兜底；混合其他错误仍失败。
2. **工具完成后的多余推理**：修复前三次 240 秒超时，分别早在约 26 / 11 / 61 秒产生工具提议，但 SDK 继续内部推理。改为在完整 `message_stop` 验证全部工具名称、参数、模型和并行规则后交回客户端，关闭当前请求。截断/拒绝/错误流不返回成功；多工具不截断、不重复，真实 usage 不被 SDK 合成的零值覆盖。
3. **取消后的进程复活**：真实 SDK 版本发现异步等待之后仍调用 start，导致 8 次已关闭请求重新生成 CLI，取消等待 13–17 秒。新增预取消检查和单请求 start 守卫，修复后 16/16 取消通过，最长 258ms，无复活子进程。

### 本轮证据

| 检查 | 结果 | 文件（artifacts/） |
| --- | --- | --- |
| 修复前真实大陆 HY4，24 并发 × 100 历史 × 最多 4 轮 | 84 次请求，74 完成；3 轮数误报、3 超时、3 额度限制、1 工具输出未满足要求 | `workbuddy-repro-100x24.json` |
| 修复后真实国际 HY4，同样压力参数 | 92 次请求，84 完成且均经过新工具交接；7 额度耗尽；1 首轮 thinking 超时 | `workbuddy-handoff-100x24.json` |
| 真实 SDK + 合成 CLI 长对话回放 | 96/96，全部子进程退出，工具轮结束后无需等后续事件 | `workbuddy-tool-handoff-probe.json` |
| 真实 SDK + thinking 静默故障回放 | 24 个请求超时取消，随后 96 次工具请求通过；120/120 检查，子进程全部退出 | `workbuddy-thinking-timeout-recovery.json` |
| 启动时取消（0 / 1 / 50 / 250ms，各 4 路） | 修复前 8 次关闭后启动；修复后 16/16，通过且最长 258ms | `workbuddy-startup-cancel-before.json`、`workbuddy-startup-cancel-after.json` |
| 定向回归 / 类型检查 | 70/70 / 通过 | `workbuddy-timeout-fix-regressions.log`、`workbuddy-timeout-fix-typecheck.log` |

真实来源两轮使用显式固定的不同地区账户，不作严格 A/B 延迟比较，也没有在单次请求中轮换账号。一次剩余超时在约 28 秒出现首轮 thinking block，未收到完整工具响应；未记录 thinking delta 时间，不能断言此后完全静默。额度错误不会伪装成成功，探针已补充英文 Credits exhausted 的停止识别。

以上结果缩小并修复了可复现的实际失败路径，不表示全部 SDK/上游故障已经消失。

### 10.15.26.5 交付

- 生产构建通过；包内 runtime 与源码逐字一致。包内真实 SDK + 合成 CLI 再跑 24 个超时取消及后续 96 次工具请求，120/120 检查通过；16 路启动取消通过，最长 258ms。均无遗留子进程。
- `/Applications/TokenFlow.app` 与 `release/mac-arm64/TokenFlow.app` 已替换为 10.15.26.5。旧应用保存在 `artifacts/app-backups/workbuddy-timeout-20261015-193209/`。
- 解锁后已从菜单正常退出开发版 Electron，启动 `/Applications/TokenFlow.app`；确认运行路径、构建号 10.15.26.5、HTTP 200，界面正常加载 WorkBuddy 账号、额度和模型。安装版启动验收通过。
- 新安装包：`release/TokenFlow-10.15.26.5-mac-arm64.zip`。证据汇总：`artifacts/workbuddy-timeout-fix-verification.json`；包内回放：`workbuddy-packaged-timeout-recovery.json`、`workbuddy-packaged-startup-cancel.json`。


## 首轮思考超时继续定位（10.15.26.6）

### 证据与修复

- 海外 Flash，24 并发、100 轮历史、最多 4 轮工具：修复前 93 次请求，92 完成、1 超时。失败请求仅发起一次模型 HTTP 调用，约 25 秒收到响应，124 个 thinking delta 在 27.476 秒停止；直到 240 秒取消，没有模型重试和完整响应。30 秒后的 CLI 事件循环阻塞最高仅 97ms。证据排除了这次故障由 SDK 重试循环或本机并发事件阻塞造成。
- SDK 0.3.276 默认流空闲超时为 20 分钟，超过网关 4 分钟总时限。新增 60 秒“模型无进展”检测：非空模型增量才续期，持续思考不会被当作空闲，CLI 心跳不能掩盖停滞。
- 首轮仅有内部思考、尚未输出正文或任何工具提议时，清理旧 CLI 后，用同一账号、模型和原始历史最多重试一次。正文、工具块、用户取消及真实上游错误均不重放；总预算仍为原来的 240 秒。两次都停滞则明确返回超时。
- 这修复了可复现的网关恢复缺口；没有伪称掌握上游服务内部停流原因。

### 验证

| 场景 | 结果 | artifacts/ 证据 |
| --- | --- | --- |
| 自然复现与阶段分析 | 92/93；同类首轮停滞，非重试循环 | `workbuddy-flash-100x24.json`、`workbuddy-first-turn-root-cause.json` |
| 修复后同模型、同账号、同压力，两轮 | 96/96 + 96/96，共 192/192 完成 | `workbuddy-flash-recovered-100x24.json`、`workbuddy-flash-recovered-repeat.json` |
| 真实 SDK、24 路先停滞再恢复、4 轮工具 | 96/96，24 路各恢复一次；120 个子进程全部退出 | `workbuddy-idle-recovery-sdk.json` |
| 真实上游连接故障注入 | 第一条流在测试中停住；60 秒空闲后重试实际 Flash，76.6 秒成功，下一工具轮也成功（2/2） | `workbuddy-flash-live-idle-recovery.json` |
| 回归与类型检查 | 78/78，通过 | `workbuddy-first-turn-regressions.log`、`workbuddy-first-turn-typecheck.log` |

海外账户返回的 23 个模型中没有 `step-5-preview`，没有将它冒充为已测试。日志仅保留阶段、计数和耗时；不保存思考内容或凭据。源码中的故障注入仅供显式隔离探针使用，生产应用不加载它。

补充：重复压测在其他请求中确实捕获了收到响应头之前的 `ECONNRESET` 及 SDK 有界重试，这些请求均完成。它们与首轮思考后停滞、没有重试的失败请求是不同路径，不能混为一个原因。


### 10.15.26.6 本机交付

- 已正常退出旧版，替换 `/Applications/TokenFlow.app` 和 `release/mac-arm64/TokenFlow.app`，并启动 Applications 下的新安装版。构建号 10.15.26.6、HTTP 200、WorkBuddy 账号/模型/额度界面加载均已确认。
- 旧包备份：`artifacts/app-backups/workbuddy-first-turn-20261015-200502/`。
- 包内 runtime 与源码一致，超时映射存在于生产构建。包内 24 路首轮停滞恢复后 96/96 工具请求通过、120 个子进程全部退出；16 路启动取消亦通过。
- 安装包：`release/TokenFlow-10.15.26.6-mac-arm64.zip`。完整证据索引：`artifacts/workbuddy-first-turn-verification.json`。


## Antigravity 500 与全部账号目录继续修复

原始生产 500 已定位为上游响应头前 EOF，真实 executor 故障回放复现，加入一次同请求重连。24 并发 × 100 轮历史 × 4 轮工具：自然压测 96/96；每条请求主动注入首次 EOF 后 96/96 恢复。已取消授权来源静态旧模型兜底，目录失败状态、15 分钟过期、Cursor 自动更新、WorkBuddy 空允许列表、xAI OAuth 目录端点均有回归覆盖。详见 [验收报告与各来源限制](antigravity-500-repair-2026-10-15.md)。

## 2026-10-16 追加

海外 WorkBuddy 目录 500 与 SDK 早期配置来源已修复；TRAE DeepSeek 上游文本截断现已通过正式接口、动态签名和关闭上游增量生成修复。安装版 16 并发长历史多轮工具 80/80、Responses 4/4 通过；Codex CLI 0.154.0 实机约 6.6 万字符、3 轮、9 次工具及两次退出续接全部通过，当前关闭未支持的服务端网页搜索。真实额度与账号展示已安装验收。旧豆包/MarsCode 映射按用户要求撤销，保留独立 TRAE。提交用进度见 [TRAE 修复报告](trae-repair-2026-10-16.md)，全部来源对照见 [跟进报告](model-catalog-followup-2026-10-16.md)。
