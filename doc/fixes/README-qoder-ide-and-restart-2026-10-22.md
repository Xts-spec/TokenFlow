# Qoder IDE 识别、重启与账号切换修复（2026-10-22）

补丁：`qoder-ide-and-restart-2026-10-22.patch`（8 文件，基于 `win-fix` HEAD `39b9110`）

## 应用方式

```bash
git apply doc/fixes/qoder-ide-and-restart-2026-10-22.patch
```

已在干净 worktree 上验证：`git apply --check` 通过，应用后的 `git diff --stat` 与开发工作区逐字节一致。

## 背景

本机安装 Qoder IDE 1.106.3（`C:\Users\<user>\AppData\Local\Programs\Qoder IDE\`）后实测发现 TokenFlow 完全无法识别它，独立应用 Qoder 的重启按钮失灵，且两个入口的账号切换都不可用。根因是五处硬编码假设与真实安装形态不符。

## 五处修复

### 1. 可执行文件名：`Qoder.exe` → `Qoder IDE.exe`

`product.json` 中 `win32ExecutableName` 为 `"Qoder IDE"`，1.106 起主程序改名。

- `windows-agent-lifecycle.ts`：`apps['qoder-ide'].images` 增加 `'Qoder IDE.exe'`，保留 `'Qoder.exe'` 兼容旧版本
- `agent-installation.ts`：`desktopCandidates` 由单一 `exe` 改为 `executables` 数组，两种文件名都探测

### 2. 包名：`Qoder` → `Qoder IDE`

`resources/app/package.json` 的 `name` 为 `"Qoder IDE"`，原代码要求严格等于 `'Qoder'`。

改为 `^qoder(?:[ -]ide)?$/i`，同时接受 `Qoder`、`Qoder IDE`、`qoder-ide`（Linux 包名）。真正起鉴别作用的是 `product.json` 的三项（`win32AppUserModelId`、`applicationName`、`dataFolderName`），均未放宽。

### 3. IDE 内置的同名 `Qoder.exe` 污染独立应用

Qoder IDE 会启动 `resources\app\resources\bin\x86_64_windows\Qoder.exe`，与独立应用主程序同名。它没有包元数据，识别结果为 `undefined`，触发「未知进程」保护，直接阻塞独立应用的重启。

新增识别 `qoder-ide-helper`：路径匹配 `[\\/]qoder ide[\\/]resources[\\/]` 时归为 IDE 的内部组件，视为已知的其他应用而忽略。

### 4. Crashpad 上报进程拖住「尚未退出」判定

这是**重启按钮无效的直接原因**。Qoder 主进程关闭后，Electron 的 `--type=crashpad-handler` 子进程仍存活，且持有相同的 exe 路径与名字。`processes()` 把它计入存活列表，40 次轮询后判定「尚未退出」。

修复：进程查询时一并采集 `crashReporter` 标志，这类进程不再计入。它与 Codex 已有的「忽略崩溃上报进程」设计保持一致。

### 5. 账号切换被误判为「自定义配置目录」

**这是账号切换不可用的直接原因。** 原判定是「命令行中出现 `--user-data-dir` 或 `--profile` 即视为自定义资料」。但 Qoder IDE 的每个 Electron 子进程（GPU、网络、渲染、node service）命令里都带 `--user-data-dir`，值就是默认的 `%APPDATA%\Qoder`。因此即使用户从未修改过配置，也会被拒绝切换账号。

修复：改为提取该参数的实际值，与 `qoderIdeUserDataPath()` 归一化比较，仅当路径真正不同于默认值时才拒绝。防护语义不变（IDE 与独立应用确实使用不同数据目录，仍需保护），但判据从「参数是否存在」改为「路径是否偏离默认」。

## 附：单模型固定 Key 的越权改写

`service.ts` 原逻辑对任何模型名都静默改写为固定模型，绕过了后续授权校验。收敛为只接受固定模型自身的原生 ID（`dfmodel` → `qoder/dfmodel`），其他模型交由授权校验返回 403。

> 需要说明：此前「所有 Qoder 模型都走 dfmodel」的结论是**测试方法错误**导致的误判——使用的 Key 只授权 `dfmodel` 一个模型。用多模型 Key 复测，5 个模型全部正确路由。此项修复针对的是授权边界，不是路由缺陷。

## 验证

**端到端（真实环境）**

- Qoder 重启返回 `200 {"message":"Qoder 已重新打开"}`，重启后 9 个进程、主窗口正常、状态 `configured`、无错误
- 用 Qoder 写入的 Key 发真实请求：`200`，模型 `qoder/dfmodel`
- Qoder IDE 登录读取：`signed-in`，11 个进程，`unavailableReason` 为空
- Qoder IDE 账号切换：`200`，`backup.state = applied`
- Qoder IDE 登录恢复：`200`，`backup = null`

**回归测试**

- `windows-agent-lifecycle` + `qoder-ide-login`：61/61 通过（新增 4 项：IDE 包名变体、两种 exe 文件名、crashpad 拖累重启、默认 `--user-data-dir` 不再误判）
- `a2a-service` 15/15 通过（新增 1 项：单模型 Key 只接受原生 ID）
- `agent-installation` 新增 1 项候选路径测试通过

**构建**

- `tsc --noEmit` 通过，`npm run build` 通过

## 已知未覆盖

- `agent-connections`（1）、`agent-lifecycle`（1）、`agent-processes`（4）仍有失败，数量与本补丁**改动前的基线完全一致**，属 Windows 平台预存在问题（`automatic` 在 win32 恒为 false 等），非本次引入。
- Qoder 独立应用的账号切换未完成端到端验证：切换要求先退出应用，实测时该应用正在生成任务、主进程不响应关闭，未强制结束以免中断工作。凭据刷新与可切换账号识别已验证。
- Qoder 独立应用账号池中仍有一条过期凭据（`whaiyang.wang@zhaopin.com.cn`），需在账号页手动删除；本次改动不处理历史凭据清理。
- Qoder IDE 的用量采集未验证：新安装的 IDE 没有对话记录（`chat_message = 0`），采集器无数据可读。

## 其他 Agent 排查结论

用同样的方法把本机所有 Agent 的真实安装数据跑了一遍 `windowsAppIdentity`：Claude（Store）、Claude helper、Codex（Store）、Codex CLI、WorkBuddy、WorkBuddyAI、DeepSeek Harness、Qoder 全部识别正确，**只有 Qoder IDE 存在上述问题**。

WorkBuddy 国内版与国际版共用包名 `@genie/workbuddy-desktop`，依靠 `productName`（`WorkBuddy` vs `WorkBuddy AI`）区分，实测可靠。该分支对未知 `productName` 返回 `undefined` 是**有意的保守设计**（宁可不识别也不误判成其他 Agent），已有测试覆盖，未改动。
