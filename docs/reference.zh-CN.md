# 参考文档

[README](../README.zh-CN.md) · [English](reference.md)

## Agent 目录

目录表提供默认搜索路径。存在预设不代表该 Agent 的所有版本与能力格式均已完成兼容性验证。

| Agent | 默认 Skills 目录 |
| --- | --- |
| QwenWork | `~/.qwenworkcn/skills`（本机观察到的 macOS 兼容位置） |
| Qwen Code | `~/.qwen/skills` |
| Codex | `~/.agents/skills` |
| Claude Code | `~/.claude/skills` |
| Qoder | `~/.qoder/skills` |
| Qoder CLI | `~/.qoder/skills` |
| Qoder CN | `~/.qoder-cn/skills` |
| Cursor | `~/.cursor/skills` |
| Gemini CLI | `~/.gemini/skills` |
| Antigravity | `~/.gemini/config/skills` |
| GitHub Copilot | `~/.copilot/skills` |
| OpenCode | `~/.config/opencode/skills` |
| OpenClaw | `~/.openclaw/skills` |
| Pi | `~/.pi/agent/skills` |
| DeepSeek | `~/.dsh/skills` |
| Cline | `~/.cline/data/settings/skills` |
| Windsurf | `~/.codeium/windsurf/skills` |
| Kiro | `~/.kiro/skills` |
| TraeCode CLI | 暂未配置，公开资料未确认安装目录 |
| Kimi Code | `~/.kimi-code/skills` |

在 `agents.local.json` 中覆盖预设字段，然后重新扫描。Skill 目标可以独立于 Agent 配置根目录设置：

```json
[{ "name": "codex", "skillDir": "/absolute/path/to/codex/skills" }]
```

安装检测独立于这些目录，oneskill 不负责安装 Agent。支持的覆盖规则与平台边界见 [Agent 扫描说明](agent-discovery.md)。

## 新增 Agent

安装已有预设对应的工具后，点击重新扫描。全新 Agent 可复制 `agents.local.example.json` 为 `agents.local.json`，填写命令名；需要统计资源时，再声明 Skill 目标、配置根目录与配置文件格式。名称和命令名可以不同，也支持直接指定可执行文件绝对路径。

本地定义不随 Git 分发，新增、修改和删除后重新扫描即可生效。未配置的资源显示 `—`；不根据命令名猜测目录。

命令、图标、资源子目录和 MCP 读取规则共用。`configDir.macos` 与 `configDir.windows` 明确列出根目录，程序先识别系统，再展开路径；相对的 `skillDir`、`pluginDirs` 和 MCP 文件使用所选根目录。覆盖已有预设时可省略未修改的字段。详见[扫描说明](agent-discovery.md)和[官方目录核验记录](agent-paths.md)。

## 扫描范围

| 类别 | 行为与边界 |
| --- | --- |
| Agent | **已安装**需匹配命令、支持的 macOS 应用包或扩展身份。CLI 执行 `--version`，记录版本或独立的失败结果；配置目录不参与安装判定。不检查登录和会话状态。 |
| Skills | 递归发现管理库与个人 Skill 目录中的 `SKILL.md` 包，不完整覆盖项目级与插件内的 Skill。 |
| 插件 | 读取支持的原生清单，包括 `.codex-plugin/plugin.json`、`.claude-plugin/plugin.json`、`plugin.json` 及符合插件字段的 `package.json`。缓存版本可能未启用，普通 VS Code 扩展不计入。 |
| MCP | 统一读取声明的 JSON、JSONC、TOML 配置与字段，保留读取失败的诊断；发现配置不代表服务器健康检查通过。 |
| Hooks | 通过 CLI 读取支持的 JSON Hook 配置，不提供独立 Hooks 页面。 |

**本地 Skills** 包含当前 Agent Skill 目录中发现的有效链接包；**已链接 Skill**只统计指向当前管理库的链接。插件与 MCP 页面为只读视图。

扫描限制根目录、深度与条目数量，跳过历史、会话、依赖和构建产物。数量末尾的 `+` 表示达到扫描限制。缺失的位置、不支持的格式或不可读取的文件可能使结果不完整。配置详情不返回命令参数、环境变量值或密钥。

## 管理库与链接

每个 Skill 包包含 `SKILL.md`。父文件夹定义分类，选择父分类时包含其子目录。**全部 Skills** 包含所有包，也包含直接位于 `skills/` 下的包。多级分支按需展开，整个目录栏也可以收起。

链接指向共享包，不复制内容。目标已被占用时报告冲突，不覆盖已有文件。移动或重命名已链接的包前，先取消链接，再移动、重新扫描并链接新位置。多级目录能否被加载取决于目标 Agent。

