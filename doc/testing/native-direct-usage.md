# 客户端直连用量：采集与验收

日期：2026-10-17。需求是让授权账号关联客户端自身的直连用量，而不仅统计经过 TokenFlow 的请求。关联 [USAGE-002 / USAGE-004](../TODO.md)，统计维度见 [用量来源](usage-attribution.md)。

## 当前边界

授权让 TokenFlow 可以使用账号，并不自动获得其他电脑、网页或客户端全部历史调用。当前本机索引只读受支持客户端留下的实际 Token 记录；Cursor 以本机会话元数据与已授权账号官方明细的交集核对。不拦截 TLS、不修改代理、不根据额度差额估算 Token。

| 客户端 | 采集位置与当前支持 | 账号归属 |
| --- | --- | --- |
| Codex | 本机 sessions、archived_sessions JSONL | 请求身份、OTEL；缺少请求身份时使用连续登录观察时间段 |
| Claude Code | 本机 projects JSONL | 明确 API／OAuth 证据优先；官方登录观察时间段作为注明的补充 |
| Antigravity IDE | `~/.gemini/antigravity-ide/conversations/*.db`，以及旧目录下的同格式 SQLite；`user_version=1` | 数据库没有请求账号字段；只在调用开始时间落入同一账号的连续观察时间段时关联邮箱及项目；旧历史单列 |
| WorkBuddy | 本机 projects JSONL | 明确的官方请求可关联同时观察到的 UID／企业；自定义模型与官方登录共存，不能仅因已登录就归官方 |
| WorkBuddyAI | `.workbuddy-ai/projects`、`sessions` 中与 WorkBuddy 相同格式的 JSONL 入口已接入 | 国际版与国内版分别记录；本机仅发现旧版 local_storage 数据，无真实同格式调用样本，不能视为全版本已支持 |
| Qoder | 本机 projects JSONL | 只有明确官方请求才能补登录身份；缺少认证／来源字段的历史请求仍是未知渠道，不能拿当前登录覆盖 |
| Pi / DeepSeek Harness | 现有 sessions JSONL／压缩日志 | 保留记录中的提供方及请求账号；缺少身份的记录单列 |
| Kimi Code | 本机没有可供验证的会话用量样本，目前没有采集器 | 尚未采集，不显示成真实零用量 |
| ZCode | 本机发现 `cli/db/db.sqlite` 的 `model_usage` 表，但调用行为空；原生聚合另有上下文差量处理，尚未确认真实请求口径 | 尚未采集；需要真实请求样本确认字段、缓存、重试与官方／自定义来源 |
| Trae | 本机未确认可核对的逐请求 Token 数据 | 尚未采集；需要核对客户端记录或官方明细接口 |
| Cursor | 本机 `User/globalStorage/state.vscdb` 的 composer 元数据＋已授权账号官方逐事件账单；原生 3.25.6 实测通过，总览／账号来源／活动可见 | 使用该 SDK Key 的 GetMe 身份和精确会话交集，不借用当前 IDE 登录；网关 agent 持久排除，其他设备和未匹配账单不累计。Windows、其他版本／设备来源边界见后文 |
| xAI Grok | 未确认具备本机逐请求 Token 的客户端记录 | 尚未采集；网页／远端用量不能冒称本机直连记录 |

总览新增“本机直连采集范围”，分别展示已接入、正在读取、未找到记录、暂时不可读和尚未采集。账号页也注明缺口；用量总计只表示已采集请求。登录快照归属会注明“按用量产生时的本机登录识别”，不冒充请求级账单证明。

## 反重力适配依据

本机 Antigravity IDE 的原生 language server 包含 protobuf 描述符。已核对 `CortexStepGeneratorMetadata.chat_model` → `ChatModelMetadata.usage` → `ModelUsageStats`：输入 2、缓存写入 4、缓存读取 5、输出 3、思考输出 9、response ID 11；调用时间取 `chat_start_metadata.created_at`。模型使用原生显示名称，保留 High／Medium 等区别。

