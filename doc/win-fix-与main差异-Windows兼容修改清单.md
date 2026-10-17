# win-fix 与 main 差异对照 —— Windows 兼容修改清单

> 生成于 2026-10-17，基准 `origin/main`（0f214cd），对比对象 `win-fix` HEAD（d11cde9）。
> 统计：32 个文件，+522 / -67 行。产品界面与使用逻辑以 main 为主，本分支全部改动均为 Windows 跨平台兼容与打包修复。

## 一、Agent 安装发现（packages/core/src/agent-installation.ts，+76 行）

| 修改 | 说明 |
|---|---|
| 新增 `windowsRegistryApp()` 注册表发现 | 遍历 HKLM / HKLM WOW6432Node / HKCU 的 Uninstall 项，按显示名前缀匹配（长度降序、防误匹配），从 `InstallLocation` / `DisplayIcon` 解析 exe 路径。任意盘符、任意自定义目录安装的桌面客户端都能被发现，不再依赖固定路径。带 60s 缓存。 |
| 新增 `AGENT_INSTALL_DIRS` 环境变量 | PATH 风格分隔的额外搜索根目录，支持 `根\应用名\应用.exe` 与 `根\应用.exe` 两种布局（macOS 侧支持 `根/应用.app`），便携版/免安装版可被发现。 |
| `desktopNames` 导出 | 供 windows-agent-lifecycle 复用同一份名称表做注册表查询。 |
| Store 版 codex.exe 选择改为按文件体积降序 | `Sort-Object -Property Length -Descending`，避免选中错误的小体积同名文件。 |

## 二、进程检测与生命周期（agent-connections.ts / windows-agent-lifecycle.ts）

### agent-connections.ts（+55 行）
| 修改 | 说明 |
|---|---|
| tasklist / CIM 查询超时 5000 → 15000 | Windows 冷启动 PowerShell/CIM 可能超过 5s，导致"无法检查 Agent 进程"误报。均为只读查询，放宽不影响安全性。 |
| 新增 `updateDeepseekEnv()` | 接入/修复 DeepSeek 时把网关 Key 写入 `~/.dsh/.env`（`DEEPSEEK_API_KEY=...`，0600 权限、临时文件原子替换）；移除/还原时清除。Harness 的 `needsWelcome = !loggedIn && !hasApiKey` 据此在每次启动（含用户手动启动）都能跳过欢迎页。apply / repair / restore 三处接线。 |
| `restoration()` / `restore()` 容错 | 配置被外部改动时 `restoredConfig` 失败则回退到备份原文，restore 支持 `overwrite` 选项，避免 Windows 上因换行符等差异还原直接报错卡死。 |

### windows-agent-lifecycle.ts（+91 行）
| 修改 | 说明 |
|---|---|
| ASAR 元数据读取加 `process.noAsar` 保护 | TokenFlow 自身以 asar 打包运行时读取目标应用 app.asar，需临时关闭 Node 的 asar 透明解包，否则读自己包内路径会失败。 |
| 新增 `codexCliWindowsIdentity()` | 通过路径特征（OpenAI\Codex、WindowsApps、node_modules\@openai）识别 codex.exe / codexcli.exe 身份，未知进程不再阻塞自动化。 |
| 生命周期候选加入注册表发现结果 | `candidates()` 在固定根之外追加 `windowsRegistryApp` 命中项。 |
| 优雅关闭增强（TokenFlowCloser） | `CloseMainWindow` 后仍存活的进程，用 Win32 `EnumWindows` + `EnumDesktopWindows` 向其全部窗口发送 WM_CLOSE/WM_QUIT/WM_ENDSESSION（带 1s 超时），覆盖托盘窗口与多桌面场景；仍不强制结束进程。 |

## 三、网关与来源检查（service.ts / cliproxy.ts）

| 文件 | 修改 | 说明 |
|---|---|---|
| service.ts | 最小调用检查弃用 `app.inject` | 打包版（asar）运行时冷加载 light-my-request 失败；改为服务已监听时走真实 loopback `fetch`（45s 超时），测试未绑 socket 时保留 inject。 |
| service.ts | restore API 增加 `overwrite` | 与 agent-connections 的还原容错配套。 |
| cliproxy.ts | .js/.cjs/.mjs 二进制用 node 启动 | `spawn` 直接执行脚本文件在 Windows 上会走 ShellOpen 拦截/失败，改为 `process.execPath <脚本> -config ...`。 |

## 四、桌面应用（apps/desktop/src/main.ts / startup-window.ts）