## 导入与恢复

**Skills → 未管理** 列出 Agent Skill 目录中尚未进入共享库的包。

- **纳入管理**：导入完整包、保留父目录、备份原包，再链接回来源 Agent。
- **批量纳入管理**：进入多选导入流程。
- **忽略**：从未管理列表隐藏，保留文件与 Agent 的使用方式。
- **已忽略 → 恢复**：重新显示在未管理列表中。已忽略项仍可查看详情，不参与批量导入。

仅当内容与权限一致时复用同路径的共享包；内容不同则报告冲突。包内符号链接与特殊文件需要手动处理。列表展示来源 Agent，完整文件路径保留在详情中。`.system` 等目录名不作为 Agent 自带的判断依据。

导入将原包保存在来源 Agent 的 `.oneskill-backups/import-*/original` 中，并通过 `restore.json` 记录相关路径。手动恢复步骤：

1. 核对记录中的来源和目标路径。
2. 移除该 Agent 对应的符号链接。
3. 将原包移回记录中的位置。
4. 其他 Agent 仍在使用时，保留共享副本。

## 存储

| 位置 | 用途 |
| --- | --- |
| `skills/` | 统一管理库；除 `.gitkeep` 外，内容不进入 Git。 |
| `agents.catalog.json` | Agent 命令、图标、独立配置根目录、资源声明和官方来源。 |
| `agents.local.json` | 本地 Agent 定义与预设覆盖，不随 Git 分发。 |
| `migrate.ignore` | 本地导入保护与持久化忽略规则，不随 Git 分发。 |
| Agent 的 `.oneskill-backups/` | 原包与导入恢复记录。 |
| `web/dist/` | 构建后的浏览器资源，不进入 Git。 |
| 浏览器本地存储 | 语言与目录栏展开偏好，不保存 Skill 内容。 |

忽略规则按 Agent 与包的相对路径匹配：

```json
{"agent":"codex","relative":".system/agent-guide","ignored":true}
```

旧的 `Agent:Skill名称` 保护规则继续生效。路径级 `ignored:false` 可以恢复一个包，不影响其他位置同名包的保护。偏好通过原子文件替换保存。

服务只绑定本地回环地址。修改请求需要本地访问授权，浏览器会在必要时续期。目前不提供远程托管或多用户账号体系。

## CLI

使用 `npm run cli -- <命令>` 执行。

| 命令 | 用途 |
| --- | --- |
| `detect [--json]` | 扫描配置的工作区并报告能力。 |
| `skills [--json]` | 列出共享 Skill 与 Agent 链接。 |
| `plugins [--json]` | 列出发现的原生插件清单。 |
| `mcp [--json]` | 列出发现的 MCP 服务器配置。 |
| `hooks [--json]` | 列出发现的 Hook 配置。 |
| `agents [--json]` | 列出 Agent 的安装与配置发现结果。 |
| `link <agent> <skill>` | 按管理库内的相对路径为 Agent 链接 Skill。 |
| `unlink <agent> <skill>` | 移除 Agent 中的管理库链接。 |
| `validate` | 报告悬空链接与冲突；发现问题时以非零状态退出。 |
| `help` | 显示命令帮助。 |

Agent JSON 中，`installed` 与 `detected` 表示程序安装证据，`configured` 独立表示配置目录存在。CLI 的 `runnable` 表示 `--version` 执行结果，`version` 保存识别到的版本；桌面应用和扩展的 `runnable` 为 null。`status` 分为 `installed`、CLI 探测失败时的 `unavailable`、以及 `not-detected`；`detection.evidence` 记录来源、路径与 CLI 探测错误。版本检查成功不保证登录或会话状态正常。

## 平台与开发

需要 Node.js 20+、npm 与桌面浏览器。macOS 已进行人工验证；Linux、Windows 桌面流程仍待平台验收。Windows 可能需要开发者模式或相应的符号链接权限，Linux 打开目录需要桌面文件管理器。`oneskill.command` 是 macOS 启动器。

`--workspace <目录>` 可为 CLI 和 Web 服务指定独立的管理库与偏好目录。内置 Agent 预设和 Web 资源仍由应用提供，工作区也可选用自己的 `agents.catalog.json`。

前端开发时，在两个终端分别运行 `npm run dev` 和 `npm run dev:web`。默认 `/api` 代理指向 8787 端口。`npm run check` 执行语法检查、文件系统与 API 测试，以及前端生产构建。


## 许可证与标识

项目采用 [MIT 许可证](../LICENSE)。Agent 名称与标识属于各自所有者。