只读取 `gen_metadata` 的调用记录。`steps` 会复制生成用量，不能重复加总。输入由非缓存输入＋缓存读取＋缓存写入组成；思考是输出的子集，不再相加。没有 Token 的记录不凭空计次；当前不宣称完整采集无 usage 的失败、所有重试、补全或后台功能。

旧 `.pb` 文件和其他版本／数据库结构会标为暂不可读，保持待适配。数据库和 WAL／SHM 路径拒绝符号链接；数据库只读、有超时、大小／行数限制；单条损坏元数据不丢弃其他已计量调用。索引缓存只保存时间、显示模型、计数及哈希标识，不保存提示词、回复、响应头、完整会话、原始响应 ID 或凭据。

索引在独立 Worker 中运行，约每分钟刷新，界面轮询取得结果。WAL 的追加也会触发重新索引。按响应 ID 去重复制／分叉记录；没有响应 ID 时使用 trajectory、生成序号与时间。网关 response hash／旧 HMAC 证据可排除本机重复记录。

## 账号与历史

1. 连续两次观察同一账号，间隔不超过 15 秒，才覆盖这两次观察之间的调用。切账号、退出、应用关闭、休眠间隙都不连接成一个时间段。
2. 原生请求身份优先；没有证据的历史记录保持未关联。后续授权一个账号，不把旧记录都分给它。
3. 归属证据随索引保留，重启、重扫和账号切换不改写已确认的历史；冲突保留为未知。
4. 已过期或停用的授权仍可用于识别历史来源；多份相同授权关联到账号目录的代表记录。WorkBuddy 地区、企业，Claude 组织，反重力项目分别隔离；缺少范围造成多候选时不强行选一个。
5. Qoder 的解密沿用启动时的安全存储选择。观察过程不读取原登录备份、不写客户端配置、不切换账号；跳过时不绕过钥匙串访问保护。

## 本地验证

```bash
npm run typecheck
npm run build
node scripts/check-antigravity-native-usage.mjs
npx vitest run tests/antigravity-usage.test.ts tests/antigravity-usage-index.test.ts tests/antigravity-usage-service.test.ts tests/native-usage-accounts.test.ts tests/native-usage-coverage.test.ts tests/native-usage-logins.test.ts tests/local-usage.test.ts tests/local-usage-index.test.ts tests/local-usage-evidence.test.ts tests/usage-attribution.test.ts tests/usage-attribution-service.test.ts tests/usage-ledger.test.ts tests/usage-overview.test.ts tests/native-accounts.test.ts tests/desktop-accounts.test.ts tests/desktop-accounts-service.test.ts
```

生产 Worker 在本机真实反重力 SQLite 上只读核对：1 个数据库，45 次生成调用，模型 `Gemini 3.8 Flash (High)`；输入 2,014,552 Token，其中缓存读取 1,800,288，输出 20,171。45 次旧调用均未关联账号，符合历史没有观察证据的边界；这些输入数已经包含缓存，不能再加一次缓存。没有发起新厂商推理请求。

夹具覆盖双账号及未知历史在总览／活动中的来源、停用与重启、复制去重、WAL 追加、网关排重、损坏及旧版格式、跳过安全存储、地区／项目／企业隔离、过期和重复授权。这里的源码、生产 Worker 验证不表示已构建或安装新 DMG，也不表示 Windows 实机或其他客户端版本通过。完整 Windows 验收见 [U11 / U12](../待修复的问题win兼容.md)。

## Cursor 真实后端消耗核对

用户明确授权后，在隔离服务中复用 TokenFlow 已保存的 Cursor SDK 授权，经正式 `/v1/responses` 通路发起最小文本请求，无工具和真实项目文件。没有重新授权或修改正常客户端配置；测试 Key、会话本地存储与服务目录在结束后清理。厂商端仍会有真实调用记录及消耗。