| 修改 | 说明 |
|---|---|
| `uiRoot` 优先指向 `app.asar.unpacked` | **图标 404 长期 bug 的根因修复**：@fastify/static（send 1.x）在 Windows 无法从 app.asar 内提供静态文件（磁盘路径 200 / asar 路径 404）。配合 asarUnpack 把 `dist/console/**` 解包到磁盘。 |
| 启动窗口与主窗口 Windows 焦点修复 | show 后 `setAlwaysOnTop(true→false)` 抢焦点；`startup.focus()` 最小化时先 restore；`second-instance` / `activate` 在无主窗口时聚焦启动窗口。解决启动后窗口不置前的问题。 |

## 五、打包链路（scripts/ + package.json + .gitignore）

| 文件 | 修改 | 说明 |
|---|---|---|
| package.json | `build.win.icon` 改为 `app-icon.ico` | electron-builder 的 win.icon 用 PNG 会被静默忽略导致 exe 无图标；新增含 256×256 共 7 尺寸的 ico（mac 侧误同步为 ico，见"遗留备注"）。 |
| package.json | asarUnpack 增加 `dist/console/**` | 配合 uiRoot 修复。 |
| before-pack.cjs | Windows 用 System32 bsdtar 解压 tgz | GNU tar 把 `d:\code` 解析为远程主机（"Cannot connect to d"）。 |
| clean-package.mjs | 改用 cmd `rmdir /s /q` 并允许跳过 | 宿主沙箱把 fs.rm 挂成失败回收站操作、杀软锁定句柄时不再中断构建；目录仍占用则警告后继续。 |
| fetch-upstream.mjs | git apply 加 `--ignore-whitespace` | Windows 换行符差异导致 cliproxy 补丁应用失败。 |
| official-catalog-overlay.mjs / provider-login-overlay.mjs | 读取源码统一 `\r\n → \n`，且尊重前序 overlay 链 | CRLF 与多补丁叠加问题。 |
| .gitignore | `release*/`、`release-build/` | 统一忽略全部打包产物目录。 |

## 六、启动脚本（新增）

- `启动TokenFlow.bat`：启动 release 打包版（UTF-8 代码页），优先 `release\win-unpacked`，回退验收目录。
- `启动TokenFlow.vbs`：无控制台窗口静默启动（注意：内含本机绝对路径 `D:\code\TokenFlow\...`，仅本机使用，换机器需改路径）。

## 七、Windows 本机端到端测试（新增）

| 文件 | 说明 |
|---|---|
| `scripts/run-all-windows-e2e.mjs` | 一键串跑 8 项真实环境测试（真实 Codex CLI 握手、真实 Desktop Service、无边框窗口、启动窗、账号加载、Agent 启动、网络诊断、原生垃圾清理），汇总通过率。 |
| `scripts/test-real-codex.mjs` | 真实定位 Windows 迁移用 Codex CLI 二进制并启动 RPC 会话客户端握手。 |
| `scripts/test-real-desktop-service.mjs` | 真实创建 Desktop Service、监听本地端口、验证 settings / local-agent / providers probe 接口与优雅关闭。 |
| 各 ui-check 脚本 | 渲染等待 120→250 轮；清理临时目录加 `maxRetries:3, retryDelay:100`（杀软句柄延迟释放）。 |

## 八、测试配套（tests/，+68 行）

- `agent-installation.test.ts`：注册表发现（mock PowerShell）、`AGENT_INSTALL_DIRS` 两种布局、Store codex 体积排序。
- `agent-connections.test.ts`：`~/.dsh/.env` 写入与清除（apply/repair/restore 全链路）。
- `windows-agent-lifecycle.test.ts`：codexCliWindowsIdentity 路径识别、ASAR noAsar 保护。
- `a2a-service.test.ts` / `codex-thread-migration.test.ts`：restore overwrite 语义与 mock 适配。

## 九、README 文档

- 增加"本地 Agent 桌面客户端安装位置不限于系统默认目录"说明：注册表卸载信息发现 + `AGENT_INSTALL_DIRS` 用法示例。

## 遗留备注

1. `package.json` 的 `build.mac.icon` 被同步改成了 `.ico`（本意只改 win 侧）；mac 上 electron-builder 对 ico 容忍度未知，**下次在 mac 打包前建议改回 `app-icon.png`**。
2. `启动TokenFlow.vbs` 含写死的本机绝对路径，仅作本机便利脚本。
3. `agent-installation.test.ts` 在 Windows 有 5 个预存在失败（`automatic` 在 win32 恒 false），与本次改动无关（stash 对照已确认基线相同）。
