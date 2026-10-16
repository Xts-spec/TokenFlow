# Windows 兼容问题与实机接手说明

记录日期：2026-10-16；最近补充：2026-10-17。旧 Windows 包基线：v10.15.26.12，提交 `b5c30fd`；Windows 标题栏修复基线为 `5fe1177`。M 芯片 Mac v10.15.26.13 已安装核对，交付记录提交 `172c361`，不代表 Windows 已打包或实测通过。

文档入口见 [项目文档](README.md)；当前待办统一在 [TODO](TODO.md) 维护。Claude 和反重力的渠道／来源统计分别对应 USAGE-001、USAGE-002、USAGE-003；全部客户端直连采集范围对应 USAGE-004，本页保留 Windows 执行步骤，不另行维护重复状态。

## 仓库与交付约定（按用户最新确认）

本次继续使用 **https://github.com/haruinia/TokenFlow.git**。当前开发机的远程别名为 `TokenFlow`，`main` 跟踪 `TokenFlow/main`。用户已确认保留这个仓库，请在这里做 Windows 功能测试、修复并提交结果。

新克隆默认可能叫 `origin`，不必把别名改成 `TokenFlow`；以远程 URL 和实际提交号为准。交付记录必须注明 `git rev-parse HEAD` 和设置页版本号，不能仅以 v10.15.26.12 判断是否包含 `5fe1177` 的窗口修复。

## main 与 win-fix 的同步交接（2026-10-17）

这是本次文档补充前的提交快照，后续两边继续提交时应重新核对，不能把下表当作永远有效的分支状态：

| 项目 | 提交 |
| --- | --- |
| 共同祖先 | `32fa0e8ba3e02d78467618721b5af834671a5d24` |
| 本地 main（补充文档前） | `42065c92c9e14c9bfe5661c6e4ca87a1731c24d0` |
| TokenFlow/main（本次检查时） | `66c65e810c93af1b723217c2abd676b46c50034d` |
| TokenFlow/win-fix | `2c3815e6fcb59195d17207c6ec13aa433f7095f7` |
| 分叉后的提交数 | 本地 main 独有 12 笔，win-fix 独有 7 笔；本次推送还将包含后续交接文档提交 |

本次只补充交接记录，不合并或改写 `win-fix`。已发布提交保持原提交号；不要为了补提交说明而 amend、重写历史或强制推送。Windows 接手者同步时需要同时保留两边修改，不能用整文件覆盖解决冲突。

下列提交表是当时快照。后续 Cursor 原生直连已在 main 接入并完成 macOS 实测，当前范围见 [USAGE-004](TODO.md) 与本页 U13，不再按 `66c65e8` 时的“尚未接入”判断。

### main 的问题、改进与对应提交

| 提交（按先后顺序） | 遇到的问题与原因 | 已完成的改进／交接重点 |
| --- | --- | --- |
| `709122d` | CC Switch 等改过接入字段后，差异保护阻止普通应用，维修入口过于间接。 | 增加明确确认后的“重新应用”，保存替换前原文并校验确认版本；仅检测或取消不写入，损坏／权限错误不强行覆盖。关联 CONFIG-001。 |
| `6cd4c3a` | 当前说明、待办与历史报告散落，容易把历史验证当作当前结果。 | 集中到 `doc/`，TODO 维护当前状态，`testing/` 维护验收，`archive/` 保留历史。同步时保留路径迁移与导航。 |
| `8c8e37e`、`44f727c` | WorkBuddy 原生选择器在名称与 ID 不同时追加 `:ID`，出现 `qoder/GLM-5.3-Flash:qoder/gfmodel`。 | 客户端使用可读的模型名称／ID，`modelAliases` 在内部映射回网关路由；需同时保留配置导出、路由、权限和统计映射，不能只改显示文字。旧接入需重新应用。关联 MODEL-001。 |
| `f190438` | 把官方登录与自定义模型混为互斥状态，使用网关后官方账号错误地取消选中。 | WorkBuddy、WorkBuddyAI、Qoder 保留官方登录与独立自定义模型；切换／还原登录不删除自定义模型或撤销其 Key。Codex、Claude 仍区分官方／网关模式，地区及客户端身份仍隔离。关联 LOGIN-001。 |
| `dd08bf7`、`1072a5f` | 刷新只重读登录、未查询额度；账号重复切换、标题跳动、加载提示叠加，部分图标资源过时。 | 强制刷新供应商额度；本机账号防重复切换；统一标题／版本和额度详情，避免重复加载提示；核对并更新官方图标。原因和逐项验证见[界面记录](testing/interface-and-icons.md)。 |
| `be7a0b9`、`797f8c7`、`3eea483` | 应用自身安全存储初始化早于说明，系统先弹钥匙串；选择页与加载页各自居中导致品牌跳动。 | 先绘制说明并等待选择，再初始化安全存储与服务；选择页沿用普通加载页，品牌共用节点与占位，选择后才显示动画。“暂不读取”跳过外部客户端安全存储，仍加载 TokenFlow 自己的已保存账号。 |
| `66c65e8` | 反重力原生 SQLite 没有直连采集；历史账号归属及网关排重不完整，未采集容易被误认为零。 | 增加只读 SQLite／protobuf 用量采集、连续登录观察、历史未知归属、WAL 重扫与去重；界面展示采集覆盖和缺口。关联 USAGE-002／USAGE-004。 |
| `66c65e8` | Cursor SDK 已给 usage 时跳过官方账单，真实调用出现 SDK 输出 5、官方同一 agent 输出 29 的差异。 | 优先使用同一 fresh agent 的官方明细，不可用才回退 SDK；增加回归并真实复测响应、账本、官方明细一致。**这是网关对账，Cursor 原生直连仍未接入。** |
| `42065c9` | 原启动主入口测试停在服务监听前，界面只比最终位置，不能证明完整交接及中间绘制顺序。 | 补齐允许／跳过、安全存储可用／不可用组合；断言加载绘制先于安全存储、工作台显示后关闭启动页，逐帧核对品牌坐标和说明／动画互斥。具体结果与系统授权边界见[界面记录](testing/interface-and-icons.md)。 |

命名的复现和测试见 [WorkBuddy 模型名称](testing/workbuddy-model-labels.md)，账号并存见[官方登录与自定义模型](testing/official-login-coexist.md)，用量的字段、范围和实测见[客户端直连用量](testing/native-direct-usage.md)。具体未完成项只在 [TODO](TODO.md) 维护。

### 66c65e8 的关键实现与验证边界

- 反重力仅从 `gen_metadata` 读取调用，`steps` 复制的用量不再次累加；输入已包含缓存，思考输出不再额外相加。只支持已确认的 SQLite `user_version=1`，旧 `.pb` 和其他结构保持待适配。
- 真实本机只读核对 1 个数据库、45 次生成：输入 2,014,552（包含缓存读取 1,800,288）、输出 20,171。这 45 次旧调用没有历史登录观察，保持未关联，不能分配给当前授权账号。
- 登录补充归属只覆盖两次相同身份、间隔不超过 15 秒的观察之间；不跨启动、休眠或切换补历史。过期／停用授权仍可识别历史，多份授权合并代表记录；地区、企业、组织和项目保留隔离。
- 网关排重在首次解析也校验已保存的 response hash，避免仅在缓存重扫时生效。无请求渠道证据时，不因当前已登录就把自定义调用认作官方。
- Qoder 观察必须沿用启动安全存储选择；不得为了补用量而提前触发钥匙串、读取登录备份或改写客户端配置。
- Cursor 修复后真实调用为输入 1,994、输出 5、合计 1,999，HTTP 200，响应／账本／同一 agent 的官方明细一致；已只读确认与本机 IDE 同账号。原生设置页只有汇总百分比，不能用其变化证明单次 Token。
- 本轮 16 个用量／账号测试文件的 93 项、Cursor 的 40 项回归通过，类型检查和生产构建通过；反重力生产 Worker 只读验证通过。这里不是全仓库测试全部通过，也不是 Windows 实机通过；**66c65e8 没有更新安装包**。
- Cursor 原生直连、Kimi／ZCode／Trae／Grok 采集仍待完成；WorkBuddyAI 同格式 JSONL 入口已接入，但本机旧版 local_storage 和全部版本未验证；Claude Intel 安装版历史归属问题仍未关闭。不得把账号授权成功写成全部客户端直连统计已完成。

### win-fix 已有改动与合并注意点

以下是远程分支的提交与源码审阅结果，**本机没有执行这些 Windows 实机测试**，不替代接手者提交的测试报告：

| win-fix 提交 | 已有改动范围 |
| --- | --- |
| `0de3eaf` | 商店 Codex CLI 路径识别、JS sidecar 启动、SQLite 锁和 Electron 测试清理。 |
| `d3e263d` | Windows 换行符／`git apply` 兼容及 sidecar 编译。 |
| `6534de8` | a2a-service 的 Windows 生命周期 mock 与实机测试入口。 |
| `4652c2b` | Windows 客户端便捷启动脚本。 |
| `1394150` | Windows 本机全量真实端到端测试入口。 |
| `9a2ab19` | Codex CLI／后台进程的路径及身份识别。仍需覆盖误识别、权限差异和多安装实例。 |
| `2c3815e` | 便捷启动兼容 `release\win-unpacked\TokenFlow.exe`。 |

本快照中，两边共同修改过的文件及需同时保留的行为：

| 文件 | main 的变化 | win-fix 的变化 |
| --- | --- | --- |
| `packages/core/src/agent-installation.ts` | WorkBuddyAI 独立安装／版本检测。 | 商店 Codex CLI 的候选路径选择。 |
| `packages/core/src/cliproxy.ts` | `nativeUsageAccounts()` 提供历史归属所需账号元数据。 | JS sidecar 使用 `process.execPath` 启动，并保留配置参数。 |
| `tests/a2a-service.test.ts` | 确认后重新应用、取消及配置版本冲突测试。 | WindowsAgentLifecycle 的 stop/open mock、平台断言与清理。 |

