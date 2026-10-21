# 真实 Luna：首次超过 10 MiB 的历史与 Codex 压缩

2026-10-21，使用安装版 `codex-cli 0.163.0-alpha.11` 和已授权的 `codex/gpt-6-luna` 完成测试。结论：**Codex 能主动发起压缩并成功续聊，但首次请求已经超限之后，不能依赖它自动压缩恢复。** 这些实验没有更改生产配置、安装版或网关拦截规则。

## 样本与测试边界

- 用真实 Codex app-server 在隔离 HOME 中生成 12 轮合成历史，每轮约 1 MiB 助手正文。有效历史约 **12,666,527 字节**，确认没有摘要或压缩条目；约 38 MB 的 rollout 文件大小不作为请求大小证据。
- 当前配置的首次客户端请求为 **12,703,497 字节**，实际转给真实来源为 **12,702,522 字节**。模型请求均使用 Luna；没有发送真实用户对话。
- 链路是安装版 Codex → 隔离 HTTP 入口 → 生产 `GatewayContext` → 当前已授权 sidecar → 真实上游。隔离入口用于关闭网关的首次主动处理，不是对运行中 `9527` 监听器的完整端到端测试。
- 旧来源最后报告的 150,000 或 100 输入 Token 是夹具控制变量，**不是这份 12 MiB 历史的真实 Token 数**。分别模拟已有用量元数据和缺乏可靠用量元数据的接入，不能据此推断所有真实旧会话都会采取同样的压缩决策。
- 生成历史时临时提高压缩阈值，接入前删除。脚本新增断言防止残留。早期未清除该设置的试跑已排除出客户端策略结论；旧的约 532 KB 测试也不能用于证明正常配置下 Codex 不会压缩。

逐请求大小、真实错误、调用用量及配置差异保存在 [JSON 记录](results/codex-live-overflow-2026-10-21.json)。

## 完成的真实实验

| 条件 | 真实上游调用 | 结果 |
| --- | ---: | --- |
| 当前 Codex 配置，关闭网关首次主动压缩，保留默认重连 | 6 | 首次普通请求及 5 次重连均超限；客户端压缩 0 次，失败 |
| 同上，旧用量仅 100 Token，再发一轮续聊；关闭重复流重连 | 2 | 两轮都原样发送大历史，都失败，客户端压缩 0 次 |
| 测试中改为按全部上下文计算，并转换真实超限错误；Codex 本地摘要路径 | 25 | 22 次超限后逐条移除最旧输入，摘要成功，续聊及重启恢复成功 |
| 测试中按全部上下文计算，启用 Codex 远程压缩路径；旧用量 150,000 | 4 | Codex 提前触发摘要，正式回复成功；重启后再次压缩剩余部分并成功续聊 |
| 按全部上下文计算、远程压缩、正确转换超限错误，但旧用量仅 100；首次普通请求后再续聊 | 2 | 首次确实没有压缩；两次真实超限都识别为 `contextWindowExceeded`，仍没有自动压缩恢复 |

一个较小的真实来源对照也成功：约 558 KB 请求，返回 132,120 输入 Token、32 输出 Token，并准确复述最早的随机核验标记。它用于排除来源整体不可用，不用于推断超大历史的压缩决策。

## 真实超限如何变成重连

大请求收到 HTTP 200，随后 SSE 返回顶层错误：

```json
{"type":"error","code":"context_too_large","message":"Your input exceeds the context window of this model. Please adjust your input and try again."}
```

当前 Codex 将该流视为缺少完成事件，显示 `stream closed before response.completed`，默认原样重连五次。这里的超限来自真实来源，不是网关的 413/422 拦截。

显式实验开关将**真实已收到的错误**转换为 `response.failed`，其中 `response.error.code` 为 `context_length_exceeded`。Codex 随即正确显示 `contextWindowExceeded`。没有模拟上游容量或凭空制造错误。但最后一组证明：**正确识别错误本身不等于会在下一次续聊时自动压缩**。

