# Windows / Linux 启动、切换与 TRAE 网页工具代码 Review

日期：2026-10-16。承接 `4b5c276` 的整页打开和页内查找修复，检查当前工作区相关实现。

## 验收范围调整

最初只读探测了已有远程连接：一台 Ubuntu 可连接，其他两条连接超时或无路由，未发现可用 Windows 设备。随后用户明确回复“那算了，你 review 一下代码，没问题就好”，因此停止远程部署及真机验收。本次没有向远程设备复制程序、账号凭据或测试数据，也没有安装远程依赖。

以下结论来自代码检查与在本机执行的回归测试，不能替代 Windows / Linux 真机验收。之前记录的 Mac Codex 及 16 并发结果继续有效，但没有扩大其平台覆盖范围。

## 已发现并修复

### Windows 迁移通过 Node 包装器启动 Codex

生产路径 `codex-runtime.ts` 遇到 npm 的 `codex.cmd` 时，过去启动 Electron/Node 执行 `bin/codex.js`，再由官方启动器创建原生 Codex 子进程。迁移客户端保存的是包装器 PID，结束时也只结束包装器；Windows 的终止行为可能使原生子进程仍在运行。此前网页验收脚本已经直接启动原生 exe，生产迁移路径却没有同步，验收脚本通过不能证明这条生产路径正确。

已改为从官方 npm 的嵌套依赖、提升依赖及历史 vendor 目录定位原生 `codex.exe`，覆盖 x64 / arm64、当前 bin 及历史 codex 目录。路径直接传给进程 API，不经过命令 shell；迁移保存和结束的 PID 就是原生运行时本身。仅剩 JS 启动器、缺少原生程序时明确报安装不完整，保留原有迁移失败处理和备份。

回归测试先在旧实现上失败，再验证修复：嵌套、提升、历史布局及 arm64 路径正确，中文/空格/`&` 路径无需 shell，不完整安装拒绝启动；原生独立安装及非 Windows 路径保持原行为。

### 只读进程检查误用桌面身份校验

当前工作区的 Windows `agentProcesses('codex')` 使用桌面应用 ASAR 身份校验，然而迁移自己启动的 CLI 运行时没有桌面 ASAR。`CodexThreadMigration.idle(ownPid)` 原本允许排除自己的 PID，但只读查询可能先抛出身份校验错误，导致这一排除逻辑无法执行。

已将 Codex 的只读检测单独前置，返回 `Codex.exe`、`CodexCLI.exe`、`ChatGPT.exe` 对应 PID，迁移再按自己的原生 PID 排除，其他运行中的 Codex 客户端仍会阻止迁移。实际关闭或启动 Windows 桌面应用仍通过 `WindowsAgentLifecycle` 校验路径、身份和启动时间，未放宽其关闭条件。此次误检发生在工作区正在调整的桌面生命周期接线中；本次提交将只读分支独立隔离并补回归保护，不包含其他尚未提交的桌面生命周期改动。

新增测试先复现只读查询抛错，修复后验证三类 PID 都能列出，迁移可排除自己的 PID，其余 PID 仍保留。原有未知应用、多个实例、PID 变化、退出未完成、启动未确认等重启保护测试继续通过。

## 其他检查结论

| 范围 | 结论及边界 |
| --- | --- |
| Windows 启动和 profile | 检查安装路径、APPDATA / USERPROFILE、legacy profile、Store 与 npm 入口、中文路径及目标平台原生依赖；相关配置与打包回归通过。没有新增 Windows 实机证据。 |
| Linux 启动和密钥存储 | 检查 XDG 配置目录、sidecar 路径、平台资源及 basic_text 后端处理；不把不可安全读取的加密账号当作可用凭据。没有运行 Linux 桌面程序。 |
| 模型切换与恢复 | 配置备份、版本校验、目录写入、多模型菜单、授权范围、配置漂移、旧对话迁移和回滚回归通过。 |
| Linux Agent 自动重启 | 当前仍明确不支持桌面 Agent 自动退出/重新打开；状态不宣称支持，用户需手动退出和重新打开。这是现有功能边界，本次未新增自动重启实现。 |
| TRAE 网页工具 | 整页读取与查找共用 Go 实现，无平台 shell 依赖；官方 API、默认缓存策略、分页、Unicode 定位、取消与客户端工具续接的执行器回归通过。 |

在以上范围内，没有发现其他需要立即修复的阻断问题；这不等同于整仓全部跨平台功能无缺陷。

## 最终验证和交付状态

- 13 个相关测试文件，178/178 通过，包含新发现问题的回归、Windows 重启保护、旧对话迁移、模型切换、TRAE 配置、profile、密钥与打包检查。
- `npx tsc --noEmit` 通过。
- `node scripts/test-native-catalog.mjs` 通过，包含 TRAE 搜索、整页和页内查找的实际执行器测试。
- 本次交付为源码修复和文档更新，没有重新打包或替换运行中的本机应用；Windows / Linux 真机状态仍未验收。

提交复核：从暂存区生成仅含本次 6 个文件改动的独立快照，5 个相关测试文件共 36 项通过，4 个源码/测试文件及其依赖的定向类型检查通过。独立快照的全仓类型检查因复用当前工作区依赖而遇到旧版 contracts 导出和 Playwright/ws 依赖不匹配，未计为通过；没有为提交本次修复而混入其他正在进行的重构或依赖改动。

复测：

```sh
npx vitest run tests/trae-acceptance-platform.test.ts tests/profile.test.ts tests/agent-lifecycle.test.ts tests/windows-agent-lifecycle.test.ts tests/codex-switch-lifecycle.test.ts tests/agent-connections.test.ts tests/trae-codex-config.test.ts tests/packaging-assets.test.ts tests/secrets.test.ts tests/agent-installation.test.ts tests/codex-runtime.test.ts tests/codex-thread-migration.test.ts tests/agent-processes.test.ts
npx tsc --noEmit
node scripts/test-native-catalog.mjs
```
