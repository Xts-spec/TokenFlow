# Codex 远程压缩真实验证 — 2026-10-22

运行时：本机安装的 `codex-cli 0.163.0-alpha.11`。使用独立 HOME、合成历史和用户已授权的 `codex/gpt-6-luna`，未读取真实聊天正文。测试调用生产接入配置、生产迁移客户端与生产网关压缩实现。

```sh
RESULT_PATH=/tmp/tokenflow-remote-bootstrap-live.json node --import tsx scripts/codex-first-long-history-smoke.mjs /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex --large-history --migration-bootstrap --resume-after --live
```

未启用实验性的 `--remote-compaction`、`--total-scope`、`--normalize-context-error`，也未设置可靠历史用量。结果中的同名 false 字段表示这些测试覆盖开关未启用，并非生产配置关闭远程压缩。

| 检查 | 结果 |
| --- | --- |
| 首次有效历史，无摘要 | 12,666,528 字节，旧来源报告输入仅 100 Token |
| 迁移启动原生压缩 | `thread/compact/start` 成功一次 |
| 后续客户端压缩 | Codex 再触发一次，网关共执行两次明确请求 |
| 客户端请求大小 | 12,707,014 → 1,492,201 → 91,470 字节；前两次带 compaction_trigger |
| 真实上游摘要 | 21,034 和 2,063 字节，均 HTTP 200 |
| 真实上游正式续聊 | 50,350 字节，HTTP 200，回复完成 |
| 重启后续聊 | 51,096 字节，HTTP 200，复用摘要，无新增摘要调用 |
| 最早随机要求 | 首次和重启后的回复均保留 |
| 持久化压缩记录 | 2 条 |
| 上游超限错误 | 0 |

四次上游请求确认输入 36,085 Token、输出 569 Token。后一次摘要只处理新增部分，不重复发送已有摘要；正式续聊仍包含最早要求。逐请求用量和事件元数据见 [JSON 记录](results/codex-remote-compaction-2026-10-22.json)。摘要对旧工具结果使用现有摘录策略，因此“12 MB 历史”不等于把全部 12 MB 原始工具输出送进一次摘要模型调用。

安装版 Codex 的合成协议回归另验证：50 次请求、三轮客户端压缩开始/完成配对、网关→官方→网关摘要往返、用户约束与可读推理摘要保留；旧 Astra 切到 Luna 时所有压缩仍使用授权 Luna，新短对话无预压缩。HTTP/SSE 超限规范化与失败立即重试由自动化回归覆盖。未声称在 Windows 主机实测；共用实现与安装版 macOS 运行时验证通过。

初次长会话不应靠超限报错启动压缩：此前真实实验显示，Codex 即使认出错误，也可能因旧用量只有 100 而不自动发起压缩。现在托管迁移显式调用 Codex 自己的压缩任务解决该入口；后续仍由 Codex 决定触发时机。单条当前用户内容或固定工具本身超过上游窗口时，上游仍可能拒绝，这不是网关新增拦截。

发布验证：34 个测试套件共 394 项通过，TypeScript 检查通过。10.15.26.43 从提交 `00ceac0` 的独立源码快照构建，40 个 dist 文件与 app.asar 逐项哈希一致，打包后的 Electron 运行检查通过，包括有效但变长摘要、失败立即重试、摘要缓存续聊、SDK 加载、页面、账号、用量与局域网网关。发布文件与安装验证保存在本机 `releases/v10.15.26.43/`。

已经接入的 Codex 需要在 TokenFlow 重新应用模型接入并重启 Codex，才能加载远程压缩配置并执行首次迁移检查。替换 TokenFlow 不会让已运行的 Codex 进程重新读取配置。
