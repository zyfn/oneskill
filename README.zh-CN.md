<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**统一管理 Skill，Agent 一键链接接入。**

[English](README.md) · **简体中文**

oneskill 是面向编程 Agent 的本地 Skill 管理工具。将 Skill 包集中存放，通过符号链接供多个 Agent 共用，减少重复维护和版本不一致的问题；支持按文件夹分类，以及管理每个 Skill 的 Agent 接入关系。

## 功能

- **Skill 管理**：每个包只保存一份，通过符号链接接入多个 Agent。取消链接保留源文件。
- **目录分类**：支持嵌套文件夹、目录筛选、搜索和详情查看。
- **导入与忽略**：导入已有包时提供备份和冲突检查，也可以忽略需要留在 Agent 目录中的包。
- **本地界面与 CLI**：浏览器和终端操作同一套文件，界面支持中英文，无需云端账号或数据库。

```text
oneskill/skills/code-review/            共享源文件
    ▲
    ├── ~/.agents/skills/code-review    符号链接
    └── ~/.claude/skills/code-review    符号链接
```

建立和取消链接只增删符号链接，不删除管理库中的源文件。

## 界面预览

**Skills 管理。** 按目录浏览 Skill，查看内容和各 Agent 的链接状态。

![按目录分类的 Skills 管理库与 Agent 链接](docs/screenshots/skills.png)

**Agent 概览。** 查看检测结果和本地 Skill、插件、MCP 数量。

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

## 使用说明

### 1. 添加与导入 Skill

将包含 `SKILL.md` 的包放入 `skills/`，或打开 **Skills → 未管理**，查看各 Agent 目录中已有的包。选择 **纳入管理** 后，完整包会导入管理库，并链接回来源 Agent，该 Agent 可以继续使用。

原位置改为链接前会备份原包。目标位置存在不同内容时，oneskill 会报告冲突，不覆盖已有文件。

### 2. 用文件夹组织内容

在 `skills/` 下建立父文件夹，将相关的 Skill 放在一起：

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

### 3. 链接与取消链接

管理库中的 Agent 列显示 **已链接** 与 **未链接**，点击即可调整。一个 Skill 可以接入多个 Agent、只接入一个，或暂不接入任何 Agent；它始终保留在管理库中。

链接操作在所选 Agent 的 Skill 目录中创建符号链接。取消链接只移除该链接，保留共享包。

### 4. 编辑与忽略

直接修改共享 Skill，让已链接的 Agent 读取同一版本。通过搜索和目录聚焦需要的内容，查看包的详情，或打开文件夹继续编辑。

选择 **忽略**，即可从未管理列表中隐藏该包，不改变文件或 Agent 的使用方式。忽略选择会在重新扫描和重启后保留；通过 **已忽略 → 恢复** 可以重新显示。

## Agent、插件与 MCP

**Agent** 页面展示检测结果和本地资源数量。**插件** 与 **MCP** 提供可搜索的只读清单，支持按 Agent 筛选和查看来源。

## Agent 适配与检测

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