共同修改不一定产生文本冲突；自动合并成功也需要验证行为。建议完整合入 main 的连续改动，再按本文和后续清单验收；只摘取 `66c65e8` 会遗漏此前的接入、命名、登录与文档依赖。不要用整份 main 文件覆盖 win-fix 的进程、启动或测试适配。

同步后先运行类型检查、构建及相关源码回归，再执行 Windows 的进程重启、备份／恢复、账号授权和切换、CC Switch 重新应用、官方／自定义并存、启动读取选择、窗口与托盘、SQLite 占用及直连用量检查。下文清单中的 Windows 项目仍按“未测”开始；新增测试脚本的存在不等于这些场景已经通过。

## 1. Codex 重启、备份对话与切换环境失败（待实机定位）

### 已收到的现象

用户提供了一段约 12.4 秒的 Windows 手机录屏：在 TokenFlow 的 Codex 页面发起“重启 Codex 并应用更改”后，操作框持续显示准备切换／处理中；录屏范围内未看到 Codex 成功重新打开。用户反馈备份对话、自动重启失败，之后手动重启和切换环境也无法完成。

录屏未覆盖最终错误、后台日志和完整等待时间，**不能确认对话备份已经完成，也不能确认根因就是找不到进程**。截图／录屏中的安装版本未确认，不能把旧版本画面直接视为当前 main 的复现。原视频和账号截图未提交到仓库。

### 当前代码实际流程

- `packages/core/src/codex-switch-lifecycle.ts`：停止 Codex → 执行配置／历史迁移操作 → 打开 Codex；切换阶段为 `stopping / changing / opening`。
- Windows 分支调用 `WindowsAgentLifecycle.stop('codex')`，随后检查桌面端或 CLI 是否仍在运行，才执行变更。
- `packages/core/src/windows-agent-lifecycle.ts`：核对 PID、启动时间、可执行文件路径、Electron 应用身份；无运行进程时查询常见安装目录和 `OpenAI.Codex` 商店安装清单。
- **没有运行中的进程不一定会失败**：如果能确认唯一安装入口，仍可启动。无法确认进程身份、安装入口，或者 CLI 仍在运行，才会阻止后续操作。
- 配置操作失败时不自动打开客户端，避免客户端覆盖迁移中的状态；配置已完成但打开失败时，错误应明确说明“配置已完成，但未能重新打开”，不能把这两种情况混淆。

### 优先验证的假设

1. 进程识别／权限：桌面端、CLI、后台 helper 被混淆；跨权限读取路径失败；商店版本的程序身份与当前白名单不符。预测：错误发生在 `stopping`，配置／备份尚未开始。
2. 启动入口识别：商店注册查询失败、安装在非标准目录，或进程已退出后新建的生命周期对象无法重新定位此前安装。预测：配置可能已完成，但 `opening` 失败；手工从正确快捷方式打开仍然可用。
3. 退出未完成或启动确认过慢：保存对话框、托盘驻留、CLI 残留、PowerShell/CIM 多轮查询耗时。预测：仍能找到目标 PID，或已出现新 PID，但 TokenFlow 尚未完成确认。
4. 配置／对话迁移本身失败：文件占用、权限、锁、数据库写入错误。预测：失败在 `changing`，应保留可恢复备份并报告具体阶段。

### Windows 接手者需要收集

- TokenFlow 设置页完整版本号；Codex 桌面端版本、安装来源（商店／独立安装／便携目录）、是否另有 CLI。
- 重现前是否正在运行 Codex；是否在系统托盘；TokenFlow 和 Codex 是否以不同权限运行。
- 一次完整重现的起止时间、最终提示和运行日志。记录 `stopping / changing / opening`、是否已生成备份、配置是否写入、是否提交启动请求。
- 只记录进程 PID／父 PID／启动时间／可执行文件位置和安装入口验证结果。不要上传 Token、认证文件、完整命令行、完整对话或账号截图。
- 分别测试“原进程运行”“原进程已关闭”“另有 CLI”“商店安装”“非默认目录”“保存提示未关闭”六种情形。

### 建议修复范围与验收

- 先建立可重复的失败用例，再修改进程／安装身份判断；不要按进程名字强杀或删除安装身份校验来绕过问题。
- 操作界面报告真实阶段与耗时，后台命令失败时可定位；不能一直停留在泛化的“处理中”。
- 核对商店包身份和正确启动入口；如果需要记住安装位置，应在每次使用前重新验证身份，不能执行未经验证的路径。
- 退出失败／存在未确认实例时不写配置、不启动重复实例；迁移失败保留备份；只在确认配置变更完成后尝试启动一次。
- 自动启动失败时，明确告知配置是否完成、备份是否可用，以及通过哪个受验证的入口手动打开。
- 修复后需同时验证：备份／恢复对话、切换官方账号、接入和断开 TokenFlow、独立“重启 Codex”。

### 本机可运行的现有回归

```sh
npx vitest run tests/windows-agent-lifecycle.test.ts tests/codex-switch-lifecycle.test.ts tests/codex-thread-migration.test.ts tests/codex-accounts-service.test.ts
```

当前开发机为 macOS。PowerShell、AppX、CIM、商店应用重启和真实进程退出行为无法在这里完成端到端验证，此项仍为待修复／待实机定位。

## 2. Windows 窗口标题栏与页面不融合（代码已调整，待 Windows 验收）

### 截图中的问题

原生标题栏和 `File / Edit / View / Window` 菜单占用额外两行；浅色系统标题栏与深色页面割裂。启动窗口与工作台都需要统一。

### 本轮代码调整

- `apps/desktop/src/window-options.ts`：Windows 采用隐藏原生标题文字的窗口样式，保留系统窗口控制按钮，以 40px 控件覆盖层融入应用；启动页和工作台共用配置。
- `apps/desktop/src/main.ts`：Windows 启动时移除应用菜单，避免按 Alt 又显示菜单；通过受限、校验来源的主题消息同步原生窗口按钮颜色。
- `apps/desktop/src/preload.ts`：仅暴露深色／浅色主题设置，不能执行任意窗口命令。
- `apps/console/src/main.tsx`、`flow.css`：增加 Windows 拖动区域，给内容和全页弹窗预留顶部空间，保留系统按钮点击区域；深浅主题同步。
- 沿用已有主窗口关闭行为：点 × 隐藏到系统托盘，选择菜单“退出 TokenFlow”才退出程序。

### 实机验收清单

- 冷启动、启动确认卡片、工作台均无 File/Edit/View/Window 菜单，Alt 不重新展开菜单。
- 最小化、最大化、恢复、关闭按钮可用，标题栏空白处可拖动；测试 Windows 11 Snap、双击标题栏、100%／125%／150% 缩放和多显示器。
- 深色／浅色切换后系统按钮仍清晰；窗口失焦、最大化、恢复时没有额外浅色条。
- 顶部导航、账号按钮、全页弹窗未被窗口按钮遮挡；窗口宽度最小 900px 时仍可操作。
- 主窗口点 × 后网关继续可用，托盘可重新打开；选择退出后不残留受管网关进程。

### 本机验证范围

窗口配置单元测试、构建、模拟 Windows 平台的页面布局和主题消息可在 macOS 验证。真实 Windows 系统按钮、DPI、Snap、菜单行为仍需实机确认；不要据此写为“Windows 已完全修复”。

本轮验证：上述 Windows／Codex 回归加 `tests/window-options.test.ts`，共 78 项通过；`npm run typecheck`、`npm run build` 通过。页面模拟可运行：

```sh
npx electron scripts/windows-window-ui-check.cjs
```

该检查只模拟渲染进程的平台标记，验证拖动区域、顶部留白、最小宽度和主题消息；不是 Windows 系统按钮实测。现有 v10.15.26.12 安装包不包含本轮窗口修改，需从更新后的 main 重新构建 Windows 包验收。

参考：Electron 官方窗口标题栏文档：<https://www.electronjs.org/docs/latest/tutorial/custom-title-bar>。

### CC Switch 等工具改动接入配置后的重新应用（代码已调整，待 Windows 验收）

截图中的“接入配置与上次记录不同”是接入字段差异检查，与已取消的密钥类型白名单无关。首次接入已有第三方配置可以写入；已有 TokenFlow 接入记录后，第三方修改地址、Key 或模型会导致普通切换无法安全逆向原改动。此前只能走维修方案，入口过于间接。

- 本地 Agent 页面现在显示“重新应用”。启动开关、应用模型也会在存在差异时进入同一确认流程，无需先删除接入记录。
- 确认后使用现有接入重写逻辑，先保存本次替换前的完整配置，再更新接入所需字段；其他 provider、MCP、权限与偏好设置保留。备份中 `previousConfig` 是替换前原文，仅存本机，不能上传或复制到运行日志。原有恢复入口仍按接入备份的规则恢复，不是 CC Switch 的配置历史管理器。
- 只检测到变化、打开确认、取消均不写入。确认绑定看到的配置版本；确认后其他程序再次写入时返回冲突，关闭确认并重新操作。格式损坏、软链、权限错误不会被强行覆盖。
- Codex 确认中说明自动退出、应用与重新打开，合并为一次确认；Windows 能否正确识别和重启进程仍按第 1 节实机验证。
- 已在 macOS 宿主通过 `tests/a2a-service.test.ts`、`tests/agent-connections.test.ts`、`tests/agent-model-switching.test.ts` 共 67 项回归、类型检查与构建；新增 `scripts/agent-reapply-ui-check.cjs` 验证真实构建界面的确认、取消、版本冲突与启动开关。这些是隔离夹具结果，**尚未验证真实 Windows + CC Switch 共存**。

## 3. Windows 全功能测试的执行规则

以下把 macOS 开发机上的测试资产、已确认结果与人工验收场景转成 Windows 接手清单。**每个 Windows 用例初始都为“未测”**；代码测试存在、macOS 上通过、页面模拟通过，都不能直接标记 Windows 实机通过。

