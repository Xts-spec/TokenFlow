> 历史记录：保留当时的结论与验证范围；当前待办以 [TODO](../../TODO.md) 为准，产品行为以当前源码和 [使用指南](../../guides/usage.md) 为准。

# 2026-10-16：官方对话目录、WorkBuddy 500 与 Trae 原生协议

## 结论与范围

海外 WorkBuddy 目录 500 已复现并修复，同时修正 SDK 启动阶段的错误来源。Trae 国际版已实现官方动态目录及原生文本/工具协议，Seed 模型完成实测。Trae DeepSeek-V4.1-Flash 的最终文本截断已复现到上游原始 SSE，并通过正式接口、动态签名与上游生成模式修复；具体对照和后续真机验收见本文最后两节。

按用户最后纠正，撤销“豆包等于 MarsCode／TRAE 插件”的产品映射。删除该登录和额度适配，取消自动导入及模型路由；旧管理授权/导入接口返回 410，运行时不注册旧执行器。保留旧授权文件，不迁移成 TRAE，也不继续要求插件登录。TRAE 仍是独立来源。

## WorkBuddy：两个已验证根因

1. 海外账号目录曾请求 `/console/enterprises/{enterprise}/models`，稳定返回 HTTP 500 HTML。官方 CLI 的 CloudProductProvider 实际读取 `/v3/config`。保持账号及请求头不变，仅改路径即返回 200。官方配置有 20 个原始条目，CLI 允许名单为 19 个；不展示辅助条目或 SDK 内置的额外型号。
2. SDK 的 `query.options.endpoint` 在 CloudProductProvider 之后才生效，首次目录仍请求 `www.codebuddy.ai`。改为在子进程启动前设置官方支持的 `ACC_PRODUCT_CONFIG_V3.endpoint`，并清理继承的 `ACC_PRODUCT_*`，使目录和推理均使用账号所属来源。网络探针确认首次配置请求进入 `www.workbuddy.ai/v3/config`，稳定后的 SDK 目录与该账号的 19 个型号一致。

验证：6 并发、每个工作线程 6 次目录刷新，36/36 返回 200 且名单一致；真实 SDK 使用海外 `deepseek-v4.1-flash`，100 轮历史、4 并发、两轮工具交接及最终文本，共 12/12 请求通过。目录发现不等于余额充足，也不保证每个模型永远成功。

## Trae：目录与推理必须使用原生协议

