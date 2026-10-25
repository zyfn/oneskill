# 参考文档

[README](../README.zh-CN.md) · [English](reference.md)

## Agent 目录

目录表提供默认搜索路径。存在预设不代表该 Agent 的所有版本与能力格式均已完成兼容性验证。

| Agent | 默认 Skills 目录 |
| --- | --- |
| QwenWork | `~/.qwenworkcn/skills`（本机观察到的 macOS 兼容位置） |
| Qwen Code | `~/.qwen/skills` |
| Codex | `~/.codex/skills`（或 `$CODEX_HOME/skills`） |
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

MCP 配置数量包含 Agent 主配置与已发现插件的声明。相同 Agent、插件来源和服务名的缓存版本合并为一项，详情保留全部来源路径；不同插件中的同名服务分别统计。插件缓存不等于当前启用或运行状态。

## 管理库与链接

每个 Skill 包包含 `SKILL.md`。父文件夹定义分类，选择父分类时包含其子目录。**全部 Skills** 包含所有包，也包含直接位于 `skills/` 下的包。多级分支按需展开；存在分类时，目录栏保持可见。

链接指向共享包，不复制内容。目标已被占用时报告冲突，不覆盖已有文件。移动或重命名包后，扫描会提示指向管理库的失效链接。可以选择新位置重新链接，或仅移除失效引用；指向其他来源的链接不参与此操作。多级目录能否被加载取决于目标 Agent。

写入同一个 Skill 目录的 Agent 共用一个链接控制，例如 Qoder 与 Qoder CLI。Codex 写入 `~/.codex/skills` 或 `$CODEX_HOME/skills`。`~/.agents/skills` 等共享来源中的引用不自动点亮 Agent 目录开关，也不计入已链接数量；Agent 自身目录中其他位置的引用仍可只读查看。链接和取消链接只修改配置的目标目录，共享来源保留。客户端自行决定读取哪些兼容目录，目录链接不提供运行时隔离。

## 导入与恢复

**Skills → 未管理** 列出 Agent Skill 目录中实际位于管理库外的独立包。指向管理库的软链接属于已有引用，不会重复列为未管理的 Skill。

- **纳入管理**：将完整包移入管理库、保留父目录并备份原包。原位置不再保留包或自动创建链接，之后通过 Agent 开关按需连接。
- **选择**：在当前筛选列表中进入多选，一次可纳入、忽略或恢复最多 100 个可见条目。
- **忽略**：从未管理列表隐藏，保留文件与 Agent 的使用方式。
- **已忽略 → 恢复**：重新显示在未管理列表中。已忽略项仍可查看详情，不参与批量导入。

仅当内容与权限一致时复用同路径的共享包；内容不同则报告冲突。包内符号链接与特殊文件需要手动处理。列表展示来源 Agent，完整文件路径保留在详情中。`.system` 等目录名不作为 Agent 自带的判断依据。

导入将原包保存在来源 Agent 的 `.oneskill-backups/import-*/original` 中，并通过 `restore.json` 记录相关路径。手动恢复步骤：

1. 核对记录中的来源和目标路径。
2. 确认原位置为空。如果后来在此创建过链接，核实后仅移除该引用，保留真实文件。
3. 将原包移回记录中的位置。
4. 其他 Agent 仍在使用时，保留共享副本。

## 共享操作

共享操作契约提供 `setSkillsIgnored`，按所选 Skill ID 原子更新忽略偏好；`resolveSkillLink` 处理 `getWorkspace.linkIssues` 返回的失效链接。传入 `issueId` 和管理库中的 `skillId` 可重新链接，省略 `skillId` 则只移除该失效引用。所有写入需要唯一 `requestId`，可携带 `expectedRevision`；成功回执与后续扫描结果分别记录。

## 存储

| 位置 | 用途 |
| --- | --- |
| `skills/` | 统一管理库；除 `.gitkeep` 外，内容不进入 Git。 |
| `agents.catalog.json` | Agent 命令、图标、独立配置根目录、资源声明和官方来源。 |
| `agents.local.json` | 本地 Agent 定义与预设覆盖，不随 Git 分发。 |
| `skills.ignore.json` | 本地导入保护与持久化忽略规则，不随 Git 分发。 |
| Agent 的 `.oneskill-backups/` | 原包与导入恢复记录。 |
| `web/dist/` | 构建后的浏览器资源，不进入 Git。 |
| 浏览器本地存储 | 语言偏好，不保存 Skill 内容。 |

忽略规则按 Agent 与包的相对路径匹配：

```json
[{"agent":"codex","relative":".system/agent-guide","ignored":true}]
```

忽略规则为 JSON 数组，以 Agent 和包的相对路径匹配，通过原子文件替换保存。不读取旧名称规则。

服务只绑定本地回环地址。修改请求需要本地访问授权，读取与修改都要求授权。目前不提供远程托管或多用户账号体系。

## CLI

Web、CLI、MCP 共用同一个工作区服务，默认数据目录为 `~/.oneskill`。

```bash
npm run cli -- workspace --refresh
npm run cli -- skills
npm run cli -- agents
npm run cli -- plugins
npm run cli -- mcp-inventory
npm run cli -- call getSkill '{"skillId":"managed:review"}'
```

所有入口接受 `--workspace <目录>`；完整操作与参数见 `src/contracts/operations.mjs`。操作输出为 JSON，错误包含统一的 `code` 与 `message`。

## 平台与开发

需要 Node.js 20+、npm 与桌面浏览器。macOS 已进行人工验证；Linux、Windows 桌面流程仍待平台验收。Windows 可能需要开发者模式或相应的符号链接权限，Linux 打开目录需要桌面文件管理器。`oneskill.command` 是 macOS 启动器。

`--workspace <目录>` 为所有入口选择同一个管理库与偏好目录。内置 Agent 预设和 Web 资源仍由应用提供，工作区也可选用自己的 `agents.catalog.json`。

前端开发时，在两个终端分别运行 `npm run dev` 和 `npm run dev:web`。Vite 的 `ONESKILL_ENDPOINT` 指向 Web 命令输出的服务地址。`npm run check` 执行语法检查、文件系统与 API 测试，以及前端生产构建。


## 许可证与标识

项目采用 [MIT 许可证](../LICENSE)。Agent 名称与标识属于各自所有者。