### 环境与结果要求

- 优先用 Windows 11 x64 普通用户；如需支持 Windows 10，再完成一轮关键用例。记录系统版本、CPU 架构、终端版本、Node/npm/Go 版本、客户端版本、代理模式、安装渠道和完整提交号。
- 用可恢复的测试资料：至少两个可切换的测试账号、一个已有 Codex 对话历史的测试配置、一个中文且含空格的目录。先保留原配置和历史对照；涉及清理的用例只操作测试文件。
- Codex 至少覆盖商店安装与独立／非默认目录；客户端和 TokenFlow 都以普通权限运行作为基线。管理员／普通用户混用单独记录。
- 优先级：P0 为启动、账号授权、数据保存、真实调用、Codex 重启与对话恢复、托盘退出；P1 为其他客户端、额度、API Key、用量、维修；P2 为 DPI、多显示器、拖动和异常边界。全功能交付仍需覆盖所有项。
- 结果只用 `通过 / 失败 / 阻塞 / 不适用`，每项写环境、耗时、证据和复现步骤。“不适用”必须说明缺少哪种客户端／账号，不能用它代替失败。
- 日志只保留阶段、错误类别、状态码、耗时、脱敏路径和进程信息；不要提交认证文件、Token、Key、带 code/state/token 的授权地址、真实对话内容或未脱敏账号截图。
- 每个平台都要从**最终打包的 Windows 程序**再跑 P0，开发模式成功不能代替安装包验收。

### 构建与基础自动化（PowerShell，仓库根目录）

准备 Git、Node.js（满足 package.json 的 engines，目前 >=22.19）、npm、Go，以及 Windows 自带 `powershell.exe`。先拉取本仓库 main 并记录提交号，工作区修改不要用强制重置覆盖。

```powershell
git remote -v
git rev-parse HEAD
npm ci
node scripts/fetch-upstream.mjs
node scripts/build-sidecar.mjs win32-x64
npm run typecheck
npm test
npm run build
npx electron-builder --win zip --x64 --publish never -c.directories.output=release/windows-acceptance
```

该打包命令使用单独输出目录。`npm run package:win`、`scripts/package-release.mjs` 会调用清理流程，删除本项目 `release / artifacts / .tmp / output`；需要保留测试证据时先转存，不要以为只是增量打包。

- 上游由 `scripts/fetch-upstream.mjs` 固定版本和补丁，不要随意切到上游最新 main。
- 全量 `npm test` 的失败要先判断是产品问题，还是测试夹具仍假定 macOS/POSIX。把依赖 `/bin/*`、macOS 路径、脚本 shebang、原生模块或文件锁差异的夹具列出，再改成 Windows 可运行的测试；不能直接删断言使其通过。
- Go 覆盖层测试：上游准备好后运行 `npm run test:sidecar-pin`、`npm run test:sidecar-agents`。其余 Go 回归脚本完整索引见第 8 节；按源码要求执行，不直接把补丁目录当 Go module。
- Electron UI 检查前先构建。如果环境设置了 `ELECTRON_RUN_AS_NODE`，先在该测试终端移除这个变量，避免把 Electron 当 Node 启动。

```powershell
npx electron scripts/startup-ui-check.cjs
npx electron scripts/account-startup-ui-check.cjs
npx electron scripts/windows-window-ui-check.cjs
npx electron scripts/agent-startup-ui-check.cjs
npx electron scripts/network-diagnostics-ui-check.cjs
node scripts/check-file-cleanup-native.mjs
```

这些脚本使用独立夹具，但并不覆盖真实账号登录与系统窗口控件；遇到宿主平台假设应记录／移植。`.ts` 的 Electron UI 脚本需要先按其依赖打包成 Electron 可运行文件，不能统一写成 `node scripts/xxx.ts`；`official-login-ui-check.ts` 等还包含 macOS 夹具，必须核对并替换成 Windows 数据格式。

## 4. macOS 侧已有验证记录与尚未关闭的问题

| 资产／场景 | 本次会话能确认的记录 | Windows 接手要求 |
| --- | --- | --- |
| 启动窗口、读取前确认 | 已检查工作台尺寸、图标位置、允许／暂不读取、默认焦点、Tab、Esc、最小窗口与自动关闭 | 原生 Windows 安装包重复执行 S01–S08 |
| 账号初次加载 | 回归已复现“需手动刷新”，修复后延迟账号可自动出现，加载结束停止轮询 | 做 A01、A02，不手动刷新掩盖问题 |
| 网关网络检测 | 本机实测七条链路均收到 HTTP 响应；其中有 405，不能当成授权成功 | 在实际 Windows 代理环境做 N01–N06 |
| Antigravity 额度 | 三个真实已保存账号均取得 Gemini、Claude/GPT 各周／5 小时四个窗口；其中一个第三方周剩余为 49% | 数值以测试时官方客户端为准，不能写死 49%、97% 或 100% |
| 密钥存储 | 去掉密钥类型白名单；名称边界、加密、锁定／损坏恢复和授权历史有回归 | 用 Windows 安全存储实测，不把 macOS 钥匙串结果迁移为 DPAPI 通过 |
| Windows 生命周期和迁移逻辑 | `5fe1177` 前已执行 78 项相关回归、类型检查、构建与渲染层模拟，通过 | 这些是 macOS 宿主／夹具结果；Windows 进程和 AppX 仍未实测 |
| 打包产物 | Intel Mac、Apple 芯片、Windows 包曾构建；v10.15.26.12 Apple 芯片 DMG 校验过版本、架构和拖入应用程序入口 | 从当前 main 重新构建 Windows 包，确认平台原生依赖，而不是使用旧包 |
| 完整打包运行检查的历史失败 | 较早 Intel 包在账号存储修复后，`check-packaged-runtime.mjs` 的 Claude 原生用量归属断言仍失败；本会话没有后续全量重跑证明该项关闭 | 作为未关闭回归点做 U04、B03；不要记成整套打包检查全绿 |
| 其他测试资产 | 第 8 节列出当前仓库全部测试文件和脚本，**不表示本轮全部执行过或通过** | 按功能分组运行并交付逐项结果 |

## 5. Windows 人工功能验收清单

表内“预期”是验收目标，不是 Windows 已通过的声明。若当前产品缺少所述能力，应标失败或阻塞，并说明实际界面与支持范围。

### 5.1 安装、启动、权限、窗口与后台驻留（P0）

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| S01 | 干净测试配置首次打开最终 Windows 包 | 架构正确，无缺失 DLL／SDK／sidecar；启动窗口及时出现；最终进入工作台 |
| S02 | 保留旧配置覆盖升级，再冷启动 | 原账号、来源、Key、用量、备份、主题仍可读；不新建错误配置目录 |
| S03 | 启动确认选择“暂不读取”，再访问账号／本地 Agent 页、刷新和导入 | 本次启动完全跳过 TokenFlow 自身和外部客户端的系统安全存储，包括可用性检查、加密与解密；内部网关使用临时密钥，依赖安全存储的账号／API 密钥暂不可用并明确提示。轮询、刷新、导入不得绕过；原密文不变，下次允许后可恢复。此标准取代早期“跳过后已保存账号仍可调用”的描述 |
| S04 | 下一次启动选择“允许读取”；另做系统拒绝／安全存储不可用 | 允许后才能访问相关安全存储；拒绝时有错误与恢复方法，不覆盖原密文，不伪装登录成功 |
| S05 | 启动确认卡片用 Tab、Shift+Tab、Enter、Esc；缩到 900×640 | 默认焦点“暂不读取”；键盘不意外授权；内容完整；选择后继续加载，不挂起 |
| S06 | 工作台点 ×，托盘重新打开，再通过托盘退出 | 点 × 保留网关和单实例；托盘可恢复；明确退出后清理受管进程和占用端口 |
| S07 | 工作台隐藏时再次启动程序；正在启动时快速启动第二次 | 不启动第二套网关，不重复绑定端口；第二实例行为可预期；不留下不可操作窗口 |
| S08 | 区分启动页 ×、主窗口 ×、菜单退出、系统关机 | 当前启动页 × 会终止启动；主窗口 × 为托盘驻留；其余退出能保存并清理资源 |
| S09 | 安装包放在中文／空格目录、切换工作目录、普通权限运行 | 路径解析与启动命令正确；不能依赖开发仓库当前目录 |
| S10 | 深浅主题、Alt、最大化／恢复、Snap、100/125/150% DPI、多显示器 | 按第 2 节检查融合标题栏、系统按钮、拖动区、窗口边界、弹窗、内容不遮挡 |

以下新增项均为 **Windows 未实测**。`522e5bb`、`caec7f4` 已修改启动安全存储与读取偏好行为，旧测试结论不得直接沿用；macOS／隔离夹具通过不等于 Windows DPAPI 通过。

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| S11 | 首次允许读取并成功读取／保存，再完整退出重开；另测首次暂不读取 | 成功后才记住允许，后续直接显示加载页；暂不读取不记作允许，不因凭据文件存在推断同意。Windows Credential Manager／DPAPI 实际行为单独记录 |
| S12 | 从托盘选择“下次启动重新选择登录读取”，退出再打开；另测偏好文件无效、系统存储不可用 | 重新询问；存储不可用清除已记住偏好、保留密文；不无限加载、不伪装读取成功。菜单可用性由 Windows 实机核对 |
| S13 | 同一进程多次加载账号；隔离测试资料中修改／移除／损坏加密文件，再退出重开 | 内存解密缓存不返回旧文件的值；写入／删除同步失效；退出不保留明文缓存；异常有终态。不得用真实账号资料做破坏性测试 |
| S14 | 首次选择页、记住后的加载页、系统拒绝／取消／延迟响应，分别最小窗口和 DPI 缩放 | 品牌／图标位置稳定，读取说明先于受保护访问；选择与加载动画不重叠，授权由测试者本人操作，处理后工作台自动打开。M 芯片 Mac 安装通过仅作对照 |