官方来源为 [Trae 下载页](https://www.trae.ai/download)提供的 3.6.2 安装包（仅下载、解包检查，未安装或启动）。包内 AI 扩展的协议版本为 `20260212`，不能使用产品文件中旧的 `traeVersionCode` 代替。

- 当前美国区账号目录：`GET /api/ide/v1/get_detail_param?function=chat_v3&need_prompt=false`，使用 `Cloud-IDE-JWT`、官方应用标识及版本请求头。
- 按 `config_switch`、用户可见性、展示名称和非自带密钥配置筛选，本次有效账号返回 16 个对话型号。保留原始模型 ID 的大小写，读取官方上下文与输出限制。
- 原生推理为 `/api/agent/v3/llm_utils_chat`。必须提交 `config_name`；只提交 `model` 会静默选默认模型。文本消息转换为内容数组，工具参数编码为 JSON 字符串，具名工具选择传工具名，原生 `function_call` 与标准工具格式双向转换。
- SSE 的进度不算文本；要求显式完成事件。业务错误、损坏事件和缺失完成事件的 EOF 不再被当作空回答成功。支持取消与非流式工具聚合。

实测：`Dola-Seed-2.0-Code`（实时展示名 Seed-2.1-Turbo）在 100 轮历史、4 并发、两轮工具及最终回答中 **12/12 通过**。

修复前取证（已由后续章节修复）：`deepseek-v4.1-flash` 的 8/8 工具轮次通过，但 4/4 最终文本只返回标记前缀。直接读取上游原始 HTTP/SSE 同样缺失后缀，随后收到正常结束；不是 TokenFlow SSE 解析时丢字。增加输出上限仅单次成功，随后并发再次失败，因此没有把它写成修复。未静默替换模型、补造内容或按名称拉黑。当前原生端点仅完成美国区有效账号验证；另外两条旧 Trae 授权已过期。

## 其他目录对照

| 来源 | 本次证据与结果 | 限制 |
| --- | --- | --- |
| Antigravity | 同推理端点、项目及官方 `agentModelSorts` 对话名单，两账号各 6 个 | 余额仍独立判断 |
| Codex | 官方按客户端版本与账号权限返回，三账号 3／7／7 个 | 不是所有账号共享同一名单 |
| Qoder | 官方签名目录的 `chat` 场景，三账号各 17 个，受限账号 1 个；若响应明确提供 `cli`，优先采用且空名单不回退 | 实装 CLI `--list-models` 另列 Fast，本次账号远端 chat 名单没有它；不把客户端附加项当作账号授权、不合并 IDE、补全和 BYOK 场景 |
| WorkBuddy | 国内两账号各 18、海外 19；海外与稳定后的官方 SDK 目录一致 | 初始内置列表不代表账号可用 |
| ZCode | 官方客户端配置接口需 ZCode 登录 JWT，再无凭据读取官方 CDN，最后与业务 API 目录取交集；Coding Plan 为 GLM-5.3、GLM-5.3-Flash | 不混入 Start Plan、低峰与独立 API 产品列表；仅测试现有国际账号 |
| xAI | OAuth 对话产品目录，当前 Grok 4.7 | 不混用独立 API 目录 |
| Kimi | 两条现有授权失败 | 未声称完成有效账号实测 |
| Cursor | 既有官方 SDK 动态目录和有界缓存保留 | SDK 产品范围不等同于 IDE 全部订阅模型，本次未做 UI 全量对照 |
| Claude | 无本次可用测试授权 | 未声称完成实时验收 |
| 旧“豆包”适配 | 按用户要求移除错误产品映射 | 不代表已实现真正的豆包产品接入 |

账号及模型约每 30 秒刷新；目录缓存 30 秒，手动刷新强制获取。临时失败最多保留 15 分钟内已确认目录并标记过期，不回退静态旧型号。额度通常五分钟或手动刷新，与目录不同。

## 回归与复现

- `node scripts/test-native-catalog.mjs`：离线 Go 目录、原生 SSE、工具与取消回归。
- `TOKEN_FLOW_CATALOG_AUTH_DIR=/path/to/auth TOKEN_FLOW_CATALOG_REPORT=/path/to/report.json node scripts/test-official-catalog.mjs`：显式启用真实目录检查，不推理。
- `TOKEN_FLOW_TRAE_LIVE_AUTH_DIR=/path/to/auth TOKEN_FLOW_TRAE_MODEL=Dola-Seed-2.0-Code TOKEN_FLOW_TRAE_REPORT=/path/to/report.json node scripts/test-native-catalog.mjs`：真实 Trae 100 轮历史、4 并发、两轮工具和最终文本；会使用该账号额度。改为 DeepSeek 模型可复现上述截断。
- TypeScript 相关七组测试 107/107 通过，类型检查与桌面构建通过。Go 目录与原生协议回归通过，包括 ZCode 凭据隔离、Qoder 空 CLI 名单及停用旧豆包后不发上游请求。
- 脱敏结果：[目录与压力验证数据](../evidence/catalog-followup-2026-10-16)。只保留型号、耗时、合成测试标记与结论，不保存登录令牌或用户对话。

## 安装验收

已替换 `/Applications/TokenFlow.app` 和当前 `release/mac-arm64/TokenFlow.app`，更新 `release/TokenFlow-10.15.26.6-mac-arm64.zip`。签名完整性校验通过；包内服务与经过回归的构建一致。第一版安装后已完成以下界面及推理验收；随后补齐官方展示名称的最终包已替换，启动曾等待 macOS 钥匙串授权；用户完成授权后已验收通过，窗口正常打开、本地服务返回 HTTP 200。进程采样确认主线程阻塞于 `SecItemCopyMatching → SecKeychainItemCopyContent`，系统 SecurityAgent 正在运行；桌面工具禁止操作该系统授权窗口，已请用户自行处理。

第一版安装后的界面实测：海外 WorkBuddy 手动刷新成功、19 个模型；ZCode 2 个；独立 TRAE 有效账号 16 个；旧豆包入口不再出现。目录使用官方展示名称，复制及路由仍保留模型原始 ID。国内 WorkBuddy 在后续界面刷新时增加了 MiMo-V2.6-Pro，变为 19 个，说明初次取证的 18 只是当时快照，不应写死。

已安装应用的 Electron 运行时调用包内官方 WorkBuddy SDK，海外 Flash 返回预期标记。已安装 sidecar 实际经过 `/v1/chat/completions` 完成 Trae 工具调用与后续回答，两轮均为 HTTP 200。旧豆包授权和导入端点均实测返回 410。另 12 项网关目录/路由回归通过。ZCode 界面仍提示未确认当前账号的 Coding Plan 余额，因此“目录为 2 个”不能解释为额度可用。

此处为第一轮安装记录；后续已修复 DeepSeek 上游截断，并补充流式工具真机验收，见下文。


## 2026-10-16 后续：启动与 TRAE 额度

用户完成系统钥匙串授权后，最终包启动通过：工作台可见，本地 HTTP 服务为 200。

TRAE 当前美国区原生账号额度接口为 `POST https://api-us-east.trae.ai/trae/api/v1/pay/ide_user_ent_usage`，请求 `require_usage` 与 `full_data`，使用现有账号的 Cloud-IDE-JWT。不能把额度请求发往推理域名。官方网页的 `LLMRawChatV2` 与额度 SDK 定义、账号页金额组件已用于核对，金额字段为已用值，非剩余值。官方计费说明见 https://www.trae.ai/blog/trae_membership_0213 。

新增适配读取有效套餐的基础/奖励金额、已用比例与周期结束时间；缺失金额保持未知，不按零处理，不合并隐藏或历史套餐。当前账号为 Free plan，基础额度 1 USD，实际金额随调用变化，以最新刷新为准。真实适配结果见 `catalog-followup-2026-10-16/trae-quota.json`。非美国区尚未实测，拒绝将凭据发往未验证域名。账号展示补充本地保存的 TRAE 邮箱、昵称或账号 ID，同时保留用户自定义名称。


## 2026-10-16 DeepSeek 截断修复：正式接口与上游生成模式

已将前文的截断限制复现并修复。短至一个文本消息也会触发，排除了长历史、工具交接和并发等待是必要原因。上游原始 SSE 的 `done` 为正常结束，计费输出含完整 token，但文本尾部已经缺失。

官方 TRAE 3.6.2 安装包（下载接口返回 2.3.91093）已只读校验、解包，对照包内原生请求序列化与请求头。正式对话为 `/api/ide/v2/llm_raw_chat`，需要从账号动态目录读取 `model_name`、`config_source`、`encrypted_model_params`，同时把其中 `RequestPin`、`RequestAt` 放入 `X-Request-Pin`、`X-Requested-At` 请求头。没有这些头会被正式接口拒绝，不能因此回退辅助接口或静默换模型。

相同签名、模型和输入，仅切换正式接口的 `stream`：`true` 的 6/6 次文本都截断，`false` 的 6/6 次全部完整。`false` 关闭的是上游增量生成，官方传输仍返回 SSE，可继续转换标准文本、工具、用量和结束事件。生产修复仅针对已复现的 `deepseek-v4.1-flash`，保留其它已验证模型路径。代价是这一路径的文本需等待本轮生成完成后出现；没有补造缺失文本、自动续写或更换模型。

验证：原生产路径 4 并发、100 轮历史下，8/8 次工具通过，4/4 次最终文本失败；修复后相同 12/12 次全部通过。扩大到 **16 并发、100 轮历史、每会话 4 轮工具交接和最终回答，共 80/80 次通过**，其中 64 次工具、16 次完整最终文本；最长单次 7115ms，中位数 4358.5ms。脱敏逐请求数据保存在同目录 `trae-deepseek-*.json`，正式接口开关对照为 `trae-stream-differential.json`。离线回归可同时捕获错误路径、缺失签名和上游流式截断。

额度和账号相关 44 项 TypeScript 回归、类型检查与桌面构建通过。最终包已替换并完成下文的界面、Chat 和 Responses 真机验收。


## 真机补充：流式工具交付

第一次安装后用真实 HTTP 流式调用进一步发现 `data: data: {...}`：执行器预先封装 SSE，HTTP handler 再封装一次。执行器现在只交付 JSON chunk，HTTP 层统一封装 SSE 与结束标记；非流式聚合仍复用同一份内容。新增回归在修复前稳定失败，修复后通过。这一问题需要经过实际 HTTP 出口才能显现，不能仅依赖执行器聚合测试。

真实已安装网关复测脚本为 `TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-installed.mjs`，会使用现有 TRAE 账号额度，默认 16 并发、100 轮约 6 万字符历史、4 轮工具与最终回答，流式和非流式各占一半。仅访问安装应用当前运行的本机 sidecar；不创建导出 Key。最外层工作台 HTTP 服务的客户端 Key 权限边界仍独立验证，内部 sidecar Key 被其拒绝是预期行为。


工具历史还揭示了原生接口的默认工具选择行为：100 轮约 6 万字符历史下，第一次混合测试为 79/80，一轮最终回答重复历史工具的 DSML 文本。标准请求当前没有工具时，适配现在显式发送 `tool_choice: none`，禁止原生默认自动工具模式。原场景复测已达到 80/80；之前的失败保留在 `trae-installed-before-tool-policy.json`。

另修复 Responses/Claude 入口未转为 Chat 的缺口。Responses 原始调用曾返回 `messages are required`；现复用 Qoder 已有的共享协议转换，保留函数调用、工具结果、用量及终止事件。Chat 原生路径保持原结构。离线 Responses 回归在修复前失败、修复后通过。安装后 Responses 工具往返复现脚本为 `TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-responses-installed.mjs`，会使用现有账号额度。


## 最终安装验收结果

`/Applications/TokenFlow.app`、`release/mac-arm64/TokenFlow.app` 与 `release/TokenFlow-10.15.26.6-mac-arm64.zip` 已更新为同一最终构建，应用已正常重启并保持运行。签名校验通过，逐项核对 ZIP、安装目录和发布目录中的 `app.asar` 与 sidecar SHA-256，完全一致。

最终已安装应用实际运行的 sidecar：16 并发、100 轮约 6 万字符历史、每会话 4 轮工具交接再回答，**80/80 通过**；其中流式 40 次、非流式 40 次，64 次工具调用、16 次完整最终文本，最长 7528ms。Responses 协议非流式与流式各完成一次工具调用及工具结果后的回答，**4/4 HTTP 200 通过**。随后使用本机 Codex CLI 0.154.0 和独立配置，约 6.6 万字符上下文，同一会话完成 3 轮、9 次真实工具执行，退出后恢复两次全部通过。此项是 CLI 客户端验收，不是 Codex 桌面界面点击验收。默认网页搜索声明不受当前 TRAE 桥接支持，本次关闭该项；没有静默丢弃工具。提交用进度与脱敏证据见 [TRAE 修复报告](trae-repair-2026-10-16.md)。

最终工作台手动刷新通过：显示实际账号 ID、Free plan、16 个动态模型，已用约 $0.08 / $1.00、剩余约 92%、重置时间及查询时间；这些是本次查询时的值，会随调用和刷新变化。旧的“尚未读取 Trae 剩余额度”占位已由真实窗口替代。金额额度只完成现有美国区账号验证，其它地区没有宣称通过。

JSON 结果见 `catalog-followup-2026-10-16/installation.json`、`trae-installed-stress.json`、`trae-installed-responses.json`。最终 DeepSeek 方案等待本轮完整生成后交付文本，因此首段等待可能长于逐片段输出；SSE、工具和协议格式保持正确。
