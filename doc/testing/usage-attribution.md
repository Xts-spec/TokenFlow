# 用量渠道、来源与本地验证

整理日期：2026-10-16。关联 [USAGE-001 / USAGE-002 / USAGE-003](../TODO.md)。

## 先区分四个维度

| 维度 | 示例 | 不能据此推断什么 |
| --- | --- | --- |
| 目标客户端 `target` | Claude Code、Codex，或独立导出 Key 的 `key` | 使用 Messages 协议、Key 允许 Claude，不代表请求必定来自 Claude Code |
| 模型来源 `provider / sourceId` | 反重力来源与账号 A | 模型名字包含 Claude，不代表消耗 Claude 官方登录账号 |
| 来源渠道 `channel` | 官方账号 `official`、独立 API `api`、未知 `unknown` | `official` 表示来源类型，不代表请求绕过了 TokenFlow |
| 采集位置 `origin` | 网关 `gateway`、本机日志 `native` | 当前登录账号不必然是历史请求的账号 |

例如 Claude Code 通过 TokenFlow 使用反重力的 Claude 模型，正确归属是：目标 Claude Code、来源反重力账号、来源渠道官方账号、采集位置网关。它不应计入 Claude 官方账号直连用量。

## 当前实现范围

| 路径 | 当前依据 | 状态 |
| --- | --- | --- |
| Claude Code → TokenFlow → 反重力／其他来源 | 受管连接 Key 与来源绑定，上游 usage | 已有实现；本轮增加反重力双账号、Gemini／Claude、流式／非流式和重启测试 |
| 独立 Key → TokenFlow → 反重力 | 独立 Key 的 `sourceId` 与模型权限 | 来源可确定；目标记为 `key`，不能仅因授权 `agents=['claude']` 就认定客户端身份 |
| Claude Code 本机官方直连 | 本机 JSONL、请求证据或有效登录观察时间段 | 夹具回归通过；复杂真实环境及包内历史失败仍待验收 |
| Claude Code 本机 API／第三方直连 | 日志中的认证证据，证据不足时未知 | 不能拿当前 TokenFlow 来源、当前登录或模型名倒填历史归属 |
| 反重力客户端自身的官方直连 | 2026-10-17 已接入原生 SQLite v1 的生成 Token 记录 | 生产 Worker 已在本机数据验证；旧 `.pb`、其他版本和无身份历史有边界，见 [直连采集](native-direct-usage.md) |
| 反重力周／5 小时额度 | `quota/antigravity.ts` 独立查询两个模型组、四个窗口 | 属于额度信息，不能从百分比反推 Token 或逐请求账号归属 |

## 本轮可复跑测试

```bash
npx vitest run tests/usage-attribution.test.ts tests/usage-attribution-service.test.ts tests/native-usage-logins.test.ts tests/local-usage.test.ts tests/local-usage-index.test.ts tests/usage-ledger.test.ts tests/usage-overview.test.ts
```

本轮在 macOS 开发机运行。原 37 项回归通过，新增反重力集成场景后共 38 项；测试使用隔离临时目录和模拟来源，不修改真实客户端配置、不读取钥匙串，不表示厂商真实调用或 Windows 实机已通过。

新增场景覆盖：

1. 两个反重力账号提供同名 Gemini 与 Claude 模型，来源分别计数，不按模型厂商错误合并。
2. Messages 非流式和流式各自将上游 7 输入／3 输出计入正确账号与模型。
3. 停用所选账号后返回 503，失败仍归该账号，不转到另一个有同名模型的账号，不增加虚构 Token。
4. 独立 Key 的请求记为 `target=key`；通过受管 Claude Code 配置取得的 Key 记为 `target=claude`，来源仍是反重力。
5. 关闭并重新创建本机服务后，各来源用量账本保持一致。

这些数字仅为固定测试输入，不是实际厂商 Token 值。

## 本机历史数据只读核对

读取现有应用资料中的 `usage-ledger.json`，仅输出汇总，不复制账号、Key 或请求正文。现有反重力记录覆盖 2026-10-13 至 2026-10-15：7 个汇总行、2 个非空来源标识，目标包含 Claude、DeepSeek、Pi，共 721 请求，其中 588 失败；记录输入 6,056,703、输出 27,407 Token。

该核对说明历史网关账本实际保存过反重力来源维度。它不能证明所有历史归属正确，也不能解释旧失败原因，更不能把旧压测／故障记录当作当前成功率或反重力原生客户端用量。本轮没有向真实厂商发起新的推理请求。

## 未关闭的验证

- **Claude 包内归属**：此前 `check-packaged-runtime.mjs` 在 Intel 包的 Claude 本机账号归属断言失败。本轮源码夹具通过，未重新构建并跑完整包内检查，继续保留在 TODO，不标记修复。
- **真实 Claude 渠道切换**：官方登录、独立 API、经 TokenFlow、直接第三方四条路径，需要在真实客户端逐条核对来源、账号、目标和 Token；权限跳过、账号切换、历史无证据与重复索引也要覆盖。
- **反重力直连采集**：SQLite v1 已实现，继续验收其他版本、真实账号／项目切换及完整厂商对账；不能用剩余额度或者当前登录推测历史。当前覆盖见 [直连采集](native-direct-usage.md)。
- **跨平台**：Windows 重跑本页回归并执行 [U04 / U11](../待修复的问题win兼容.md)，不能沿用 macOS 夹具结果。