### 5.2 每家平台账号授权（P0：至少 Codex、WorkBuddy；完整交付覆盖全部可用平台）

每个平台均执行：新增账号 → 官方页授权 → 自动回到／同步 TokenFlow → 账号和真实模型出现 → 额度刷新 → 一次最小真实请求 → 完全退出重开后仍可用。缺少订阅或测试账号时记录“阻塞”，不能靠模拟返回判通过。

| ID | 平台与特殊检查 | 预期／核对点 |
| --- | --- | --- |
| A01 | 已有账号冷启动，模拟慢网络／慢目录返回，期间不点刷新 | 显示加载状态；账号、模型、额度完成后自动更新；不会误报“还没有账号”；完成后停止目录轮询 |
| A02 | 账号页上方刷新；切换平台；检查账号操作行 | 上方刷新更新该平台账号／模型／额度／本机登录，不清空其他平台；重复的小刷新已移除 |
| A03 | Codex 浏览器 OAuth；正确回调、回调端口被占、浏览器完成但 TokenFlow 未收到结果 | 成功只在凭据已保存时成立；能区分回调／交换／保存／目录加载失败；允许受校验的手动回调，日志不含完整地址 |
| A04 | Claude OAuth；scope 不足、过期和重新授权 | 保留正确账号、组织和授权范围；没有推理权限时明确失败，不把额度失败等同凭据撤销 |
| A05 | Antigravity Google OAuth 和回调；目录／额度 | 账号正常恢复；Gemini 与 Claude/GPT 周／5 小时四项都显示；目录未确认时不捏造型号 |
| A06 | Kimi 设备码；取消、码过期、重新发起 | 显示正确设备码与有效期；无本机回调依赖；取消后停止对应轮询 |
| A07 | xAI 设备码；订阅与 API 付费账号 | 正确区别账号／额度类型；设备授权状态、有效期、取消和重试准确 |
| A08 | Qoder 网页／设备流程；无需设备码的返回 | 不强制索要不存在的 code；可保存账号并得到真实可用模型；本机客户端缺失不妨碍网关授权 |
| A09 | WorkBuddy 国内与国际分别授权 | 官方域名、账号池资格和本机客户端归属正确；国际版本不被导向国内认证或错误额度地址 |
| A10 | ZCode 轮询授权；无 Coding Plan 账号 | 不使用未注册 localhost 回调；区分无套餐、凭据失败和接口错误 |
| A11 | Trae 授权回调与“从本机导入” | 正确匹配官方回调标识；不串会话；本地导入与浏览器登录后都能实际请求 |
| A12 | Cursor SDK 授权和“从本机导入／复用本机账号” | 独立凭据可保存；SDK 原生依赖加载；账号与额度可见；本地登录只读，不承诺界面不存在的强制切换 |
| A13 | 同一账号重复授权、同平台第二账号、同工作区两成员 | 不按邮箱误合并不同身份；保留多份有效授权；优先可用授权；展示可辨识，旧 Key 仍路由到正确来源 |
| A14 | 启用／停用／删除，随后重启 | 状态持久化；停用来源不可被旧 Key 绕过；删除前确认，仅处理所选账号；其他平台不受影响 |
| A15 | 各流程取消、超时、拒绝、重复点击、同时发起第二次 | 操作有终态；不重复启动浏览器／会话；错误后可重试；不能无限显示处理中或误报成功 |
| A16 | 每个带“从本机导入”的平台核对当前已安装客户端 | 当前按钮仅在 Trae、WorkBuddy、ZCode、Cursor；Claude Code／Qoder 没有此按钮，不按不存在的按钮设计测试；支持的导入不泄露认证信息 |

### 5.3 本机身份、账号切换和客户端重启（P0：Codex；其余 P1）

同一账号在“TokenFlow 已保存账号池”和“本机客户端当前登录”是两个状态，需分别核对。连接网关也不等同改了官方客户端登录。

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| L01 | Codex 有原登录与已有对话，选择另一个池内账号并确认重启 | 按第 1 节跟踪停止→变更→打开；成功后新账号与本机标记一致；历史可继续，备份可恢复 |
| L02 | 恢复 Codex 原登录、切回官方配置、单独重启 | 不混为一个动作；各入口都可独立完成，并显示真实结果 |
| L03 | Codex 原进程已关／CLI 仍开／保存提示／多安装／不同权限 | 未能可靠退出或确认安装时不修改；不按名字强杀无关程序；报错说明卡在哪一步 |
| L04 | 配置已变更但重新打开失败；再点独立重启 | 提示配置是否已完成；不会重复迁移；能定位正确安装，或者明确提供手动打开路径 |
| L05 | Claude Code 终端切换账号、组织，重启和恢复 | 原组织／登录保留可恢复；不跨组织误匹配；终端与桌面端不混淆；Windows 启动入口按实际支持验证 |
| L06 | Claude Desktop 接入网关、切回官方、重启 | 只改受支持的官方部署／选择配置；不读取或注入桌面端 cookies 来伪装切换登录；保留后续偏好和原登录 |
| L07 | Qoder 独立客户端与 Qoder IDE 分别切换／恢复 | 同来源可复用资格，但两种本机身份和备份独立；不互相覆盖；各自重开并实际请求 |
| L08 | Qoder IDE 自定义 profile、便携 data、受锁数据库 | 不写错配置目录；不覆盖占用或未确认格式；明确引导在对应客户端处理 |
| L09 | WorkBuddy 国内／国际分别切换、恢复并重启 | 只操作选中的产品；不退出另一个版本；账号与本机状态准确，原配置可恢复 |
| L10 | Antigravity 本机账号切换、退出客户端后恢复 | 数据库／身份和账号池正确关联；文件变化／占用时拒绝覆盖；没有自动重启能力时明确人工步骤 |
| L11 | Cursor 本机身份变化后刷新 | 只读显示准确；需在官方客户端切换时明示，不把网关来源变更当作官方登录变更 |
| L12 | 重启期间再点切换／删除／恢复；进程自重启、PID 复用 | 操作互斥；不写入过期预览；不启动重复实例，不关闭已变成其他程序的 PID |
| L13 | WorkBuddy、WorkBuddyAI、Qoder 保留官方身份并使用自定义模型，切换／恢复官方账号；另核对 Codex 网关模式 | 官方身份仍选中并显示“已登录”；切账号不移除自定义模型与 Key，国内／海外不互相影响；Codex 的活动 provider 模式仍区分。LOGIN-001，见 [验证记录](testing/official-login-coexist.md)；WorkBuddyAI 本轮未新增自动导入入口 |

### 5.4 接入配置、模型切换、对话备份和恢复（P0）

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| C01 | Codex、Claude Code、Qoder、WorkBuddy、DeepSeek Harness、Pi Agent 分别接入已授权来源 | 写入正确客户端目录、协议和路由模型 ID；客户端实际收到回复；只读核对不能显示密钥 |
| C02 | 同来源切模型、换来源、换回官方；保留原有 tools/hooks/审批设置 | 只改接入所需字段，保留未知配置和本地策略；显示与真实调用一致 |
| C03 | Codex 对话先在官方建样例，再接入网关、换模型、继续旧对话 | 旧会话可找到并延续；provider／路由记录一致；不串模型；新会话也可用 |
| C04 | Codex 备份→迁移→恢复；兼容规范化开／关两条路径 | 恢复内容和索引可核对；已有对话不丢失；恢复原 provider 和选中模型；不只显示“备份完成”而无法打开 |
| C05 | 迁移中途失败、配置被客户端修改、预览 revision 过期 | 留下可恢复备份；不覆盖后续修改；重试不会二次破坏历史；失败时不自动打开覆盖半迁移状态 |
| C06 | 接入前文件不存在、格式损坏、只读、软链、中文路径 | 缺失文件可按规则建立并恢复为原缺失；损坏／冲突有明确提示；路径按 Windows 实际目录解析 |
| C07 | Claude 选择 opus/sonnet/haiku 等官方别名，切换主／辅助模型 | 等价别名不误报配置变更；真实路由偏离能检测；辅助模型不会漏走官方来源 |
| C08 | WorkBuddy/Qoder 官方 SDK 工具往返；Claude、Chat、Responses 协议客户端 | 文本和受支持的工具结果完整返回；不把 SDK 的内部消息直接当网关协议；不丢工具调用对应关系 |
| C09 | 接入 TokenFlow 后用 CC Switch 切换 Codex／Claude Code 的地址、Key 和模型，再返回 TokenFlow | 显示“重新应用”；先取消确认，文件和 Key 均不变；再次确认后备份完整旧配置并更新所选模型，保留其他 provider、MCP、权限与偏好设置；真实客户端发消息验证路由；Codex 只确认一次并退出、应用、重开 |
| C10 | 客户端未安装、装多个版本、不同配置目录、客户端仍运行 | 明确支持范围；配置写入、退出和重启均有正确前置判断；安装失败不冒充接入成功 |
| C11 | 打开重新应用确认后，再用第三方工具写入同一配置；另测第三方工具持续回写、文件损坏与无法写入 | 版本冲突不覆盖新改动；取消并重开确认可获取新版本；持续回写应提示冲突，不自动循环争抢；坏文件／权限错误保留原文与备份，不能仅清除提示 |
| C12 | WorkBuddy 重新导入 Qoder／Codex 模型并打开原生菜单；重命名、重启、同名模型和恢复配置 | 只显示可读名称，不出现“名称:内部 ID”；实际请求仍使用原来源与模型，用量归属正确；同名项可区分且不覆盖其他自定义模型。MODEL-001 的 macOS 原生函数／CLI 已验证，Windows 4.22.16 菜单仍需实测，见 [验证记录](testing/workbuddy-model-labels.md) |

