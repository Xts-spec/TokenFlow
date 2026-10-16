# TRAE 在 Codex 中的网页搜索兼容

日期：2026-10-16。承接 `0c9675b` 的截断、额度与账号展示修复。

## 原因与修复

Codex CLI 0.154.0 默认发送 `web_search` 声明，且默认 `external_web_access:false`。旧桥接只允许客户端函数/自定义工具，在调用模型前返回 `a2a_server_tool_unsupported`，连普通文件任务也会被整段拒绝。去掉测试配置中的 `web_search="disabled"` 后，真实客户端稳定复现。

从 TRAE 官方网站实际发布的 SDK 确认原生 `POST /api/ide/v1/web_search` 及请求格式，使用现有 TRAE 账号实测返回真实标题、来源 URL 和索引摘要。没有改用其他来源的账号，也不需要额外搜索 Key。

现在 TRAE Responses 路径会将搜索声明转换为仅网关执行的内部函数。模型提出搜索后，网关调用官方搜索接口，把实际结果交回同一账号、同一模型，并向 Codex 输出 `web_search_call`、搜索进度、真实来源及引用事件。客户端文件、命令和自定义工具仍由 Codex 执行，内部搜索函数不会泄漏给客户端执行。普通任务仅携带搜索声明时可以正常回答，不会被强制搜索。

长对话恢复时，将已保存的搜索记录还原为已完成的工具往返，保留查询与来源，避免每次工具结果返回后重新执行“先搜索”。不能恢复的网页正文没有补造。修复前一次任务可能重复搜索四次；修复后实机每个指定查询各执行一次。

支持 Responses 常用搜索声明及命名工具选择，保留其他工具、调用 ID、用户消息与用量；搜索次数有上限，官方请求有超时与取消。域名允许/阻止名单按结果 URL 的主机边界筛选。HTTP、业务错误或格式错误不会伪装成成功搜索，真实空目录也不会补出结果。

## 范围与默认配置

- 本报告对应最初的搜索修复：通过官方搜索索引返回摘要，当时尚未实现整页打开和页内查找。后续已补齐官方 WebFetch 整页读取与 `open_page`、`find_in_page`，保留默认缓存策略，详见 [整页与查找修复及跨平台复核](trae-web-pages-repair-2026-10-16.md)。
- TRAE 接入不写入关闭搜索的配置；切换前由其他来源管理的禁用设置会随接入记录恢复。用户主动设置的搜索偏好仍保留。
- 适配已验证美国区现有原生账号，不承诺其他地区或全部服务端内置工具。
- 默认目录异步加载，测试会等待当前模型注册完成，不能将 HTTP 端口已监听等同于账号模型已就绪。

## 验证与故障回放

离线回归覆盖真实执行器入口、流式与非流式结果、搜索引用事件、客户端工具混用、恢复后的搜索历史、用户与工具角色分离、域名过滤、取消、错误和循环上限。原有 Qoder、WorkBuddy 和共享协议测试通过。

真实 Codex 验收使用本机 CLI 0.154.0、已安装 TokenFlow sidecar、独立临时项目与配置。配置不包含 `web_search` 覆盖项。测试实际搜索两个查询，读取/写入/回读文件，验证约 6.6 万字符长上下文与两次退出后的同一会话恢复；不修改用户当前 Codex 配置或旧对话。结果见 [最终客户端记录](catalog-followup-2026-10-16/trae-web-search-codex.json)。这是 CLI 客户端验收，不是桌面界面自动操作会话。

另通过安装版 Responses 检查长历史下的搜索、函数调用、结果回传和完整最终文本，覆盖流式/非流式、默认缓存/允许联网声明；见 [最终并发记录](catalog-followup-2026-10-16/trae-web-search-stress.json)。

中间压力测试保留了失败证据：8 并发首轮 23/24，复跑 24/24；16 并发首轮 44/46。后者两个失败的原文均完整：一个把检索链接的语言路径改成英文，另一个在完整最终标记前增加解释。已核对实际请求中的用户/工具边界正确；引用事件增加标准 annotation 事件，工具说明明确要求保留真实来源的完整链接，复测提示也明确区分用户新请求与工具结果。没有截断、改写或过滤模型原文来让校验通过。初次 23/24 未保存具体回复，不能据此推断其内容。故障记录见 [中间结果](catalog-followup-2026-10-16/trae-web-search-before-final.json)。

## 最终结果

| 项目 | 结果 |
| --- | --- |
| 安装版 Codex CLI 默认配置、66,890 字符、同一会话 3 轮 | 全部通过；真实搜索 2 次，文件/命令工具 10 次，退出恢复 2 次 |
| 安装版 Responses，16 并发、100 轮历史、搜索→函数→结果续接 | 48/48 通过；流式/非流式、缓存/允许联网声明各半 |
| 离线真实执行器与共享协议回归 | 通过 |
| 默认配置及切换恢复、额度与账号回归 | 5 项通过；已在不含其他未提交改动的快照单独复核 |
| 本机替换、正常启动、签名和 ZIP 一致性 | 通过；HTTP 200，构建与安装的 sidecar 一致 |

签名、安装包与运行文件哈希见 [最终安装记录](catalog-followup-2026-10-16/trae-web-search-installation.json)。原始默认配置失败见 [复现记录](catalog-followup-2026-10-16/trae-web-search-repro.json)。

## 复测

```sh
node scripts/test-native-catalog.mjs
node scripts/test-sidecar-qoder.mjs
npx vitest run tests/trae-codex-config.test.ts tests/trae-quota.test.ts tests/account-label.test.ts
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 node scripts/test-trae-codex-installed.mjs
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 TRAE_INSTALLED_WORKERS=16 node scripts/test-trae-web-search-installed.mjs
```

真实验收会调用已授权 TRAE 账号，消耗其额度。报告不包含凭据；临时账号配置与测试项目在验收后清理。

协议依据：[OpenAI 网页搜索输出与来源格式](https://developers.openai.com/api/docs/guides/tools-web-search)、[TRAE 官方页面所发布 SDK](https://lf-static.traecdn.us/obj/trae-ai-tx/trae_website/static/js/main.6286bcee1d.js)。
