# Claude Desktop 接入依据

核查日期：2026-10-16。官方文档与本机 `/Applications/Claude.app/Contents/Resources/app.asar`（`@ant/desktop` 2.37337.1）静态代码相互核对。未读取或修改真实 Cookie、登录凭证、用户配置；未进行真实账号切换。下列内部函数名只对应这个安装包版本。

## 官方支持的接入面

CLI 使用 `~/.claude/settings.json` 的 `env`；VS Code 的启动登录检查还需要 `claudeCode.environmentVariables`；独立桌面应用使用自己的第三方推理配置。桌面端不以 CLI 的 `ANTHROPIC_BASE_URL` 作为接入入口。[官方 gateway 指南](https://code.claude.com/docs/en/llm-gateway-connect#desktop-app)

桌面端可从 Help → Troubleshooting → Enable Developer Mode，再打开 Developer → Configure Third-Party Inference。Apply Changes 保存到本机并重启；管理员配置可能使表单只读。[官方本机配置说明](https://claude.com/docs/third-party/claude-desktop/in-app-configuration)

正式本地位置为 `Claude-3p/configLibrary/`：macOS 在 `~/Library/Application Support/` 下，Windows 在 `%LOCALAPPDATA%` 下，Linux 在 `~/.config/` 下。`_meta.json` 选择同目录的 `<id>.json`。一般的管理员配置优先；只有更新、生命周期、网络代理等应用行为策略时，推理配置仍可本地修改。改动需完全退出后重开。`inferenceModels` 的首项是默认模型，`alwaysStartWithDefaultModel` 可使新会话始终采用它。[官方配置参考](https://claude.com/docs/third-party/claude-desktop/configuration)

Gateway 必须实现 Anthropic Messages API 的流式响应和工具调用；静态凭证字段为 `inferenceGatewayApiKey`，认证方式可选 `bearer` 或 `x-api-key`。这条官方桌面路径面向 Claude 模型。[官方 gateway 部署说明](https://claude.com/docs/third-party/claude-desktop/gateway)

## 原生格式与读取证据

静态证据：安装包 `.vite/build/index.pre.js` 的 `JZ/eQ/nQ/f$/p$/g$/g1/_1`，以及 `.vite/build/index.chunk-BWk6pVUt.js` 的 `UI/WI/GI/YI/vWn/USa/QI/$I/WVe`。

- `appliedId` 必须匹配 `/^[a-f0-9-]{36}$/`；元数据形如 `{ "appliedId": "<uuid>", "entries": [{ "id": "<uuid>", "name": "TokenFlow" }] }`。
- `hybridPointer: { bootstrapUrl: "..." }` 有效时优先于 `appliedId`。原生切换到另一配置时删除它，因此接入和还原必须一起记录这个字段。
- 原生 Apply 先修改 `appliedId`，再把 `Claude-3p/claude_desktop_config.json` 的 `deploymentMode` 改为 `3p`。`1p` 会使本地 3P 配置休眠，但不能覆盖禁止官方登录的管理员策略。
- Windows 旧 `%APPDATA%/Claude-3p` 会在启动时尝试迁移到 `%LOCALAPPDATA%/Claude-3p`。未迁移的旧目录不能无提示地忽略。`CLAUDE_USER_DATA_DIR` 属于特殊启动行为，不能当成一般默认路径。
- Gateway URL 校验接受 HTTPS，HTTP 仅允许 loopback；TokenFlow 的 `http://127.0.0.1:<port>` 符合这一条件。
- 下例使用本地 JSON 原生类型。无需将数组编码成字符串；那个要求针对 plist/registry。

```json
{
  "inferenceProvider": "gateway",
  "inferenceCredentialKind": "static",
  "inferenceGatewayBaseUrl": "http://127.0.0.1:PORT",
  "inferenceGatewayApiKey": "TOKENFLOW_LOCAL_KEY",
  "inferenceGatewayAuthScheme": "bearer",
  "modelDiscoveryEnabled": false,
  "inferenceModels": [
    { "name": "claude/claude-sonnet-4-6", "labelOverride": "Claude Sonnet" }
  ],
  "alwaysStartWithDefaultModel": true,
  "isClaudeCodeForDesktopEnabled": true
}
```

## 模型限制

安装包模型字段先作非空检查，随后由 `Co("gateway", name)` → `lCe/So` 检查是否引用 Anthropic 模型。不能只复制第一层 schema 就判定任意模型均受支持。纯函数隔离执行结果：

| 路由名 | 原生检查 |
| --- | --- |
| `claude/claude-sonnet-4-6` | 通过 |
| `qoder/claude-sonnet-4-6` | 通过 |
| `workbuddy/claude-sonnet-4-6` | 通过 |
| `codex/claude-sonnet-4-6` | 拒绝 |
| `deepseek/claude-sonnet-4-6` | 拒绝 |
| `qoder/gpt-5` | 拒绝 |

命名空间也参与检查。`name` 是发给 gateway 的实际模型 ID；`labelOverride` 仅改变显示文字，没有独立的上游 `modelId` 映射。产品应仅展示实际 Claude 模型并验证完整路由；不能把其他模型改名为 Claude 绕过检查。原生 `aMe` 会过滤部分非法模型，不能把“JSON 保存成功”当成接入成功。

## 原登录与恢复边界

桌面官方登录走应用内 Google／邮箱流程。[官方登录说明](https://support.claude.com/en/articles/13189465-log-in-to-your-claude-account) 官方公开的 `claude://` 链接支持聊天、项目、Code、Cowork；没有公开的账号切换或第三方配置链接。[官方深链接列表](https://support.claude.com/en/articles/14729294-open-claude-desktop-with-a-link)

静态代码的桌面登录路径要求当前 Electron 会话中 HttpOnly、Secure 的 `sessionKey`，并验证账号和组织；CLI OAuth token 不能代替这个 Cookie。TokenFlow 应恢复自己的桌面接入改动，打开已核验的 Claude 应用，让用户通过原生账号菜单完成登录或切换。不得声称 CLI 账号池已切换桌面官方账号。

建议恢复事务只备份/还原自有 profile、元数据所改键、`deploymentMode`；保留用户后来新增的配置和其他设置。首次备份应跨多次模型切换保留。还原前比对当前仍属于 TokenFlow 的状态；若用户已在原生应用改用其他 profile，则拒绝覆盖并给出说明。配置文件必须私有权限、原子写入，进程须已安全退出；备份含网关密钥，按凭证处理。

不要调用安装包内部的 `setDeploymentMode("1p")` 冒充无损恢复：其 `FWn` 分支会调用 `wWn/SWn` 清除或撤销多种第三方凭证。直接还原 TokenFlow 所改的部署选择、保留原第一方用户目录、Cookie 和钥匙串，可避免主动登出原账号；原登录是否仍有效仍由服务端会话有效期决定。

上述恢复建议来自原生存储与生命周期代码的推导，不是 Anthropic 提供的外部事务 API。应以临时目录进行失败回滚、重复切换、外部改动、缺文件及跨平台路径测试；没有真实账号的环境不能宣称已验证 OAuth 往返或真实桌面推理。

## 管理策略和进程识别补充

macOS 管理域为 `com.anthropic.claudefordesktop`。机器文件是 `/Library/Managed Preferences/com.anthropic.claudefordesktop.plist`；用户文件是 `/Library/Managed Preferences/<username>/com.anthropic.claudefordesktop.plist`，后者覆盖前者同名键。原生 `XQ/CQ` 使用 `os.userInfo().username`，并非环境变量里的任意用户名。

Windows 读取 `HKLM\SOFTWARE\Policies\Claude` 和 `HKCU\SOFTWARE\Policies\Claude`。机器键直接包含任意 `REG_SZ`、`REG_EXPAND_SZ` 或 `REG_DWORD` 值即屏蔽整个用户层，包括空字符串及已设置的默认值。子键不计；`REG_EXPAND_SZ` 虽占据优先级，内容却不可读。[官方管理配置与优先级](https://claude.com/docs/third-party/claude-desktop/mdm#4-deploy-the-configuration)

Linux 管理文件是 `/etc/claude-desktop/managed-settings.json`；文件与父目录要求 root 所有且不可由普通用户改写。存在但不满足条件时会阻止本地配置。[官方 Linux 管理配置](https://claude.com/docs/third-party/claude-desktop/configuration#linux)

TokenFlow 的保守保护可在发现管理源、权限不足或无法确定系统用户名时拒绝自动改写；不能把读取失败等同于不存在。若暂未实现上述“仅应用行为键”例外，应明确显示暂不支持受管理设备，不能称官方禁止此类本地配置。

本机 `Info.plist` 已只读验证：`CFBundleIdentifier=com.anthropic.claudefordesktop`，`CFBundleExecutable=Claude`。原生启动代码通过 `app.setPath("userData", ...)` 切换 3P 数据目录，1P/3P 使用同一 bundle 和可执行程序。进程验证应以这个安装包身份为准，不依靠通用的 `claude` 同名进程。

原生 `index.pre.js` 的 `AZ` 会在普通打包应用启动时删除 `CLAUDE_USER_DATA_DIR`；只有受签名验证的特殊测试启动允许它生效。TokenFlow 若发现环境中此值非空，应拒绝未经验证的特殊目录自动写入，而非盲目遵循这个环境变量或自行移除用户启动设置。

模型检查的纯函数等价式是：先转小写，拒绝命中原生非 Anthropic 型号/厂商名单的完整路由，再接受 `sonnet|opus|haiku|fable|mythos` 数字别名或包含 `claude|sonnet|opus|haiku|fable|mythos|anthropic` 的名字。完整名单包含 `codex`、`deepseek`、`gpt`、`gemini`、`qwen` 等，因此只检查末尾型号会误判。TokenFlow 可采用更保守的真实 Claude 型号白名单并验证完整路由，不需要复制并长期依赖整套内部函数。