### 5.5 API 来源、导出 Key、协议与真实调用（P0/P1）

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| G01 | 新增／编辑／删除自定义 API 来源；读取模型与检查连接 | 地址、协议、模型和密钥按来源独立保存；保存后真实模型路由可调用；密钥不进入普通快照 |
| G02 | 导出只允许某来源、某模型的 Key；用它获取模型列表与发请求 | 列表仅显示允许项；越权模型／来源被拒绝；管理接口不能用客户端 Key 访问 |
| G03 | `/v1/responses`、`/v1/chat/completions`、`/v1/messages` 流式和非流式 | 正常完成、工具结果、错误终态和取消都符合对应协议；不把 200 空响应当成功 |
| G04 | 两个账号包含同名模型；固定来源后停用该账号 | 命名空间不冲突；固定来源不会静默漂移到另一账号；错误与来源状态匹配 |
| G05 | 有限 token 预算耗尽、编辑模型、重启、手动重置预算 | 累计消耗持久化，预算不能通过编辑或重启绕过；未完成流按现有规则处理 |
| G06 | 多并发、慢响应、断网、用户取消、代理重置连接 | 有限等待和明确失败／取消；资源释放；不会重复调用、重复结算或遗留常驻忙状态 |
| G07 | 网关端口被占、停止／重启、启动过程中退出 | 不接管无关服务；显示实际错误；可恢复；退出不遗留自己管理的 sidecar |
| G08 | 从浏览器页面或错误 Host/Origin、错误 Bearer 调本地管理 API | 拒绝不受信请求；错误 Bearer 不回退到 cookie；页面正常请求仍成功 |
| G09 | 更换内部网关 Key、重开 TokenFlow，继续用已导出 Key | 内部与客户端 Key 的职责正确；账号、客户端 Key 和路由不因非必要变更丢失 |
| G10 | 含图请求和工具调用分别跑支持／不支持的模型 | 仅展示已确认能力；不把会丢图片的适配器宣传为支持；无法处理时有可识别错误 |

### 5.6 额度、代理、网络诊断与日志（P1，授权链路异常时升 P0）

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| N01 | 设置→网关→检查网络，不附账号凭据 | 输出本机网关、应用出站、网关出站共七项固定目标；有时间、状态码、耗时和类别 |
| N02 | Clash 系统代理、PAC／规则、TUN＋全局、代理关闭分别测试 | 代理决策符合环境；本机界面与 localhost 授权回调直连；TUN 接管不能被应用层记录假称为未代理 |
| N03 | 模拟 DNS、连接拒绝、超时、TLS、代理认证失败 | 显示对应类别；请求有截止时间；日志不打印原始凭据、完整请求或认证链接 |
| N04 | 目标返回 401/403/405 | 解释为收到 HTTP 响应，不据此宣称 OAuth 成功或账号可用；本机认证失败单独可辨 |
| N05 | 登录失败后复制诊断；用户选择不读取客户端安全存储 | 包含版本／平台／授权阶段／路由／检测结果／日志；无账号邮箱、Key、OAuth URL/code/token；不因诊断绕过启动选择 |
| N06 | 某平台额度超时或短暂 502，其他平台正常 | 独立刷新、保留上次成功数据并标明陈旧；短暂故障可恢复；不能删除仍有效的登录 |
| N07 | 所有已授权平台逐个对照官方额度、套餐、重置时间 | 剩余／已用换算正确；缺失额度不展示为 100%；过期、无套餐、零额度、无限额度可区分 |
| N08 | Antigravity 官方四个窗口逐项比对；跨账号切换 | Gemini 周／5h 与 Claude/GPT 周／5h 完整，各自对应测试时真实值与当地重置时间 |
| N09 | Kimi/xAI 的多个额度窗口；Qoder 个人／组织 Credits；WorkBuddy 国内／国际 | 类型和单位明确，不把月金额当周百分比；不跨组织或地区读取 |
| N10 | Windows 断网后重连、系统代理端口变化、恢复机器时间 | 界面恢复、可重试；错误日志有阶段；时间与重置展示不因时区转换出现明显偏差 |

