> 历史记录：保留当时的结论与验证范围；当前待办以 [TODO](../../TODO.md) 为准，产品行为以当前源码和 [使用指南](../../guides/usage.md) 为准。

# 官方账号模型发现

账号模型目录优先查询官方服务，按账号注册可调用路由。启动时获取，运行期间约每 30 秒检查；平台「刷新」强制重新获取当前平台账号。正常刷新复用短期目录，避免配置重载反复请求。失败时保留该凭据最近一次成功的官方目录，没有成功目录时才使用模型表。

| 来源 | 目录方式 |
| --- | --- |
| WorkBuddy | 当前企业／personal 的 `/console/enterprises/{id}/models`，使用官方 `cli` Agent 的模型范围，与桌面内置运行时一致 |
| Qoder | 与本机运行时相同的签名 `/api/v2/model/list?Encode=1`，读取官方 CLI／IDE 场景列表及显示名称 |
| Antigravity | `v1internal:fetchAvailableModels` 的完整模型目录及搜索能力，排除内部模型和补全专用条目 |
| Codex | 账号的 `/backend-api/codex/models`，客户端版本优先取本机 `models_cache.json` 的 `client_version`；不将本机缓存中的模型列表当作账号权限 |
| Claude | `/v1/models`，OAuth 认证；显式配置的 API Key 模型范围保持原样 |
| Kimi Code | `/coding/v1/models`，账号认证 |
| xAI | 已配置官方 API 地址的 `/models`，账号认证 |
| ZCode | 对应 Z.AI Coding／BigModel 地址的 `/models`，账号认证 |
| 豆包 | 明确配置推理 API 地址时读取 `/models`；MarsCode 登录凭据不会发送到另一个 Ark 服务 |
| Trae | 暂未验证可用于当前授权的官方模型目录接口，保留备用目录，不猜接口 |
| Cursor | 原有官方 SDK `models.list`，失败时查询官方 `/v1/models` |
| 独立 API | 原有上游 `/models` 读取；保存的模型和导出 Key 权限仍由用户选择 |

查询超时、认证失败、无目录接口或响应损坏都不代表模型能力结论。官方成功返回的空列表视为权威空目录。缓存按账号、凭据、企业、端点和客户端版本隔离；更换凭据不会沿用上一账号的成功目录。不会把静态模型表混入成功的官方列表，也不会因新增模型扩大现有 Key 权限。

发现模型后仍经过现有别名、排除规则、来源绑定和路由注册。显示名称可更新，请求 ID、已保存的模型选择和 Key 的授权数组不自动改写。调用可用性以实际上游响应为准。

维护实现位于 `patches/cliproxy/official_catalog.go`，由 `scripts/official-catalog-overlay.mjs` 接入 Go 构建；不改上游 checkout。回归检查：`node scripts/test-official-catalog.mjs`。真实账号只读检查需显式设置 `TOKEN_FLOW_CATALOG_AUTH_DIR`，输出仅模型元数据。真实调用另用 `scripts/source-live-smoke.ts --live`，在临时配置中完成。
