# oneskill

**Agent skill 的统一管理：一份真身，按需链接分发。**

同一台机器上跑多个 Agent（Codex、Claude Code、Gemini CLI……）时，它们各有各的 skills 目录。想让几个 Agent 共用同一个 skill，只能复制几份分别放进去；skill 一更新，其余副本立刻过期，改哪份、漏哪份全靠自己记。

oneskill 把 skill 的真实内容只存放一处（源目录），各 Agent 的 skills 目录里放指向它的符号链接。改源目录，所有 Agent 同时生效；删掉某条链接，就收回那个 Agent 的使用权，真实内容不受影响。

## 优势

- **单一副本，不会过期** — 真实内容只有一份，更新即全员生效，不需要同步任何副本
- **零配置** — 没有注册、启用之类的步骤；Agent 目录从名单自动解析，文件夹拷到任何位置即可用
- **只增删链接** — 不覆盖、不删除任何真实内容；批量移除必须显式确认

## 工作原理

名单（agents.registry）记录每个 Agent 的标准 skills 目录，脚本据此解析路径，在对应目录创建符号链接：

```
                          ┌─ symlink ▶ ~/.claude/skills/my-skill
oneskill/skills/my-skill ─┤
                          └─ symlink ─▶ ~/.codex/skills/my-skill
```

三个查看命令各读一层状态：`detect` 读名单与文件系统，报安装状态；`list` 读源目录与各 Agent 目录，报链接状态；`validate` 读链接指向，报悬空状态。

## 运行环境

| 项 | 要求 |
| --- | --- |
| 系统 | macOS / Linux / WSL2，bash 3.2 及以上（macOS 系统自带 bash 即可） |
| 依赖 | 无，单文件脚本 |

## 快速开始

以下示例使用一个名为 `my-skill` 的 skill，机器上装着 Codex 和 Claude Code。

**1. 安装**

oneskill 是单文件脚本、没有依赖，clone 到任意位置即可（脚本按自身所在目录定位源目录和名单）。下面以 clone 进家目录为例：

```bash
git clone https://github.com/zyfn/oneskill.git ~/oneskill
cd ~/oneskill
```

**2. 打开管理页面**

macOS 上双击 `oneskill.command` 即可：起一个只监听 127.0.0.1 的本地服务并自动开浏览器，地址里带一次性 token。其它系统或终端里：

```bash
python3 oneskill.py serve --open
```

页面有三个视图：**Agents**（名单与安装状态、加 Agent）、**Skills**（skill × agent 链接矩阵，开关即 link/unlink）、**Migrate**（扫描各 Agent 目录里散落的真实 skill 目录，勾选后一键收编）。

**3. 收编散落的 skill**

Migrate 视图列出每个已安装 Agent 目录下「不是符号链接」的 skill 目录。勾选、点 Migrate selected：真实目录移进源目录，原位置留下符号链接——该 Agent 继续可用，真身从此只有一份。

各 Agent **自带的** skill 不要收编（会随官方更新被覆盖或重建）。它们默认被 `migrate.ignore` 保护名单隐藏（每行 `agent:skill名`），扫描不会列出来，误点不到。

**4. 链接与验证**

Skills 视图里拨开关即可；扳手图标跑 validate（修悬空链接，源已不存在的只报告不删）。终端里同样能做，子命令与页面同源：

```
$ python3 oneskill.py list
SKILL        qwenwork  codex
a1           ✓         ✓
sunfire-cli  ✓         ✗

✓ linked   ! broken   ✗ not linked
```

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `serve [--open]` | 起管理页面；只监听 127.0.0.1，打印一次性 token |
| `detect [--json]` | 报告本机已知 Agent 的安装状态 |
| `list [--json]` | 源目录各 skill × 各 Agent 的链接状态（✓ 已链 / ! 悬空 / ✗ 未链） |
| `scan [--json]` | 列出各 Agent 目录下未收编的真实 skill 目录（保护名单内的隐藏） |
| `link <agent> <skill>` | 创建一个 skill 的链接 |
| `unlink <agent> <skill>` | 移除一个链接 |
| `link-all <agent>` | 链接源目录中全部 skill |
| `unlink-all <agent> --yes` | 移除某 Agent 的全部链接，需确认 |
| `migrate <agent> <skill>` | 把散落的 skill 目录移进源目录，原位置回链 |
| `validate [agent]` | 修复悬空链接；源已不存在的只报告、不删除 |
| `agent add <name> <dir>` | 向名单添加一个 Agent |
| `agent update <name> <dir>` | 修改名单中已有条目 |

注意：链接只对采用「一个含 SKILL.md 的目录」这套约定的 Agent 生效（Codex、Claude Code 等）。Cursor、Qoder 未必从这些目录加载，链之前先确认。

## 安全边界

只创建和删除符号链接、只移动你勾选的目录。目标位置若已存在同名的真实文件或目录，报错停手，不覆盖；批量移除必须带 `--yes`；迁移前校验原路径不是符号链接、源目录无同名冲突，迁移后回读验证链接可用。保护名单 `migrate.ignore` 里的条目扫描不列、迁移不动。

## 维护

单文件 python3，无第三方依赖（macOS、Linux 自带解释器）。数据文件三个：`agents.registry`（Agent 名单）、`migrate.ignore`（保护名单）、`skills/`（源目录）。问题与改进直接改 `oneskill.py` 即可。
