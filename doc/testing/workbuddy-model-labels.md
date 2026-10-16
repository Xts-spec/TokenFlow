# WorkBuddy 导入模型名称验证

关联 [MODEL-001](../TODO.md)，产品要求见 [模型名称原则](../产品定位.md)。验证日期：2026-10-16 至 2026-10-17。

## 原因与修复

本机 WorkBuddy 5.8.2 的 `getModelDisplayName()` 对自定义模型比较可读名称与去除 `custom-local:` 的 ID；不同则显示为“名称:ID”。此前 TokenFlow 分别导出可读名称和内部路由 ID，因此复现 `qoder/GLM-5.3-Flash:qoder/gfmodel`。

现在为 WorkBuddy 导出可读 ID，名称与 ID 一致；相同名称冲突时使用 `(2)`、`(3)` 区分，保留原有非 TokenFlow 模型。接入备份记录中的 `modelAliases` 将可读 ID 映射回内部路由，映射仅对这条受管 WorkBuddy 连接的 Key 生效。

网关在授权检查、来源选择和用量记录之前还原内部模型 ID，所以请求仍绑定原来源账号和模型。普通导出 Key 不获得这个映射；重命名／重新应用会重新生成配置并撤销旧 Key。映射随接入记录保存，服务重启后恢复；旧版本没有该字段的记录仍可读取和恢复。

## 本轮本地结果

| 验证 | 结果与范围 |
| --- | --- |
| 最小复现 | 修复前回归明确得到 `qoder/GLM-5.3-Flash:qoder/gfmodel`，修复后只显示 `qoder/GLM-5.3-Flash` |
| 本机原生格式化函数 | 只读提取已安装 WorkBuddy 5.8.2 的实际函数并执行；Qoder 与 Codex 两个样例都只输出可读名称，不附内部 ID。未修改 WorkBuddy 安装文件 |
| 本机内置 CLI | 使用隔离配置、真实 WorkBuddy 内置 CLI 和模拟 Qoder 来源；以可读名称发起请求，退出码 0，返回模拟来源文本，账本仍记录 `target=workbuddy`、内部模型 `qoder/gfmodel` 和原来源账号 |
| 配置与网关回归 | 86 项通过，涵盖重名处理、流式／非流式、`custom-local:` 前缀、Key 范围、来源与 Token 统计、服务重启、改名换 Key 和原配置恢复 |
| 构建 | 类型检查和生产构建通过 |

这是 macOS 宿主、原生名称函数和内置 CLI 的验证；没有把模拟来源视为真实厂商推理成功，没有宣称 Windows 4.22.16 的完整窗口已实测。Windows 菜单与实际选模仍需按 C12 验收。

## 可复跑入口

```bash
npx vitest run tests/workbuddy-model-labels.test.ts tests/model-export-labels.test.ts tests/agent-connections.test.ts tests/managed-routing.test.ts tests/a2a-service.test.ts tests/usage-attribution-service.test.ts
npx tsx scripts/check-workbuddy-model-labels.ts /Applications/WorkBuddy.app/Contents/Resources/app.asar
```

原生函数检查仅读取安装包并使用合成配置，不启动客户端、不读取登录或真实账号。Windows 传入对应安装位置的 `app.asar`；若客户端代码结构变化，检查脚本应失败并人工复核，不自动标记通过。

## 已导入配置如何更新

更新 TokenFlow 后，在本地 Agent → WorkBuddy 重新应用所选模型，并重启 WorkBuddy 加载配置。旧安装包或此前已经写入的 `models.json` 不会因为本次 Git 提交自动改变；不要手工删除请求必需字段，也不要直接修改 WorkBuddy 安装文件。
