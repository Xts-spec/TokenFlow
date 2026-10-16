# Agent 界面整理与官方图标核对

记录日期：2026-10-17。对应本轮工作区改动；前序已经提交的页面与接入修复继续保留在 Git 历史中。

## 本轮已完成

- 官方账号刷新会强制更新供应商额度，并重新读取账号、额度和本机登录状态；进行中禁用重复点击，失败在操作附近显示。
- Thinking 保持居中，不添加背景模糊；页面已有骨架、局部 Thinking 或打开的对话框时不重复出现页面加载提示。
- 账号额度详情改为紧凑展开，选中填充仅保留在账号主行，重置时间缩短显示，完整日期通过鼠标提示查看。
- WorkBuddy 与 WorkBuddyAI 统一绿色官方图标，国际版独立读取实际安装状态和版本，不复用国内版版本号。
- 标题依次展示名称、安装／下载入口、版本、另一客户端的切换入口。移除过宽的标题与切换组合占位、专属强制换行规则；切换入口后置。账号栏沿用保存的分栏宽度。
- 已在本机登录的账号不重复触发切换和重启；其他账号仍保留确认。WorkBuddy、WorkBuddyAI、Qoder 的官方登录与自定义模型可并存，切换／还原官方登录不移除独立导入的模型或撤销其 Key；Codex、Claude Code 仍区分官方与网关模式。
- 启动时“读取本地登录”卡片内展示 TokenFlow 图标与名称，和标题、说明统一左对齐；授权选择本身不变。
- GLM 模型的厂商图标改用 Z.ai 官网图标；ZCode 产品入口继续使用 ZCode 图标。

## 官方图标核对

范围包括账号授权平台、本地 Agent、模型厂商图标以及 TokenFlow 桌面进程图标。API 接口、Key、刷新、维修等通用操作继续使用应用自己的线性图标。

| 展示对象 | 资源 | 核对依据与结果 |
| --- | --- | --- |
| Codex / GPT | `codex.ico` | 与 [OpenAI 官方 CDN](https://cdn.oaistatic.com/assets/favicon-eex17e9e.ico) 字节相同；界面采用透明蒙版随主题显示。 |
| Claude Code / Claude | `claude.ico` | 与 [Claude 官网](https://claude.ai/favicon.ico) 字节相同；与安装版的星芒图形一致，桌面图标有橙色底属于官方不同载体版本。 |
| Antigravity | `antigravity.png` | 与 [Google 官方资源](https://antigravity.google/assets/image/antigravity-logo.png) 字节相同；安装版增加 macOS 图标底板。 |
| Kimi | `kimi.ico` | 与 [Kimi 官网](https://www.kimi.com/favicon-light.ico) 字节相同。 |
| xAI / Grok | `xai-mark.svg` | 图形路径取自 [xAI 官方 favicon](https://docs.x.ai/_next/static/media/favicon-light.1u6watcuoe8mg.svg)，移除白色底板并用蒙版适配主题；路径和裁切范围没有发现错误。保留原始 `xai.svg` 供溯源。 |
| Qoder / Qoder IDE | `qoder.png` | 与 [Qoder 官方 CDN](https://img.alicdn.com/imgextra/i4/O1CN01QkSxiCocd3D0prc8_!!6000000008124-2-tps-412-412.png) 字节相同；已查看本机两个客户端的官方图标。 |
| WorkBuddy / WorkBuddyAI | `workbuddy.png` | 由官方安装版 `Contents/Resources/icon.icns` 转为 PNG；与本机 WorkBuddy 5.8.3、WorkBuddyAI 5.5.2 转出文件 SHA-256 完全相同。旧的紫色 `workbuddy.svg` 不再用于界面。 |
| ZCode | `zcode.png` | 与 [ZCode 官网](https://zcode.z.ai/favicon-192x192.png?v=20260707-transparent) 字节相同。 |
| GLM / Z.ai | `zai.svg` | 直接取自 [Z.ai 官网声明的图标](https://z-cdn.chatglm.cn/z-ai/static/logo.svg)，替代此前误复用的 ZCode 产品标识。 |
| 豆包 | `doubao.png` | 与 [豆包官方 CDN](https://lf-flow-web-cdn.doubao.com/obj/flow-doubao/favicon/new-doubao/128x128.png) 字节相同。 |
| TRAE | `trae.png` | 与 [TRAE 官方 CDN](https://lf16-web-neutral.traecdn.ai/obj/trae-ai-static/trae_website/favicon.png) 字节相同。 |
| Cursor | `cursor.png` | 与 [Cursor 官网](https://cursor.com/marketing-static/icon-192x192-light.png) 字节相同；安装版使用不同底板／明暗层次的官方立方体，不视为串用品牌。 |
| DeepSeek Harness / DeepSeek | `deepseek.svg` | 与本机官方安装包内 `@deepseek-ai/dsh-web-frontend/dist/favicon.svg` 的所有图形路径相同；界面保留蓝色填充，桌面应用是深色图形与浅色底板。 |
| Pi Agent | `pi.svg` | 与 [Pi 官网](https://pi.dev/logo.svg) 字节相同，当前官网 `logo-auto.svg` 也是同一资源。 |

资源来源与本次文件校验值保存在 [sources.json](../../apps/console/public/provider-icons/sources.json)。未知来源保留现有文字缩写／来源平台回退，不凭空生成“官方图标”。

## 桌面与跨平台边界

- 本机 `/Applications/TokenFlow.app` 的主图标存在；Helper、Renderer、GPU、Plugin 四种辅助应用的 `CFBundleIconFile` 均为 `icon.icns`，文件 SHA-256 与主应用图标相同，没有残留 Electron 默认图标资源配置。
- macOS 打包后处理会同步辅助应用名称和图标；Windows、Linux 打包配置均指向 `apps/console/public/app-icon.png`，Linux 还配置了桌面启动标识。
- 上述 Windows／Linux 是源码与打包规则检查，本轮没有在对应系统实际安装并观察任务栏或进程列表；不能据此宣称真实跨平台图标已全部验收。

## 验证

- 类型检查与生产构建。
- Agent 安装检测、官方账号身份、账号区域可见性、桌面账号切换服务、额度和打包资源回归。
- 隔离界面分别在 1320、980、600 px 验证：WorkBuddy／WorkBuddyAI／Codex 的标题、用量、账号区位置一致；两个 WorkBuddy 客户端的版本位置稳定，本机账号不弹重复确认，其他账号需要确认。
- 启动提示在 1320 × 900、900 × 640 验证：图标与名称位于卡片内，和正文左对齐，只出现一组品牌标识，不溢出。
- 官网图标逐项下载比对；本机安装版图标只读提取和视觉核对。本轮没有改动第三方客户端登录、配置或系统权限。

本轮最终结果：8 个相关测试文件、76 项断言测试全部通过；类型检查和生产构建通过。官方登录与自定义模型并存的生产界面隔离检查另行通过。
