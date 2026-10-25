<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**统一管理 Skill，Agent 一键链接接入。**

[English](README.md) · **简体中文**

[![Check](https://github.com/zyfn/oneskill/actions/workflows/check.yml/badge.svg)](https://github.com/zyfn/oneskill/actions/workflows/check.yml)

oneskill 是面向编程 Agent 的本地 Skill 管理工具。将 Skill 集中存放在 `~/.oneskill/skills/`，用文件夹组织内容，再通过符号链接接入各 Agent 目录，减少重复维护和版本不一致的问题。

## 运行原理

![一份 Skill 管理库，通过符号链接供多个 Agent 读取](docs/architecture.svg)

1. **集中保存文件**：将已有 Skill 纳入 `~/.oneskill/skills/`。oneskill 会校验内容、保留原包备份，再将它从原位置移走。
2. **选择接入的 Agent**：在 Skill 详情中打开对应开关，oneskill 会在该 Agent 配置的 Skill 目录里创建符号链接，指向管理库中的包。仅纳入管理不会创建链接。
3. **维护同一份内容**：已接入的 Agent 读取同一份文件。取消接入只移除链接，管理库中的包继续保留。

Web、CLI 和 Codex 插件共用一个本地工作区服务，由当前使用的入口自动启动，文件保存在本机。[技术架构](docs/architecture.md)中进一步说明了扫描、快照、校验与写入恢复。

## 安装

需要 **Git、Node.js 20+ 和 npm**。先选择一种入口；它们共用同一个工作区。

| 入口 | 适合的使用场景 | 需要完成的安装步骤 |
| --- | --- | --- |
| Web | 在浏览器中浏览和管理 Skill | 1 + 2 |
| CLI | 在终端读取 JSON、调用工作区操作 | 1 |
| Codex 插件 | 在 Codex 内打开界面、通过对话调用工具 | 1 + 2 + 3 |

### 1. 获取程序

```bash
git clone https://github.com/zyfn/oneskill.git
cd oneskill
npm ci
```

后续命令都在这个源码目录中执行。Skill 管理库独立存放在 `~/.oneskill/skills/`。

### 2. 构建共用界面

使用 **Web 或 Codex 插件**时，安装前端依赖并构建两种界面格式：

```bash
npm --prefix web ci
npm run build
```

这一步生成浏览器界面和 Codex 内嵌界面。只使用 CLI，完成第 1 步即可。

### 3. 安装 Codex 插件

还需要命令行中可用的 **Codex CLI**（`codex` 命令），以及支持本地插件和 MCP Apps 的桌面客户端。

```bash
npm run build:plugin
codex plugin marketplace add ./dist/marketplace
codex plugin add oneskill@oneskill-local
```

生成的插件包含服务代码、构建好的界面和 Agent 清单。个人 Skill 继续保存在工作区中。

## 使用方式

### Web

完成安装第 1、2 步后，运行：

```bash
npm start
```

命令会启动本地服务并打开浏览器。macOS 也可以双击 `oneskill.command`。需要在其他浏览器打开时，复制终端输出的**完整访问链接**；仅输入端口无法为新会话完成授权。

### CLI

完成安装第 1 步后，通过 Node 直接执行命令，结果以 JSON 输出：

```bash
node src/cli.mjs workspace
node src/cli.mjs skills
node src/cli.mjs agents
node src/cli.mjs plugins
node src/cli.mjs mcp-inventory
```

使用 `node src/cli.mjs workspace --refresh` 重新扫描，使用 `node src/cli.mjs help` 查看命令。修改操作使用 `workspace` 返回的 Agent 和 Skill 标识。例如，将以下示例中的标识替换为自己的数据，再建立链接：

```bash
node src/cli.mjs call setSkillLink '{"agentId":"agent:codex","skillId":"managed:engineering/code-review","linked":true}'
```

`call` 会为修改操作生成请求标识。参数及其他操作见[操作参考](docs/reference.zh-CN.md)。

### Codex 插件

完成安装第 1～3 步后，重启 Codex 桌面客户端，在侧边栏或更多应用菜单中打开 **oneskill**。插件自动启动本地服务，使用与 Web 相同的界面和管理库。

也可以在对话中让 Codex 调用工具，例如：**“使用 oneskill 查看未管理的 Skill。”** 入口位置由宿主客户端决定；插件更新后，已打开的面板可能需要关闭后重新打开。

## 管理 Skill

1. **添加包**：将包含 `SKILL.md` 的文件夹放入管理库，或选择 **Skills → 未管理 → 纳入管理**。纳入时迁移原包并保留备份，之后再按需连接 Agent。
2. **接入 Agent**：选择管理库中的 Skill，打开对应的 Agent 目录开关。Codex 的目标为 `~/.codex/skills/`，设置 `CODEX_HOME` 时使用其下的 `skills/`。写入同一物理目录的产品共用一个开关；`~/.agents/skills/` 等共享发现目录与这些开关分开记录。
3. **整理和编辑**：目录树对应真实文件夹，直接修改库中的文件即可。移动已链接的包后，通过链接异常面板重新关联原引用，或仅删除失效链接。具体重载时机和多级目录支持遵循 Agent 自身的规则。
4. **让原包留在原处**：在未管理列表选择 **忽略**，通过 **已忽略 → 恢复** 可重新显示。点击 **选择** 可对最多 100 个可见包批量纳入、忽略或恢复。指向管理库的链接属于已有引用，不重复作为未管理包展示。

**Agent** 展示安装状态与本地数量。**插件**和 **MCP** 以可搜索的小卡片展示只读清单。数量代表发现的包与配置声明，可能包含未启用项，不代表 MCP 实时连接数；同一个物理配置根目录在全局只计一次。

## 界面预览

**Skills 管理库与 Agent 接入关系**

![按目录分类的 Skills 管理库与 Agent 链接](docs/screenshots/skills.png)

**Agent 概览**

![Agent 概览与本地能力统计](docs/screenshots/agents.png)

## 工作区与 Agent 配置

首次使用会在用户主目录创建工作区和空管理库：

| 系统 | 工作区 | Skill 管理库 |
| --- | --- | --- |
| macOS | `~/.oneskill/` | `~/.oneskill/skills/` |
| Windows | `%USERPROFILE%\.oneskill\` | `%USERPROFILE%\.oneskill\skills\` |

源码目录和插件缓存存放程序。个人 Skill、覆盖配置、忽略选择和导入备份不会随源码或插件包分发。

```text
~/.oneskill/
├── skills/
│   ├── engineering/
│   │   └── code-review/SKILL.md
│   └── writing/
│       └── technical-docs/SKILL.md
├── agents.local.json      # 可选的 Agent 定义与覆盖项
└── skills.ignore.json     # 持久保存的忽略选择
```

内置 [Agent 清单](agents.catalog.json) 声明命令、图标、macOS 和 Windows 配置目录及资源读取规则。在工作区创建 `agents.local.json`，即可新增 Agent 或覆盖预设，然后重新扫描：

```json
[
  {
    "name": "example-agent",
    "commands": ["example-agent"],
    "configDir": {
      "macos": "~/.example-agent",
      "windows": "${USERPROFILE}/.example-agent"
    },
    "skillDir": "skills"
  }
]
```

相对资源路径基于当前系统选定的配置根目录。已有 JSON、JSONC、TOML 和插件清单读取器可通过配置复用；新的私有格式仍需实现对应扫描器。支持范围见 [Agent 扫描说明](docs/agent-discovery.md)和[参考文档](docs/reference.zh-CN.md)。

检测到 Agent 安装不代表支持它的全部资源格式。Skill 加载及多级目录支持遵循各 Agent 的规则。Windows 可能需要开发者模式或相应的符号链接权限，原生桌面行为仍需按平台验证。

### 指定其他工作区

管理库存放在其他位置时，为所有入口指定**同一个绝对目录**：

```bash
node src/cli.mjs web --open --workspace /absolute/path/to/workspace
node src/cli.mjs skills --workspace /absolute/path/to/workspace
npm run build:plugin -- --workspace /absolute/path/to/workspace
```

Codex 插件需要在选定目录后安装生成的包。默认插件包使用当前用户的 `~/.oneskill/`。

### 更新程序

在源码目录运行 `git pull` 和 `npm ci`。Web 与插件用户再重复安装第 2 步构建界面；插件用户还需重复第 3 步，并重新打开 Codex 客户端。

## 开发与贡献

```bash
npm run dev          # 本地服务与构建后的界面
npm run check        # 语法检查、测试与两个界面的构建
```

前端热更新时，先启动本地服务，再将 Vite 指向终端输出的服务地址：

```bash
ONESKILL_ENDPOINT=http://127.0.0.1:PORT npm run dev:web
```

Node.js 运行时与文件操作位于 `src/`，React、Vite 和 Tailwind CSS 界面位于 `web/src/`。模块边界见[架构说明](docs/architecture.md)。扫描器变更请提供脱敏测试样本，界面变更请检查中英文，并运行 `npm run check`。

## 许可证

[MIT](LICENSE)。Agent 名称及 Logo 归各自所有者所有。
