# 客户端直连用量：采集与验收

日期：2026-10-17。需求是让授权账号关联客户端自身的直连用量，而不仅统计经过 TokenFlow 的请求。关联 [USAGE-002 / USAGE-004](../TODO.md)，统计维度见 [用量来源](usage-attribution.md)。

## 当前边界

授权让 TokenFlow 可以使用账号，并不自动获得其他电脑、网页或客户端全部历史调用。当前本机索引只读受支持客户端留下的实际 Token 记录；不拦截 TLS、不修改代理、不根据额度差额估算 Token。

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
| Cursor | 网关 SDK 已按精确 conversation ID 查询官方账单，并完成与本机 IDE 同账号的真实后端调用对账 | 原生直连采集仍待接入；不能把全账号账单再加一遍，需排除已统计 SDK 会话并确认目标客户端 |
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

实际打开 Cursor 的 `Settings → Plan & Usage`：当前界面为套餐汇总百分比，没有这次请求的逐 Token 条目。不能用百分比变化证明单次请求的精确消耗。本轮验证的是 **终端 → TokenFlow → Cursor SDK**，采集位置是 `gateway`，不能将它标成 Cursor 客户端原生直连通过；后者仍在 USAGE-004。

可复跑的 macOS 手动入口（会实际消耗所选已授权账号的额度，默认只发一次最小请求）：

```bash
npx electron scripts/cursor-usage-live.cjs --live
npx vitest run tests/cursor.test.ts tests/cursor-usage.test.ts
```

脚本只把授权经私有管道交给临时进程，不将 Key 放入参数、环境、文档或输出；结果只打印计数和哈希。93 项直连／归属回归、40 项 Cursor 回归通过，类型检查与构建通过。Codex／Qoder 保留上表已有日志采集范围，不将本次 Cursor 验证写成所有客户端已完成。
