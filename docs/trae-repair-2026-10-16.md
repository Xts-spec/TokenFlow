# TRAE DeepSeek 截断、额度与账号展示修复

更新日期：2026-10-16。修复已安装至本机 TokenFlow 10.15.26.6，并完成真实 Codex CLI 续接验收。

后续网页搜索兼容也已完成：使用 TRAE 官方搜索接口，保留 Codex 默认配置，搜索与客户端工具可以一起续接。下文保留初版验收记录，最新范围和证据见 [网页搜索修复报告](trae-web-search-repair-2026-10-16.md)。

## 已定位并修复

- DeepSeek-V4.1-Flash 在原生增量接口会丢失文本末尾，但仍返回正常完成。与官方 TRAE 3.6.2 客户端格式对照后，改用 `/api/ide/v2/llm_raw_chat`、账号实时模型配置及签名，并设置上游 `stream:false`；HTTP 传输仍使用 SSE。相同场景下，增量模式完整率 0/6，关闭增量生成后 6/6。没有补写文本、替换模型或将 EOF 当成功。
- 安装版验证额外发现工具事件被两次加上 `data:`，已改为由 HTTP 层统一封装 SSE；长历史最后一轮没有工具时显式使用 `tool_choice:none`，避免重复调用历史工具。
- TRAE 原生请求接入既有 Responses/Claude 协议桥接，修复 Responses 客户端因未转换 `input` 而报 `messages are required` 的问题。
- 模型目录读取官方账号 `get_detail_param`，保留可见且启用的对话模型，排除内部辅助、禁用及自定义条目。
- 额度读取美国区官方账号 `/trae/api/v1/pay/ide_user_ent_usage`，展示当前有效套餐、已用/总金额和重置时间；未知用量不显示为零，过期或隐藏套餐不累计。其他地区尚未验证。
- 账号优先显示已有邮箱、昵称或账号 ID，保留用户设置的名称。额度请求使用该账号所属的官方区域地址。

## 验证记录

| 验证 | 结果 |
| --- | --- |
| 安装版 Chat，16 并发、约 6.4 万字符历史、每段 4 轮工具，流式与非流式混合 | 80/80 请求通过 |
| 安装版 Responses，流式/非流式工具调用及结果续接 | 4/4 请求通过 |
| 实际 Codex CLI 0.154.0，`trae/deepseek-v4.1-flash` | 3/3 对话轮次通过，9 次真实命令工具执行；同一会话退出后恢复两次 |
| Codex 长对话输入 | 约 6.6 万字符，逐轮读取、写入、回读临时文件；校验文件内容与完整最终标记 |
| 额度/账号/额度层回归 | 17 项通过 |
| 原生协议与模型目录 Go 回归 | 通过；包含签名、完整输出、异常 EOF、取消、工具、SSE、Responses 转换 |
| 本机 TokenFlow 启动、额度刷新和账号显示 | 已通过；安装包、运行应用的程序及 sidecar 一致 |

Codex 验收使用本机实际安装的 CLI 和已安装应用的 sidecar Responses 接口，配置、会话和项目独立隔离，没有修改用户正在使用的 Codex 配置或旧对话。它不等同于 Codex 桌面界面点击验收。每轮要求三次实际工具执行，并核对落盘结果，不能仅凭 HTTP 200 或回复“ok”判定成功。

首次 Codex 默认附带 `web_search`，接口明确返回 `a2a_server_tool_unsupported`。本次验收将网页搜索关闭后，文件与命令工具、多轮续接全部通过；TRAE 当前桥接支持客户端函数/自定义工具，不承诺提供服务端网页搜索。没有通过静默丢弃工具规避错误。

DeepSeek 关闭上游增量生成后，首段可见文本需要等待生成完成。目录、额度和调用结果均与测试时的账号状态相关，不代表全部地区、模型、未来上游异常都已覆盖。

## 复测与证据

默认离线回归：

```sh
node scripts/test-native-catalog.mjs
npx vitest run tests/trae-quota.test.ts tests/account-label.test.ts tests/quota.test.ts
```

本机真实账号验收显式启用，消耗 TRAE 额度：

```sh
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-installed.mjs
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-responses-installed.mjs
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-codex-installed.mjs
```

脱敏证据：[Codex 实机结果](catalog-followup-2026-10-16/trae-codex-cli.json)、[安装与压力验收](catalog-followup-2026-10-16/installation.json)、[上游生成方式对照](catalog-followup-2026-10-16/trae-stream-differential.json)。认证信息不进入报告或 Git。
