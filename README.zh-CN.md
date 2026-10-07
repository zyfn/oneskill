<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**统一管理 Skill，Agent 一键链接接入。**

[English](README.md) · **简体中文**

oneskill 是面向编程 Agent 的本地 Skill 管理工具。将 Skill 放在同一个管理库中，用熟悉的文件夹组织内容，自由决定每个 Skill 接入哪些 Agent。

## 为什么需要 oneskill

同时使用多个 Agent，往往也意味着维护多份 Skills 目录。一个好用的 Skill 被分别复制到 Codex、Claude Code 或其他工具里；下次修改时，哪些副本更新了、哪些还停留在旧版，都需要自己记住。切换 Agent，又要重新整理一遍。

oneskill 为这些 Skill 提供一个共同的归属。各 Agent 通过符号链接读取同一份源文件，修改集中在一处。你可以查看接入关系、逐个建立或取消链接，也可以让只属于某个 Agent 的包继续留在原处。

桌面 Web 界面与 CLI 共用同一套文件状态，无需云端账号或数据库，界面支持简体中文和英文。

## 由你掌握的管理库

- **文件就是管理库。** 包含 `SKILL.md` 的文件夹就是一个 Skill 包。用平时的工具编辑，脚本、参考资料和其他资源与它一起保存。
- **一份源文件，独立接入。** 共享包只需更新一次，已链接的 Agent 读取同一份内容。取消某个 Agent 的链接，源文件仍然保留。
- **目录就是分类。** 用父文件夹归类相关 Skill，支持多层嵌套。组织方式保存在文件系统中，无需另外维护标签。
- **按需纳入管理。** 导入已有包时提供原包备份与冲突检查。希望留给某个 Agent 的包可以忽略，需要时再恢复到列表中。

```text
oneskill/skills/code-review/            共享源文件
    ▲
    ├── ~/.agents/skills/code-review     符号链接
    └── ~/.claude/skills/code-review    符号链接
```

链接指向源文件所在的包。oneskill 管理这些接入关系，无需为每个 Agent 维护一份副本。

## 界面预览

**一个管理库，清晰的接入关系。** 在同一工作区中浏览目录、查看 Skill，并选择要接入的 Agent。

![按目录分类的 Skills 管理库与 Agent 链接](docs/screenshots/skills.png)

**本地 Agent 一览。** 集中查看发现的 Skills、管理库链接、原生插件和 MCP 配置。

![Agent 概览与本地能力统计](docs/screenshots/agents.png)

截图来自项目提供的样例工作区，可通过 `npm run demo` 体验。

## 快速开始

需要 **Node.js 20+**、npm 和桌面浏览器。

```bash
git clone https://github.com/zyfn/oneskill.git
cd oneskill
npm ci
npm start
```

## 从分散的 Skill 到共享管理库

### 1. 汇集已有 Skill

将包含 `SKILL.md` 的包放入 `skills/`，或打开 **Skills → 未管理**，查看各 Agent 目录中已有的包。选择 **纳入管理** 后，完整包会导入管理库，并链接回来源 Agent，该 Agent 可以继续使用。

原位置改为链接前会备份原包。目标位置存在不同内容时，oneskill 会报告冲突，不覆盖已有文件。

### 2. 用文件夹组织内容

像整理普通文件一样组织 Skill：

```text
skills/
├── engineering/
│   ├── code-review/SKILL.md
│   └── backend/query-plan/SKILL.md
├── writing/
│   └── technical-docs/SKILL.md
└── workspace-notes/SKILL.md
```

目录树与这些文件夹对应。需要时展开分支，选择父目录可查看其下所有 Skill，也可以收起整个目录栏，为管理库腾出空间。**全部 Skills** 包含所有包，也包含直接放在 `skills/` 下的包。

添加或调整目录后，点击 **重新扫描**。已链接的包需先取消链接，移动后再接入新位置。

### 3. 接入常用 Agent

管理库中的 Agent 列显示 **已链接** 与 **未链接**，点击即可调整。一个 Skill 可以接入多个 Agent、只接入一个，或暂不接入任何 Agent；它始终保留在管理库中。

链接操作在所选 Agent 的 Skill 目录中创建符号链接。取消链接只移除该链接，保留共享包。

### 4. 持续维护，按需取舍

直接修改共享 Skill，让已链接的 Agent 读取同一版本。通过搜索和目录聚焦需要的内容，查看包的详情，或打开文件夹继续编辑。

未管理的包不必全部纳入管理。选择 **忽略**，即可从待整理列表中隐藏它，保留文件与 Agent 的使用方式。忽略选择会在重新扫描和重启后保留；通过 **已忽略 → 恢复** 可以重新显示。

## 管理库之外

**Agent** 页面汇总已检测到的本地环境。**插件** 与 **MCP** 提供可搜索的只读清单，支持按 Agent 筛选和查看来源，方便了解每个 Agent 除了共享 Skill 之外还具备哪些能力。

## 兼容范围

Agent 清单集中记录 Codex、Claude Code、Cursor、Gemini CLI、Qwen Code 等工具的命令、官方配置约定和兼容位置。共用规则只写一次，macOS 与 Windows 的配置根目录明确列出。通过 `agents.local.json` 新增 Agent 或覆盖预设，重新扫描即可生效，见[本地定义示例](agents.local.example.json)。`agents.registry` 的旧目录覆盖方式仍受支持，共享 Skill 目录可能被多个 Agent 读取。

CLI 只有在 `--version` 成功退出并返回可识别的版本时才算检测通过；失败记录会显示真实错误码。桌面应用与扩展仅确认安装信息，不代表运行健康。Qoder 桌面版与 Qoder CLI 分别登记。配置目录独立扫描，不能证明 Agent 已安装。Skill 的加载方式遵循各 Agent 自身的规则。检测方式与边界见 [Agent 扫描说明](docs/agent-discovery.md)，目录预设与能力扫描范围见[参考文档](docs/reference.zh-CN.md)。

## CLI

在终端中操作同一份管理库与接入关系：

```bash
npm run cli -- skills --json
npm run cli -- link codex engineering/code-review
npm run cli -- unlink codex engineering/code-review
npm run cli -- validate
```

运行 `npm run cli -- help` 查看可用命令，或阅读 [CLI 参考](docs/reference.zh-CN.md#cli)。

## 开发与贡献

```bash
npm --prefix web ci
npm run dev          # API 与构建后的界面
npm run dev:web      # 在另一终端启动 Vite 开发服务
npm run check        # 语法检查、测试与生产构建
```

前端使用 React、Vite 和 Tailwind CSS。扫描器、文件操作、HTTP API 与 CLI 位于 `src/`，界面位于 `web/src/`。

欢迎贡献 Agent 扫描适配、平台验证与具体的交互改进。修改扫描器时附上脱敏的测试样例；修改界面时检查中英文两种语言；提交 PR 前运行 `npm run check`。

## 文档

- [配置、存储与导入恢复](docs/reference.zh-CN.md)
- [设计规范](docs/design.md)
