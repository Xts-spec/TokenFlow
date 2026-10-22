# 完整历史摘要与按模型网页搜索（候选版 10.15.26.45）

此次按用户要求删除历史文字的 1 KiB 摘录，以及网关摘要请求的 4096/8192 max_output_tokens 设置和本地输出预算拒绝。历史工具参数、字符串/数组结果、助手文字保持完整，48 KiB 分块仅划分请求，不丢弃文字。二进制附件仍沿用文字摘要的占位表示；已有摘要继续复用。未改动首次续聊、后续 Codex 触发、备份和来源切换机制。

Codex ModelInfo 的 truncation_policy 是必填字段，没有 unlimited 枚举。目录改用 Number.MAX_SAFE_INTEGER（9007199254740991）表示不再提供实际工具裁剪阈值；删除字段会导致目录解析或默认策略问题。安装版 Codex 0.163.0-alpha.11 的实际请求验证 40,541 字节工具结果含完整首、中、尾文字，不再在 10000 字节处裁剪。工具调用者自己指定的输出参数不在本次修改范围。

不再根据整个模型列表写入 web_search=disabled，保留用户原有网页搜索配置。当前请求为 Cursor/Qoder/WorkBuddy 时，仅在 Codex 接收端移除该适配器无法执行的内置 web_search 定义，并相应修正 tool_choice；函数工具与输入保持不变。Luna 和其他支持该工具的来源原样转发。真实 Codex 进程在同一会话内 Luna→Qoder→Luna 切换验证通过，生产 service 的适配测试覆盖 Qoder 与 Codex。此处搜索为协议合成验证，没有声称实际访问了网站。

## 验证

- 35 个相关套件共 400 项；旧摘录假设导致的断言已改为跨完整分块验证，后续重跑对应套件通过。
- 真实 Codex + 合成上游：12,666,534 字节历史无预先摘要，首次续聊摘要 259 次调用（含合并），最早要求保留；重启后复用；新增历史的显式压缩另需 5 次调用。这个合成上游的毫秒耗时不是 Luna 耗时。
- 真实 Codex 工具结果和按模型搜索验证见 results/codex-full-tool-search-2026-10-22.json。
- 11 MiB 工具历史测试确认全部 11,500,000 个有效内容字节进入摘要请求，没有摘录；16 MiB 以上历史分块处理通过。

## 真实 Luna 计时口径

上一次带摘录版本的记录是：压缩流程 8.809 秒，其中一次 Luna 摘要请求 6.822 秒，首次回答全程 11.715 秒。那次摘要请求只有约 22.8 KB；不能把这个数称为 Luna 压缩完整 12.67 MB 的耗时。随后复用无需新摘要，续聊 3.259 秒；旧摘录规则下的新增历史压缩 5.602 秒。

此次无摘录真实上游测试使用隔离 HOME、安装版 Codex 和已授权 codex/gpt-6-luna，仅发送合成历史。运行超过 600 秒仍未完成全部分块。该诊断脚本直接使用 GatewayContext 和真实来源，不经过生产 service 的 600 秒整体计时器，因此其继续运行不证明生产请求能通过。生产时限、48 KiB 串行分块均是已有机制，本次没有新增限制，也没有偷偷抬高时限或减少内容。该大历史实测未通过前，候选包不替换当前运行的 10.15.26.44。

复现命令：

```sh
RESULT_PATH=/tmp/tf-fulltext-live.json node --import tsx scripts/codex-first-long-history-smoke.mjs /Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex --live --large-history --resume-after --measure-followup
```

脚本已补充每次摘要的终止事件耗时、首次续聊/摘要复用/增量摘要的分开计时，以及失败时落盘的元数据。输出不含账号凭证或用户原始对话正文。