### 5.7 用量、活动、维修与文件清理（P1/P2）

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| U01 | 各协议实际请求后看用量和活动 | 记录真实 input/output/cache token；不凭估计补数；模型、来源、客户端 Key 可关联 |
| U02 | 取消、失败、重复响应 ID、流被截断和重启后回看 | 不重复计数；失败与用量证据独立；累计持久化且能追溯 |
| U03 | 日期范围、账号、Key、来源、网关／本地来源切换 | 图表、列表和汇总过滤一致；当天统计按本地日期；未知速度不是零速度 |
| U04 | 原生 Codex/Claude 样例日志，未切换账号也产生新用量 | 日志索引与账号归属正确；不能把“登录快照存在”当成归属正确的充分证据；关注第 4 节未关闭断言 |
| U05 | 在不同页面打开维修师傅，选择模型、发消息、诊断／方案 | 上下文对应当前页／客户端；请求有完成或错误；保留维修历史和选择 |
| U06 | 手动审批、拒绝、过期方案、撤销委托、重复执行、冲突方案 | 仅执行被批准且仍有效的方案一次；历史修复保持人工确认；失败留证据，不擅自覆盖文件 |
| U07 | 文件清理扫描测试目录、扫描位置／磁盘、取消、无权限目录 | 路径正确；不跟随不可信链接；进度真实；扫描未完整时说明覆盖范围，不误称全盘完成 |
| U08 | 缓存／依赖／安装包候选、受保护文件、同名副本、文件扫描后变化 | 分类与元数据证据一致；不只按名字断言重复；失效扫描和变化条目不直接删除 |
| U09 | 在测试目录执行回收站／永久删除、取消与恢复测试 | 按明确确认的范围处理；受保护项有影响说明；Windows 回收站语义正确；不能影响真实对话和账号数据 |
| U10 | 设置、复制、外链、侧栏宽度、拖动排序、通知、弹窗、长名称 | 状态持久化、复制反馈正确、官方链接只开浏览器；键盘和滚动不跳位；页面不溢出 |
| U11 | Claude Code 分别使用官方登录、直接 API、TokenFlow 反重力来源；反重力两个账号提供同名 Gemini／Claude 模型 | 核对 target／provider／sourceId／channel／origin；同名模型不串来源，停用账号不改路由；导出 Key 不冒称客户端身份，重启／重扫不重复累计。反重力 SQLite v1 已接入，Windows 需实测 DB／WAL 更新、双账号／项目切换和旧 `.pb` 明确不可读；无身份历史单列。详见 [直连采集](testing/native-direct-usage.md) |
| U12 | 所有已授权平台分别从客户端直连一次，再经 TokenFlow 使用一次；覆盖 WorkBuddyAI 国际版与 Qoder 官方／自定义模型共存 | 来源、渠道和目标不串；重复授权／过期／停用不丢历史身份，跳过安全存储不弹读取提示；无支持的采集器必须显示“尚未采集”。Kimi／ZCode／Trae／Grok 等未适配项按 USAGE-004 采集脱敏结构和实际 Token 对账，不勾为通过，不用额度反推 Token；Cursor 单列 U13 |
| U13 | Cursor：原生 No Repo／无工具消息一次，再经 TokenFlow SDK 一次；重复扫描、重启并清空可清空的活动轨迹后核对 | main 已在 macOS Cursor 3.25.6 实测原生 14,052 Token。Windows 仍未测：核对 `%APPDATA%/Cursor/User/globalStorage/state.vscdb`／WAL、代理与普通权限；本机 composer＋授权账号官方事件精确关联，不能用 `isHeadless=false` 判断。直连只进 native，SDK 只进 gateway，来源账号／活动一致；排重文件不随清空轨迹删除，重启或导入 SDK 副本不双算。测试双账号、无邮箱授权、停用、空／延迟／不完整账单，网络失败保留旧计数；无 Key 创建或客户端认证／配置写回。更多版本、同步会话和大账单范围见[直连文档](testing/native-direct-usage.md#cursor-原生客户端直连采集2026-10-17) |

#### Cursor 安装版补充验收（Windows 未实测，P1）

- **U14：最终 Windows 包显示核对**。同步包含 `6f1729d` 的直连实现及后续改进后，重新构建 Windows 包；在设置页记录实际版本和提交。完成 U13 后无需手工刷新，在“用量总览 → 使用方式 → 显示全部”看到 Cursor，再核对来源账号、活动中的“官方明细核对”和请求数。完整退出重开后统计不丢失、不重复；后台对账延迟或失败时保留已有已核对计数并显示状态。
- macOS v10.15.26.13 的参考样本是 **14,052 Token（输入 14,047、输出 5、缓存读取 0、1 次请求）**，安装界面四舍五入显示 **1.4 万**。Windows 应使用自己的原生测试请求及对应官方明细核对，不把这个数字作为固定预期，也不把账号来源中的网关＋直连合计误认作客户端原生直连。
- **U15：原生数据库与权限**。客户端运行／退出、SQLite 与 WAL 变化、普通权限、受占用／拒绝读取、自定义或旧资料目录逐项记录；读取前后数据库不被采集器改写。没有本机会话证据的网页／其他设备账单不能计入；不得改读 Cursor 原生登录密钥或创建 SDK Key 来补计数。大账单、同步历史、团队等尚未验证边界继续按[直连文档](testing/native-direct-usage.md)记录未测或阻塞。

#### Codex 请求统计与归属（U16，Windows 未实测，P1）

- 从包含本轮 Codex 请求线程修复的提交构建包；旧 M 芯片 v10.15.26.13 包没有本轮修改。用父日志内含子线程响应、不同模型和账号的脱敏夹具核对请求线程优先级；没有唯一证据时不继承父模型或账号。
- v12 索引升级后，即使原日志未变化也重扫 Codex，其他客户端缓存保留。同响应副本／累计通知不双算，缓存不额外加一次；归属修复不应改变真实 Token 总额。账号切换、子线程独立路由、网关排重分别验收。
- 官方个人主页与 TokenFlow 对账记录同账号、日界线、版本和采集时点。macOS 的 3.5 亿对约 6.43 亿差额尚未闭环，不是 Windows 已通过的基线；没有账号证据的 Token 保持已统计、归属未确认。见 [Codex 排查记录](testing/native-direct-usage.md#codex-个人主页与本机日志差异排查2026-10-17)。

#### 多客户端计数与缓存兼容（U18，Windows 未实测，P1）

- [ ] 复跑 `tests/gateway-activity.test.ts`：Chat Completions 响应同时有 prompt_tokens 和 Anthropic 缓存别名时，输入不再重复加缓存；JSON／SSE 均应为输入 100、输出 10、总量 110。保留原 Anthropic 分项输入与 Responses 包含式输入的断言。
- [ ] 在 Windows 安装包中核对逐请求详情、来源、总览一致；先记录真实响应字段和计数，再与客户端／官方同账号同日明细比较，不按额度百分比倒推 Token。
- [ ] 分别核对 Claude、Qoder、WorkBuddy、反重力和 Cursor 的直连／网关路径；“官方类型”与“已匹配账号”分开验收。无记录、无授权、尚未支持时不得显示成确定的零消耗。
- [ ] Codex 对账按逐请求证据、登录观察推断、其他账号、未知账号分组；诊断脚本新增证据分项只用于排查，不修改生产数字。macOS 精确证据本身仍高于个人主页，不能把差额简单归因于未知账号。

macOS 已完成的范围与保留缺口见 [跨客户端核对](testing/native-direct-usage.md#跨客户端计数复核与-codex-同账号差额2026-10-17)。关联 USAGE-001／002／004／005，不能把 Mac 源码回归当作 Windows 实机通过。

#### Codex 独立对账记录器（U19，Windows 未实测，P1）

- [ ] 使用真实 Windows Codex 会话目录、TokenFlow 数据目录和官方 CLI 可执行文件路径运行 `scripts/codex-reconciliation-record.ts`；不能照抄 macOS 的目录。普通用户权限验证目录锁、文件权限、符号链接／目录联接和文件占用。
- [ ] 新账号从完整日开始使用，按 [记录方案](testing/native-direct-usage.md#新账号完整日对账记录器2026-10-17)核对本机逐请求、账号观察及官方最近 7 日日桶。切换账号、跨午夜、休眠、网络失效、强退及重新启动后，保留窗口、记录中断、按响应最新修订排重。
- [ ] 精确账号证据后到或文件轮转时不重新计数，不被较弱的当前登录观察覆盖；不同精确证据冲突必须保留冲突。子线程使用自己的来源／身份；创建者不作为请求付款账号。
- [ ] 官方快照失败标记不可用，个人空间／服务端时区未公开时保持未确认。日志不包含凭据、消息或原始账号 ID；实际日志保持 Git 忽略，只同步源码与脱敏结论。

该工具为项目内独立进程，不属于已交付安装包，也未配置开机自启。macOS 的本轮记录不替代 Windows 实测，USAGE-005 仍未完成官方对账。

### 5.8 最终 Windows 包交付（P0）

用量对账补充 U17（Windows 未实测）：在开发测试环境使用实际已安装官方 CLI 运行 `scripts/codex-official-usage-check.ts` 的只读检查，记录账号是否匹配、日桶原始数值与采集时刻；不登录新账号、不创建模型请求、不输出凭据。对照本机审计的同账号／其他账号／未确认分区和半开日期窗口，标出尚未结束的时区日窗；空日桶与 0 不混淆。macOS 已观察到个人主页 3.5 亿与官方 CLI 263,551,960 不同，不能拿任何一方作为 Windows 的固定预期，也不能为了匹配而改本机 Token。新版主页接口若返回权限错误就记录阻塞，不绕过权限。

| ID | 前置与操作 | 预期／核对点 |
| --- | --- | --- |
| B01 | 干净环境解压最终包，核对 `.exe`、sidecar、Cursor／WorkBuddy SDK、许可证 | 只有目标 Windows 架构的原生依赖；没有 Mac 二进制、开发配置或真实凭据混入 |
| B02 | 不装 Node、Go 和开发依赖的 Windows 测试机运行 | 主程序和受支持 SDK 正常；不依赖开发机 PATH、仓库资源或另一个版本的安装目录 |
| B03 | 运行 `scripts/check-packaged-runtime.mjs` 对应的隔离包内校验，随后人工跑真实客户端 | SDK 加载、静态页、真实包内网关、用量 worker、客户端识别、切换／恢复都可用；Claude 用量归属断言单列，不能跳过隐藏 |
| B04 | 最终包从 S01 到 G03 做一轮 P0 回归，重启 Windows 后再开 | 实际版本与提交对应；数据仍在；无自动启动重复实例和残留进程；阻塞项有明确交付结论 |

打包运行检查需由 Windows 接手者使用打包的 Electron 可执行文件及 `ELECTRON_RUN_AS_NODE=1` 运行；环境变量写法用 PowerShell，测试结束后清除。该脚本的夹具／本机路径假设需先核对，失败记为包内测试失败或夹具移植阻塞，不能改用开发 Node 后宣称包内检查通过。

## 6. 测试结果回传模板

在本仓库增加测试报告或逐项回填以下格式；无需转发真实凭据或账号截图。

```text
测试批次：
日期／测试人员：
仓库 URL：
提交 SHA／设置页版本／包文件名：
Windows 版本／架构／终端：
安装方式／客户端版本／代理模式：

用例 ID：
结果：通过 / 失败 / 阻塞 / 不适用
前置条件与操作步骤：
预期：
实际：
起止时间／耗时：
失败阶段（如 stopping / changing / opening）：
是否已经写配置／生成备份／请求启动／出现新 PID：
脱敏证据位置：
关联修复提交／复测结果：
```

发布判定：P0 全部通过；P1/P2 逐项有结果。未关闭的 Codex 重启／历史恢复或账号授权问题不能用“其他测试通过”替代。报告要区分安装包、开发模式、夹具自动化和真实账号测试。

## 7. 自动化测试资产如何对应功能

| 功能 | 主要入口（完整列表见下一节） | 执行与平台说明 |
| --- | --- | --- |
| 启动／界面／账号首次加载 | `startup-ui-check.cjs`、`account-startup-ui-check.cjs`、`agent-startup-ui-check.cjs`、`windows-window-ui-check.cjs`；`account-startup.test.ts`、`window-options.test.ts`、`ui-request.test.ts` | `.cjs` 可用 Electron 运行；原生标题栏仍需 Windows 实测 |
| 授权／凭据／安全存储 | `cliproxy-login`、`provider-login-contract`、`login-result`、`local-credentials`、`credential-*`、`secrets`、`revoked-credentials` 测试 | Vitest；mock 凭据不能代替官方网页 OAuth 和 Windows 安全存储 |
| 官方账号身份与切换 | `native-accounts*`、`native-login-*`、`desktop-accounts*`、`qoder-ide-login`、`qoder-crypto-profile`、`claude-desktop*`、`cursor-local*`；`official-login-ui-check.ts` | `.ts` Electron 脚本包含平台夹具，需核对 Windows 的目录、数据格式和原生加解密 |
| 重启／安装／更新 | `windows-agent-lifecycle`、`agent-lifecycle`、`agent-processes`、`agent-installation`、`agent-updates`、`codex-switch-lifecycle`、`claude-terminal-lifecycle`、`pi-terminal-lifecycle` | mock PowerShell 通过不等于真实 AppX／CIM 通过 |
| 接入／历史备份恢复 | `agent-connections`、`agent-model-switching`、`codex-accounts*`、`codex-context`、`codex-thread-migration`、`switch-journal`、`deepseek-config` | Vitest；真实已有会话、SQLite 文件占用及 Windows 路径另测 |
| API 来源／协议／Key／工具 | `api-*`、`gateway-keys`、`key-budget`、`a2a-*`、`managed-routing`、`codebuddy-*`、`cursor`、`model-export-labels` | 先夹具，再各平台最小真实请求；SDK 工具与原生二进制必须在包内验证 |
| 代理／额度／网络 | `network-*`、`quota*`、`trae-quota`、`qoder-accounting`、`upstream-*`；`network-diagnostics-ui-check.cjs`、`network-connectivity-check.ts` | 网络实测需要实际系统代理；HEAD 401/403/405 不是授权成功 |
| 用量／活动／归属 | `usage-*`、`local-usage*`、`native-usage-*`、`cursor-usage`、`gateway-activity`、`gateway-traces`、`activity-traces` | 使用隔离日志重放与真实样例双验证；已知 Claude 归属断言待复核 |
| 维修／审批 | `maintenance*`、`local-maintenance`、`repair-*`、`gateway-context*` | 验证审批状态、失败与恢复，人工历史修复不自动执行 |
| 文件清理 | `file-cleanup*`；`check-file-cleanup-native.mjs` | Windows 路径、权限和回收站需真实系统验证；只用可删除的测试资料 |
| 包内依赖／sidecar | `packaging-assets`、`service`、`tests/sidecar/*`；`check-packaged-runtime.mjs`、`check-runtime-bundle.mjs`、`test-sidecar-*` | 有 Go 上游／覆盖层和 Electron 原生依赖前置条件 |

## 8. 完整测试与脚本索引

下面是整理时仓库中的完整文件索引，方便接手者按功能找到自动化用例，避免只测授权成功这一条路径。索引不代表各文件已经在 Windows 上执行；`tests/fixtures` 是夹具，不作为独立验收项。

脚本索引也包含构建、补丁、探测、真实账号 live 和历史修复工具，**不是批量执行清单**。运行 live／repair／replay／stress 类工具前必须读其文件头、参数、路径和副作用，适配 Windows 并使用测试账号／测试配置；已有脚本里有硬编码 macOS 路径，不得直接照搬执行。

<details>
<summary>Vitest 测试文件：114 个</summary>

- [packages/contracts/fixtures.test.ts](../packages/contracts/fixtures.test.ts)
- [tests/a2a-interoperability.test.ts](../tests/a2a-interoperability.test.ts)
- [tests/a2a-service.test.ts](../tests/a2a-service.test.ts)
- [tests/account-label.test.ts](../tests/account-label.test.ts)
- [tests/account-startup.test.ts](../tests/account-startup.test.ts)
- [tests/activity-traces.test.ts](../tests/activity-traces.test.ts)
- [tests/agent-connections.test.ts](../tests/agent-connections.test.ts)
- [tests/agent-installation.test.ts](../tests/agent-installation.test.ts)
- [tests/agent-lifecycle.test.ts](../tests/agent-lifecycle.test.ts)
- [tests/agent-model-switching.test.ts](../tests/agent-model-switching.test.ts)
- [tests/agent-processes.test.ts](../tests/agent-processes.test.ts)
- [tests/agent-updates.test.ts](../tests/agent-updates.test.ts)
- [tests/antigravity-usage-index.test.ts](../tests/antigravity-usage-index.test.ts)
- [tests/antigravity-usage-service.test.ts](../tests/antigravity-usage-service.test.ts)
- [tests/antigravity-usage.test.ts](../tests/antigravity-usage.test.ts)
- [tests/api-protocol.test.ts](../tests/api-protocol.test.ts)
- [tests/api-source-draft.test.ts](../tests/api-source-draft.test.ts)
- [tests/api-sources.test.ts](../tests/api-sources.test.ts)
- [tests/claude-desktop-service.test.ts](../tests/claude-desktop-service.test.ts)
- [tests/claude-desktop.test.ts](../tests/claude-desktop.test.ts)
- [tests/claude-terminal-lifecycle.test.ts](../tests/claude-terminal-lifecycle.test.ts)
- [tests/cliproxy-login.test.ts](../tests/cliproxy-login.test.ts)
- [tests/codebuddy-runtime.test.ts](../tests/codebuddy-runtime.test.ts)
- [tests/codebuddy-sdk-service.test.ts](../tests/codebuddy-sdk-service.test.ts)
- [tests/codebuddy-sdk.test.ts](../tests/codebuddy-sdk.test.ts)
- [tests/codex-accounts-service.test.ts](../tests/codex-accounts-service.test.ts)
- [tests/codex-accounts.test.ts](../tests/codex-accounts.test.ts)
- [tests/codex-catalog-refresh.test.ts](../tests/codex-catalog-refresh.test.ts)
- [tests/codex-context.test.ts](../tests/codex-context.test.ts)
- [tests/codex-runtime.test.ts](../tests/codex-runtime.test.ts)
- [tests/codex-switch-lifecycle.test.ts](../tests/codex-switch-lifecycle.test.ts)
- [tests/codex-thread-migration.test.ts](../tests/codex-thread-migration.test.ts)
- [tests/connection-evidence.test.ts](../tests/connection-evidence.test.ts)
- [tests/credential-access.test.ts](../tests/credential-access.test.ts)
- [tests/credential-history.test.ts](../tests/credential-history.test.ts)
- [tests/credential-identity.test.ts](../tests/credential-identity.test.ts)
- [tests/cursor-local-service.test.ts](../tests/cursor-local-service.test.ts)
- [tests/cursor-local.test.ts](../tests/cursor-local.test.ts)
- [tests/cursor-native-usage-service.test.ts](../tests/cursor-native-usage-service.test.ts)
- [tests/cursor-native-usage.test.ts](../tests/cursor-native-usage.test.ts)
- [tests/cursor-usage.test.ts](../tests/cursor-usage.test.ts)
- [tests/cursor.test.ts](../tests/cursor.test.ts)
- [tests/deepseek-config.test.ts](../tests/deepseek-config.test.ts)
- [tests/desktop-accounts-service.test.ts](../tests/desktop-accounts-service.test.ts)
- [tests/desktop-accounts.test.ts](../tests/desktop-accounts.test.ts)
- [tests/display-order.test.ts](../tests/display-order.test.ts)
- [tests/file-cleanup-artifacts.test.ts](../tests/file-cleanup-artifacts.test.ts)
- [tests/file-cleanup-disks.test.ts](../tests/file-cleanup-disks.test.ts)
- [tests/file-cleanup-full-scan.test.ts](../tests/file-cleanup-full-scan.test.ts)
- [tests/file-cleanup-native.test.ts](../tests/file-cleanup-native.test.ts)
- [tests/file-cleanup-paths.test.ts](../tests/file-cleanup-paths.test.ts)
- [tests/file-cleanup.test.ts](../tests/file-cleanup.test.ts)
- [tests/flow-model.test.ts](../tests/flow-model.test.ts)
- [tests/gateway-activity.test.ts](../tests/gateway-activity.test.ts)
- [tests/gateway-context-service.test.ts](../tests/gateway-context-service.test.ts)
- [tests/gateway-context.test.ts](../tests/gateway-context.test.ts)
- [tests/gateway-keys.test.ts](../tests/gateway-keys.test.ts)
- [tests/gateway-traces.test.ts](../tests/gateway-traces.test.ts)
- [tests/key-budget.test.ts](../tests/key-budget.test.ts)
- [tests/local-credentials.test.ts](../tests/local-credentials.test.ts)
- [tests/local-maintenance.test.ts](../tests/local-maintenance.test.ts)
- [tests/local-usage-evidence.test.ts](../tests/local-usage-evidence.test.ts)
- [tests/local-usage-index.test.ts](../tests/local-usage-index.test.ts)
- [tests/local-usage.test.ts](../tests/local-usage.test.ts)
- [tests/login-result.test.ts](../tests/login-result.test.ts)
- [tests/maintenance-approval.test.ts](../tests/maintenance-approval.test.ts)
- [tests/maintenance-http.test.ts](../tests/maintenance-http.test.ts)
- [tests/maintenance-storage.test.ts](../tests/maintenance-storage.test.ts)
- [tests/maintenance-usage.test.ts](../tests/maintenance-usage.test.ts)
- [tests/maintenance.test.ts](../tests/maintenance.test.ts)
- [tests/managed-routing.test.ts](../tests/managed-routing.test.ts)
- [tests/model-export-labels.test.ts](../tests/model-export-labels.test.ts)
- [tests/native-accounts-service.test.ts](../tests/native-accounts-service.test.ts)
- [tests/native-accounts.test.ts](../tests/native-accounts.test.ts)
- [tests/native-login-identity.test.ts](../tests/native-login-identity.test.ts)
- [tests/native-login-visibility.test.ts](../tests/native-login-visibility.test.ts)
- [tests/native-usage-accounts.test.ts](../tests/native-usage-accounts.test.ts)
- [tests/native-usage-coverage.test.ts](../tests/native-usage-coverage.test.ts)
- [tests/native-usage-login-readers.test.ts](../tests/native-usage-login-readers.test.ts)
- [tests/native-usage-logins.test.ts](../tests/native-usage-logins.test.ts)
- [tests/network-check.test.ts](../tests/network-check.test.ts)
- [tests/network-proxy.test.ts](../tests/network-proxy.test.ts)
- [tests/packaging-assets.test.ts](../tests/packaging-assets.test.ts)
- [tests/pi-terminal-lifecycle.test.ts](../tests/pi-terminal-lifecycle.test.ts)
- [tests/profile.test.ts](../tests/profile.test.ts)
- [tests/project-links.test.ts](../tests/project-links.test.ts)
- [tests/provider-login-contract.test.ts](../tests/provider-login-contract.test.ts)
- [tests/qoder-accounting.test.ts](../tests/qoder-accounting.test.ts)
- [tests/qoder-crypto-profile.test.ts](../tests/qoder-crypto-profile.test.ts)
- [tests/qoder-ide-login.test.ts](../tests/qoder-ide-login.test.ts)
- [tests/quota-retry.test.ts](../tests/quota-retry.test.ts)
- [tests/quota.test.ts](../tests/quota.test.ts)
- [tests/repair-context.test.ts](../tests/repair-context.test.ts)
- [tests/repair-routing.test.ts](../tests/repair-routing.test.ts)
- [tests/revoked-credentials.test.ts](../tests/revoked-credentials.test.ts)
- [tests/secrets.test.ts](../tests/secrets.test.ts)
- [tests/service.test.ts](../tests/service.test.ts)
- [tests/source-options.test.ts](../tests/source-options.test.ts)
- [tests/startup-credential-order.test.ts](../tests/startup-credential-order.test.ts)
- [tests/switch-journal.test.ts](../tests/switch-journal.test.ts)
- [tests/trae-acceptance-platform.test.ts](../tests/trae-acceptance-platform.test.ts)
- [tests/trae-codex-config.test.ts](../tests/trae-codex-config.test.ts)
- [tests/trae-quota.test.ts](../tests/trae-quota.test.ts)
- [tests/ui-request.test.ts](../tests/ui-request.test.ts)
- [tests/upstream-errors.test.ts](../tests/upstream-errors.test.ts)
- [tests/upstream-idle.test.ts](../tests/upstream-idle.test.ts)
- [tests/usage-attribution-service.test.ts](../tests/usage-attribution-service.test.ts)
- [tests/usage-attribution.test.ts](../tests/usage-attribution.test.ts)
- [tests/usage-ledger-service.test.ts](../tests/usage-ledger-service.test.ts)
- [tests/usage-ledger.test.ts](../tests/usage-ledger.test.ts)
- [tests/usage-model.test.ts](../tests/usage-model.test.ts)
- [tests/usage-overview.test.ts](../tests/usage-overview.test.ts)
- [tests/window-options.test.ts](../tests/window-options.test.ts)
- [tests/windows-agent-lifecycle.test.ts](../tests/windows-agent-lifecycle.test.ts)
- [tests/workbuddy-model-labels.test.ts](../tests/workbuddy-model-labels.test.ts)

</details>

<details>
<summary>Go 回归源文件与夹具入口：16 个</summary>

- [tests/sidecar/agent_contract_test.go](../tests/sidecar/agent_contract_test.go)
- [tests/sidecar/antigravity_reconnect_test.go](../tests/sidecar/antigravity_reconnect_test.go)
- [tests/sidecar/official_catalog_test.go](../tests/sidecar/official_catalog_test.go)
- [tests/sidecar/provider_login_test.go](../tests/sidecar/provider_login_test.go)
- [tests/sidecar/qoder_claude_test.go](../tests/sidecar/qoder_claude_test.go)
- [tests/sidecar/qoder_protocol_test.go](../tests/sidecar/qoder_protocol_test.go)
- [tests/sidecar/trae_catalog_test.go](../tests/sidecar/trae_catalog_test.go)
- [tests/sidecar/trae_native_live_test.go](../tests/sidecar/trae_native_live_test.go)
- [tests/sidecar/trae_native_test.go](../tests/sidecar/trae_native_test.go)
- [tests/sidecar/trae_web_pages_test.go](../tests/sidecar/trae_web_pages_test.go)
- [tests/sidecar/trae_web_search_test.go](../tests/sidecar/trae_web_search_test.go)
- [tests/sidecar/workbuddy_local_paths_test.go](../tests/sidecar/workbuddy_local_paths_test.go)
- [tests/sidecar/workbuddy_region_test.go](../tests/sidecar/workbuddy_region_test.go)
- [tests/sidecar/workbuddy_wire_test.go](../tests/sidecar/workbuddy_wire_test.go)
- [tests/sidecar/zcode_cli_polling_test.go](../tests/sidecar/zcode_cli_polling_test.go)
- [tests/sidecar-pin.go](../tests/sidecar-pin.go)

</details>

<details>
<summary>脚本完整索引（需逐个确认平台和副作用）：82 个</summary>

- [scripts/a2a-desktop-live.ts](../scripts/a2a-desktop-live.ts)
- [scripts/account-startup-ui-check.cjs](../scripts/account-startup-ui-check.cjs)
- [scripts/after-pack.cjs](../scripts/after-pack.cjs)
- [scripts/agent-reapply-ui-check.cjs](../scripts/agent-reapply-ui-check.cjs)
- [scripts/agent-startup-ui-check.cjs](../scripts/agent-startup-ui-check.cjs)
- [scripts/agent-task-live.ts](../scripts/agent-task-live.ts)
- [scripts/antigravity-fault-proxy.ts](../scripts/antigravity-fault-proxy.ts)
- [scripts/audit-release.mjs](../scripts/audit-release.mjs)
- [scripts/before-pack.cjs](../scripts/before-pack.cjs)
- [scripts/build-sidecar.mjs](../scripts/build-sidecar.mjs)
- [scripts/catalog-smoke.ts](../scripts/catalog-smoke.ts)
- [scripts/check-antigravity-native-usage.mjs](../scripts/check-antigravity-native-usage.mjs)
- [scripts/check-file-cleanup-native.mjs](../scripts/check-file-cleanup-native.mjs)
- [scripts/check-packaged-runtime.mjs](../scripts/check-packaged-runtime.mjs)
- [scripts/check-runtime-bundle.mjs](../scripts/check-runtime-bundle.mjs)
- [scripts/check-workbuddy-model-labels.ts](../scripts/check-workbuddy-model-labels.ts)
- [scripts/claude-integration-ui-check.ts](../scripts/claude-integration-ui-check.ts)
- [scripts/clean-build.mjs](../scripts/clean-build.mjs)
- [scripts/clean-package.mjs](../scripts/clean-package.mjs)
- [scripts/codebuddy-sdk-conversation-live.mjs](../scripts/codebuddy-sdk-conversation-live.mjs)
- [scripts/codebuddy-sdk-live.mjs](../scripts/codebuddy-sdk-live.mjs)
- [scripts/codex-config-reload-check.ts](../scripts/codex-config-reload-check.ts)
- [scripts/codex-context-migration-smoke.mjs](../scripts/codex-context-migration-smoke.mjs)
- [scripts/codex-continuation-smoke.mjs](../scripts/codex-continuation-smoke.mjs)
- [scripts/codex-history-id-probe.ts](../scripts/codex-history-id-probe.ts)
- [scripts/codex-provider-migration-probe.mjs](../scripts/codex-provider-migration-probe.mjs)
- [scripts/codex-routing-smoke.mjs](../scripts/codex-routing-smoke.mjs)
- [scripts/codex-source-live-smoke.mjs](../scripts/codex-source-live-smoke.mjs)
- [scripts/codex-subagent-routing-smoke.mjs](../scripts/codex-subagent-routing-smoke.mjs)
- [scripts/codex-workbuddy-tools-live.ts](../scripts/codex-workbuddy-tools-live.ts)
- [scripts/context-codex-smoke.ts](../scripts/context-codex-smoke.ts)
- [scripts/cursor-native-usage-check.cjs](../scripts/cursor-native-usage-check.cjs)
- [scripts/cursor-native-usage-check.ts](../scripts/cursor-native-usage-check.ts)
- [scripts/cursor-usage-live.cjs](../scripts/cursor-usage-live.cjs)
- [scripts/cursor-usage-live.ts](../scripts/cursor-usage-live.ts)
- [scripts/deepseek-settings-check.ts](../scripts/deepseek-settings-check.ts)
- [scripts/fetch-upstream.mjs](../scripts/fetch-upstream.mjs)
- [scripts/file-cleanup-native-check.ts](../scripts/file-cleanup-native-check.ts)
- [scripts/local-approval-smoke.ts](../scripts/local-approval-smoke.ts)
- [scripts/local-usage-audit.mjs](../scripts/local-usage-audit.mjs)
- [scripts/native-a2a-smoke.ts](../scripts/native-a2a-smoke.ts)
- [scripts/native-usage-ui-check.ts](../scripts/native-usage-ui-check.ts)
- [scripts/network-connectivity-check.ts](../scripts/network-connectivity-check.ts)
- [scripts/network-diagnostics-ui-check.cjs](../scripts/network-diagnostics-ui-check.cjs)
- [scripts/official-catalog-overlay.mjs](../scripts/official-catalog-overlay.mjs)
- [scripts/official-login-coexist-ui-check.cjs](../scripts/official-login-coexist-ui-check.cjs)
- [scripts/official-login-ui-check.ts](../scripts/official-login-ui-check.ts)
- [scripts/package-release.mjs](../scripts/package-release.mjs)
- [scripts/provider-login-overlay.mjs](../scripts/provider-login-overlay.mjs)
- [scripts/provider-matrix-live.ts](../scripts/provider-matrix-live.ts)
- [scripts/qoder-claude-quota-probe.ts](../scripts/qoder-claude-quota-probe.ts)
- [scripts/qoder-live-smoke.ts](../scripts/qoder-live-smoke.ts)
- [scripts/qoder-model-live.ts](../scripts/qoder-model-live.ts)
- [scripts/qoder-request-replay.mjs](../scripts/qoder-request-replay.mjs)
- [scripts/repair-local-codex-history.ts](../scripts/repair-local-codex-history.ts)
- [scripts/sidecar-overlay.mjs](../scripts/sidecar-overlay.mjs)
- [scripts/source-live-smoke.ts](../scripts/source-live-smoke.ts)
- [scripts/source-stress-probe.ts](../scripts/source-stress-probe.ts)
- [scripts/startup-ui-check.cjs](../scripts/startup-ui-check.cjs)
- [scripts/test-native-catalog.mjs](../scripts/test-native-catalog.mjs)
- [scripts/test-official-catalog.mjs](../scripts/test-official-catalog.mjs)
- [scripts/test-provider-login.mjs](../scripts/test-provider-login.mjs)
- [scripts/test-sidecar-pin.mjs](../scripts/test-sidecar-pin.mjs)
- [scripts/test-sidecar-qoder.mjs](../scripts/test-sidecar-qoder.mjs)
- [scripts/test-trae-codex-installed.mjs](../scripts/test-trae-codex-installed.mjs)
- [scripts/test-trae-installed.mjs](../scripts/test-trae-installed.mjs)
- [scripts/test-trae-responses-installed.mjs](../scripts/test-trae-responses-installed.mjs)
- [scripts/test-trae-web-pages-installed.mjs](../scripts/test-trae-web-pages-installed.mjs)
- [scripts/test-trae-web-search-installed.mjs](../scripts/test-trae-web-search-installed.mjs)
- [scripts/trae-acceptance-config.mjs](../scripts/trae-acceptance-config.mjs)
- [scripts/windows-window-ui-check.cjs](../scripts/windows-window-ui-check.cjs)
- [scripts/workbuddy-cancellation-probe.ts](../scripts/workbuddy-cancellation-probe.ts)
- [scripts/workbuddy-claude-replay.mjs](../scripts/workbuddy-claude-replay.mjs)
- [scripts/workbuddy-direct-cli-probe.mjs](../scripts/workbuddy-direct-cli-probe.mjs)
- [scripts/workbuddy-model-live.ts](../scripts/workbuddy-model-live.ts)
- [scripts/workbuddy-network-probe.cjs](../scripts/workbuddy-network-probe.cjs)
- [scripts/workbuddy-overseas-login-probe.ts](../scripts/workbuddy-overseas-login-probe.ts)
- [scripts/workbuddy-region-overlay.mjs](../scripts/workbuddy-region-overlay.mjs)
- [scripts/workbuddy-sdk-gateway-live.ts](../scripts/workbuddy-sdk-gateway-live.ts)
- [scripts/workbuddy-sdk-packaged-live.mjs](../scripts/workbuddy-sdk-packaged-live.mjs)
- [scripts/workbuddy-startup-cancellation-probe.ts](../scripts/workbuddy-startup-cancellation-probe.ts)
- [scripts/workbuddy-tool-handoff-probe.ts](../scripts/workbuddy-tool-handoff-probe.ts)

</details>
