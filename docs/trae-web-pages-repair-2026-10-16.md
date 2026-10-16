# TRAE 在 Codex 中的整页打开、页内查找与跨平台复核

日期：2026-10-16。承接 `a059df0` 的网页搜索兼容。安装版仍为 10.15.26.6。

## 官方协议与修复

从 TRAE 官方网站发布的 SDK 确认 `WebFetch` 调用 `POST /api/ide/v1/web_fetch`，请求包含 `url`、`disable_crawl`、`disable_cache`、`offset`、`limit` 等字段。使用本机已授权美国区账号实际验证返回标题、正文、链接、`doc_id`、页起点及总 Token 数；请求只发送至官方 TRAE 接口，不向网页来源发送账号凭据。

不是把搜索摘要当作整页正文。原生接口分页存在一个已复现的陷阱：小窗口第一次只返回 12 Token；继续携带这次的 `fetch_id` 请求下一段，可能得到空片段而总量仍为 200。改用 URL 与接口返回的实际 Token 边界分页，并核对文档 ID、起点、前进量及完整总量。缺页、文档变化、无正文、超限或超时明确失败，不把部分页面标为完整，也不会据此报告“未找到”。协议探测摘要见 [回放记录](catalog-followup-2026-10-16/trae-web-pages-protocol.json)。

网关内部浏览工具现支持 `search`、`open_page`、`find_in_page`。打开页面返回标题、真实 URL、正文窗口、Unicode 字符偏移、`has_more` 与 `next_offset`；查找在已核对完整的正文中执行字面匹配，返回总命中数、行列和上下文，支持大小写选项。链接保留官方返回的目标地址。向 Codex 发出的动作遵循标准 `web_search_call.action`：打开含 URL，查找含 URL 与 pattern；普通文件/命令工具继续由客户端执行。恢复历史保留动作元数据，需要新任务正文时重新打开，不补造旧内容。

默认 `external_web_access:false` 原样映射为 `disable_crawl:true`，缓存缺失不会自动转为联网抓取；用户允许联网时才允许官方抓取。无需用户修改 Codex 搜索配置。缓存按账号与官方接口隔离，10 分钟过期，最多 64 个文档、8 MiB；单文档最多 1 MiB、16 段，读取总限时 30 秒。单次打开窗口默认 12,000 字符、最多 24,000；查找返回前 20 处上下文及全部命中计数。单次 Responses 内部浏览最多 8 次，并尊重客户端更小的限制。

## 安装与真机验证

已正常退出 TokenFlow，替换 `/Applications/TokenFlow.app` 和发布目录，重新签名并重建 ZIP。启动界面正常打开，原有账号与模型可见，无钥匙串或配置修改步骤。安装、签名及 ZIP 文件一致性见 [安装记录](catalog-followup-2026-10-16/trae-web-pages-installation.json)。

使用实际 Codex CLI 0.154.0，独立临时项目与配置，仅接入运行中的安装版，不覆盖默认搜索设置；原有用户配置和旧对话未用于测试写入。66,890 字符上下文、3 轮同一会话、2 次退出续接全部通过：实际整页打开 2 次、页内查找 3 次、文件工具 9 次，逐轮核对工具完成、文件内容及最终标记。详见 [Codex 客户端记录](catalog-followup-2026-10-16/trae-web-pages-codex.json)。这是实际 CLI 客户端验收，未声称桌面聊天界面自动操作验收。

安装版另跑 16 并发，每会话 100 对历史消息，执行打开整页 → 页内查找 → 客户端函数 → 回传后继续，共 64/64 请求通过。流式/非流式、默认缓存/允许联网各半；最终回复未做截断或改写。最长单次请求 19,102 ms，见 [并发记录](catalog-followup-2026-10-16/trae-web-pages-stress.json)。

离线真实执行器回归覆盖完整分页后的尾部命中、Unicode/换行定位、链接、动作事件、普通客户端工具、账号隔离、缓存并发、取消、缺页和错误。TRAE 浏览相关测试通过 Go 竞态检测；Qoder、WorkBuddy、共享协议回归及 TypeScript 检查通过。另从 `a059df0` 生成仅含本次改动的快照，单独跑过 TRAE 浏览竞态检测及 4 项配置/平台测试，排除工作区其他未提交修改的干扰。

## 跨平台 Review

| 检查项 | 发现与处理 | 验证范围 |
| --- | --- | --- |
| 配置路径 | 旧验收脚本写死 macOS 路径；现按桌面程序相同的 profile 优先级，兼容 APPDATA、XDG_CONFIG_HOME、历史目录及显式隔离目录 | macOS 实机；Windows/Linux 路径模拟测试 |
| Windows Codex 启动 | `.cmd` 依赖命令 shell，空格、`&`、中文路径和超时结束有风险；现定位官方 standalone/npm 内的原生 exe，直接启动 | 独立安装、npm 当前和历史目录布局模拟；未执行 Windows GUI |
| 文本位置 | 不用 UTF-8 字节数充当字符偏移；保留换行，emoji/中文及 CRLF 行列经测试 | 共用 Go 实现与单测 |
| URL 与本地路径 | 拒绝 file、Windows/UNC、本地/私网、非标准端口、歧义数字地址；不由本机直接请求来源网页 | 解析与过滤单测；官方接口实测 |
| 缓存和取消 | 有锁、按账号隔离、容量和时限有界；取消不继续抓取 | 16 并发、竞态检测、取消测试 |
| 可执行产物 | darwin-arm64、win32-x64、linux-x64 均编译成功，文件类型正确 | Mac 启动和安装版调用；Windows/Linux 未做 GUI 真机验收 |

以上是本次 TRAE 浏览改动及验收链路的定向 Review，不等同于整个项目所有跨平台功能验收。

后续按用户要求停止远程真机部署，继续检查生产启动和切换链路，发现并修复 Windows Codex 包装器进程及迁移 PID 检查问题；178 项相关回归通过。详见 [跨平台代码 Review 与源码修复](trae-cross-platform-review-2026-10-16.md)。这次源码修复未重新打包，Windows / Linux 真机状态仍未验收。

## 复测

```sh
node scripts/test-native-catalog.mjs
node scripts/test-sidecar-qoder.mjs
npx vitest run tests/trae-acceptance-platform.test.ts tests/trae-codex-config.test.ts tests/profile.test.ts
npx tsc --noEmit
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 TOKEN_FLOW_TRAE_WEB_PAGES=1 node scripts/test-trae-codex-installed.mjs
TOKEN_FLOW_TRAE_INSTALLED_LIVE=1 TRAE_INSTALLED_WORKERS=16 node scripts/test-trae-web-pages-installed.mjs
```

真实调用使用已授权账号并消耗其额度。持久报告仅保留测试结果及公开协议摘要，不含凭据、原始网页全文或用户对话。

依据：[TRAE 官方 SDK](https://lf-static.traecdn.us/obj/trae-ai-tx/trae_website/static/js/main.6286bcee1d.js)、[OpenAI web search](https://developers.openai.com/api/docs/guides/tools-web-search)、[Responses action 格式](https://developers.openai.com/api/reference/resources/responses/methods/create)。
