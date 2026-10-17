# 官方登录与自定义模型共存验证

日期：2026-10-17。关联 [LOGIN-001](../TODO.md)，产品约定见 [产品定位](../产品定位.md)。

## 客户端行为区别

| 客户端 | 官方登录与网关配置 | 界面与切换要求 |
| --- | --- | --- |
| WorkBuddy、Qoder 独立应用 | 官方身份与导入的自定义模型可以并存 | 导入网关模型后官方账号仍选中，标注“已登录”；切换或恢复官方登录保留自定义模型与连接 Key |
| WorkBuddyAI | 官方身份与 `~/.workbuddy-ai/models.json` 里的自定义模型独立；不写入国内版 `~/.workbuddy/models.json` | 与 WorkBuddy 使用同一套网关模型面板。导入后官方账号仍选中；切换或恢复官方登录不删除这些模型 |
| Codex | TokenFlow 接入会切换当前模型 provider | 保留官方凭据，但官方直连模式与网关模式的当前选中仍分开；不把“凭据还在”当成正在使用官方接口 |
| Claude Code | 本轮继续沿用已有接口／官方登录切换流程 | 未扩大修改其路由和登录恢复规则 |

`gatewayConnected` 对自定义模型客户端表示存在接入配置，不证明用户已经在客户端菜单选中该模型，也不表示官方账号退出。真正使用的模型与来源仍需按实际请求验证。

## 原因与修复

此前 `useNativeLogin()` 和未入池的本机账号展示统一使用“匹配本机身份且没有网关连接”作为选中条件，误将 WorkBuddy、WorkBuddyAI、Qoder 套用为互斥模式。后台桌面登录切换还会通过回调恢复原接入配置，连带移除导入模型。

现在三种客户端使用明确的共存规则：账号匹配时保留选中，展示“已登录”；切换／恢复桌面官方身份只处理该身份及登录备份，不自动恢复或删除自定义模型配置。用户仍可在本地 Agent 页面主动停用网关或恢复原配置。

## Qoder、Codex 名称复核

- **Qoder 0.3.4 本机安装包**：只读提取实际 `resolveFallbackPresentation()`，对导出的自定义模型运行，得到 `qoder/GLM-5.3-Flash`，内部 `qoder/gfmodel` 保持独立，未出现 WorkBuddy 的“名称:ID”拼接。
- **Codex 本机原生 app-server**：在临时配置下加载 TokenFlow 模型目录并调用 `model/list`，两条结果的 `displayName` 分别为 `qoder/GLM-5.3-Flash`、`codex/GPT-5.6-Luna`，模型请求 ID 单独保留。没有发起真实模型推理或修改正常配置。
- 本轮不为 Qoder、Codex 增加 WorkBuddy 专用的可读 ID 映射。这里验证的是原生显示逻辑／模型列表，不能替代所有版本、所有平台的完整窗口验收。

## 本地回归

```bash
npx vitest run tests/native-login-identity.test.ts tests/desktop-accounts-service.test.ts tests/model-export-labels.test.ts tests/agent-connections.test.ts tests/agent-model-switching.test.ts
npm run typecheck
npm run build
npx electron scripts/official-login-coexist-ui-check.cjs
```

70 项相关回归、类型检查和构建通过。界面脚本使用实际构建与隔离 API 夹具：三种共存客户端的已保存账号、未入池本机身份都保留选中，Codex 的网关模式不误选官方账号。后台回归覆盖身份校验失败不写入、切换／恢复后模型配置原文不变、连接记录与 Key 仍可用，以及国内／海外登录互不覆盖。

Windows 真实窗口、重新打开后的模型菜单和实际选模仍待执行 L13；测试中没有读取真实钥匙串、清除正常登录或调用真实厂商模型。