## 两条压缩路径的区别

本地摘要路径中，Codex 先把约 12.7 MB 历史直接交给模型总结。遇到已识别的上下文超限后，它逐条移除最旧输入再试。22 次真实拒绝后，约 2.13 MB 的摘要请求成功，报告 785,946 输入 Token。随后正式回复和重启续聊均成功，最早用户核验标记保留，rollout 保存一个压缩条目。

这不是对全部旧历史逐块摘要：被移除的旧助手正文没有进入最终摘要调用。用户标记仍在不能证明所有旧助手内容保真；Codex 自己保留的用户消息也参与了恢复。

远程路径中，第一次请求带 `compaction_trigger`，是 **Codex 发起**，网关没有主动做首次压缩。网关用约 21 KB 摘录请求真实 Luna 生成摘要，随后约 1.10 MB 正式请求成功。重启后，Codex 再次触发压缩；新增摘要请求只有约 2.4 KB，之前的摘要继续参与最终约 49 KB 请求，用户标记仍保留。rollout 保存两个压缩条目。

远程对照使用测试专用的 `model_providers.token_flow.name="OpenAI"` 进入该运行时的远程协议，同时保持原授权 Luna 来源。它不是已发布的产品配置；正式采用前还需要确定合适的客户端能力接入方式。按全部上下文计算也是实验变量，不能仅凭本实验就全局替换当前配置。

两条成功路径都验证了客户端重启后的检查点恢复。本轮没有真实切回另一官方账号；官方往返、来源记录和增量备份仍属于此前隔离回归的验证范围。不能把本轮重启恢复当作全部官方往返流程已经实测。

## 判断与下一步

1. “由 Codex 决定何时压缩、网关执行它明确请求的摘要”已经有真实成功证据，无须为此增加请求大小拦截。
2. “首次大历史先全部发送，超限之后 Codex 会自己恢复”在本次运行时中没有成立，即便转换了错误格式、改为 total 并启用了远程协议，后续请求仍失败。
3. 应先处理超限错误的协议兼容，再明确首次历史如何进入 Codex 的压缩流程。不能只删除首次处理就宣称问题解决，也不能把本次结果解释成必须由网关长期独立判断压缩时机。
4. 本轮只保存测试与证据，生产策略和安装版保持不变。

确认成功的本地路径累计报告 812,712 输入 / 317 输出 Token；远程路径报告 425,761 输入 / 436 输出 Token。失败调用未报告用量，不记为零，也不把这些合计当作全部实验账单。

## 复现

以下命令中的 `--live` 会实际调用已授权 Luna；失败组按断言以非零状态退出。诊断组的 `--single-attempt` 仅关闭流重连，不关闭上下文压缩。

```sh
CODEX_BIN=/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex

# 当前策略的真实失败：首次 >10 MiB，不由网关提前压缩。
node --import tsx scripts/codex-first-long-history-smoke.mjs "$CODEX_BIN" --client-only --large-history --live --known-usage

# 本地摘要路径，真实超限之后逐条裁减，随后验证重启。
node --import tsx scripts/codex-first-long-history-smoke.mjs "$CODEX_BIN" --client-only --large-history --live --known-usage --single-attempt --normalize-context-error --total-scope --resume-after

# Codex 提前发起远程压缩，并验证重启续聊。
node --import tsx scripts/codex-first-long-history-smoke.mjs "$CODEX_BIN" --client-only --large-history --live --known-usage --single-attempt --total-scope --remote-compaction --resume-after

# 首次普通请求真实超限后，再次续聊是否自行恢复：实测失败。
node --import tsx scripts/codex-first-long-history-smoke.mjs "$CODEX_BIN" --client-only --large-history --live --single-attempt --normalize-context-error --total-scope --remote-compaction --retry-turn --resume-after
```

可以通过 `RESULT_PATH=/absolute/path/result.json` 保存结果；默认删除隔离 HOME。原有不使用 `--live` 的合成 smoke 也已回归通过。