首次调用 `Gemini 4 Argon` 返回 HTTP 200，SDK／TokenFlow 记录输入 2,000、输出 5，而官方同一 agent 的事件明细记录输入 2,000、输出 29。根因是旧逻辑只在 SDK 没有 usage 时查询官方明细，已有数字就跳过。已增加会失败的精确回归，改为优先采用同一 fresh agent 的官方账单，查询不可用时才保留 SDK 计数；不以账号总额差分结算，也不将思考 Token 差异未经证据说成确定原因。

修复后再次真实调用，同样 HTTP 200：输入 1,994、输出 5，总计 1,999；响应 usage、TokenFlow 账本及官方该 agent 明细一致，1 次请求、0 次失败、0 次未计量，缓存为 0。第二次用原生 IDE 登录只读校验，确认测试 SDK 账号与本机 Cursor 客户端账号一致。

实际打开 Cursor 的 `Settings → Plan & Usage`：当前界面为套餐汇总百分比，没有这次请求的逐 Token 条目。不能用百分比变化证明单次请求的精确消耗。本节前序验证的是 **终端 → TokenFlow → Cursor SDK**，采集位置是 `gateway`；本次新增的原生客户端验证单独记录在下一节。

可复跑的 macOS 手动入口（会实际消耗所选已授权账号的额度，默认只发一次最小请求）：

```bash
npx electron scripts/cursor-usage-live.cjs --live
npx vitest run tests/cursor.test.ts tests/cursor-usage.test.ts
```

脚本只把授权经私有管道交给临时进程，不将 Key 放入参数、环境、文档或输出；结果只打印计数和哈希。93 项直连／归属回归、40 项 Cursor 回归通过，类型检查与构建通过。Codex／Qoder 保留上表已有日志采集范围，不将本次 Cursor 验证写成所有客户端已完成。

## Cursor 原生客户端直连采集（2026-10-17）

### 问题、依据与实现

1. 本机 Cursor 3.25.6 的原生消息 `tokenCount` 是 0，`contextTokensUsed` 是上下文占用，均不能直接当消耗；当前 `composerHeaders` 表可提供 composer ID／创建时间，旧 `cursorDiskKV` 的 composerData 和 ItemTable 头部也保留兼容入口。查询只选择身份／时间字段，不返回正文、加密 blob 或认证项；数据库／WAL 只读且拒绝符号链接，限制文件大小和行数。
2. 官方 `GetFilteredUsageEvents` 具有 `conversationId / timestamp / model / tokenUsage`。本机安装版 protobuf 定义和真实响应均已核对。**SDK 也会返回 `isHeadless=false`**，因此它不是 IDE 来源证明。只接收精确命中本机会话哈希、落在已知时间范围、没有明确 SDK／CLI／云端／自动化标记的事件；不取账号总额差分、不按模型或附近时间猜匹配。
3. 复用 TokenFlow 已保存的 SDK 授权，通过该 Key 的 GetMe 确认身份；若已保存邮箱与官方不同则保留旧计数并提示。授权未带邮箱时由 GetMe 确认，不读取本机 Cursor accessToken，也不创建或写回 SDK Key。多账号独立查询、按实际账单账号关联；停用／过期授权只保留已核对历史。
4. 每个网关 agent 在发送推理前保存会话哈希到 `cursor-gateway-conversations.jsonl`。即使清空活动轨迹、重启或后来在 IDE 中出现该会话，仍排除。缺少可读排重证据时暂停展示直连计数并说明，不猜测累计。
5. 缓存 `cursor-native-usage.json` 只存账号／邮箱／会话及事件哈希、时间、模型和计数。相同事件不重复追加，后续修正替换原计数；暂缺 tokenUsage 保留已核对值。跨页完全相同的事件去重，同一会话／时间／模型的冲突事件不估算；接口没有稳定逐事件 ID，这个歧义仍保留边界。
6. 网络核对在后台进行，页面立即读取快照；约每分钟按使用触发更新。独立 Worker 监测 SQLite 与 WAL；总览、来源账号、活动和维修用量共用合并结果，活动标记“官方明细核对”。官方空账单按 protobuf 省略零字段处理，不误报授权或网络失败。

官方说明也将用量明细与对话内容区分，可参考 [Cursor 官方 Analytics](https://cursor.com/docs/account/teams/analytics) 和 [Admin API 字段说明](https://prod.cursor.com/docs/account/teams/admin-api)；这里使用已授权个人账号的 Dashboard RPC，**不要求或创建团队 Admin Key**。厂商内部接口仍可能变化，版本与失败状态必须如实保留。

### 真实本机验证

- 在 Cursor 3.25.6 原生界面新建 No Repo／This Mac 会话，选择 Gemini 4 Argon Medium，发送固定的“只回复 OK、不要工具／读文件／运行命令／修改文件”测试消息；实际返回 OK。这是本轮唯一新增原生测试请求，会产生真实额度消耗，未使用真实项目上下文。
- 官方对应会话逐事件记录为输入 **14,047**、输出 **5**、合计 **14,052 Token**，缓存读取为 0。原生界面只显示 OK，不用其上下文百分比推算 Token。
- 生产构建 Worker 读到 4 个本机会话头部。在隔离服务中复用已有 SDK 授权，原生行只累计 1 次／14,052 Token，账号匹配正确，活动有 1 条 `billing` 证据记录；网关账本为 0。最终按本机会话创建时间限定窗口，共取得 14 条跨账号明细，仅这一条命中本机，其余 13 条未混入直连总计；前序 7 天范围只读核对的 184 条同样只命中这一条。
- 检查前后原生数据库文件字节相同；服务没有调用 CreateUserApiKey 或写回已有授权。缓存无邮箱明文、凭据或原始会话 ID。只读检查可重复运行，不再发起推理：

```sh
npm run build
npx electron scripts/cursor-native-usage-check.cjs --check
npx vitest run tests/cursor-native-usage.test.ts tests/cursor-native-usage-service.test.ts tests/cursor-usage.test.ts tests/cursor.test.ts
```

自动回归覆盖：当前／旧版元数据夹具、WAL 追加、缓存重启、双账号和无邮箱 SDK 授权、官方身份不匹配、空账单省略字段、延迟 Token、修正／冲突明细、分页不完整、云端／其他设备／SDK 排除、网关排重文件损坏以及取消后台查询。源码服务集成同时核对网关账本、总览、账号归属、活动详情和重启结果；Windows 实机验证仍见 [U13](../待修复的问题win兼容.md)。本轮没有构建或安装新 DMG／Windows 包。

最终验证：19 个相关测试文件、114 项通过，类型检查与生产构建通过；上述真实原生请求、生产 Worker 和只读官方对账通过。这些结果不代表全仓库或 Windows 全功能验收。

### 仍待完成

- Windows 真机的 SQLite 占用、路径／权限、代理、DPAPI 与安装包行为，以及旧 Cursor 版本、Insiders／自定义资料目录、团队和服务账号。当前 Windows 路径解析与夹具可测试，不能据此勾为实机通过。
- 本机会话头部证明“这里有该记录”，不证明导入／跨设备同步的整段历史都在本机执行。缺少设备标识的这类历史还需更多真实样本；没有本机会话证据的账号账单一律不加入。
- 默认最多核对最近 180 天，单账号单次最多 20 页、每页 100 条；分页不完整保留该账号旧统计并提示，按时间细分大量账单仍待实现。不能宣称覆盖全历史或全账号所有事件。
- 目前验证的是 Agent／聊天的 Token 明细；没有逐 Token 明细、没有会话 ID、无 usage 的失败、Tab／补全及其他入口尚未证明可采集，不按百分比或成本估计。未授权账号、网页和其他设备用量不自动补入。
- 同一会话／毫秒／模型若出现不同 Token 的多条事件，不能在缺少稳定事件 ID 时判定是修正还是独立调用；保留冲突提示。完全相同事件保守去重，若厂商实际记录了同毫秒的独立同值请求，可能低估，需稳定事件 ID 才能进一步消歧。
