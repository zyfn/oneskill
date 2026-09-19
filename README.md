# oneskill

**Agent skill 的统一管理：一份真身，按需链接分发。**

同一台机器上跑多个 Agent（QwenWork、Codex、Claude Code……）时，它们各有各的 skills 目录。想让几个 Agent 共用同一个 skill，只能复制几份分别放进去；skill 一更新，其余副本立刻过期，改哪份、漏哪份全靠自己记。

oneskill 把 skill 的真实内容只存放一处（源目录），各 Agent 的 skills 目录里放指向它的符号链接。改源目录，所有 Agent 同时生效；删掉某条链接，就收回那个 Agent 的使用权，真实内容不受影响。

## 优势

- **单一副本，不会过期** — 真实内容只有一份，更新即全员生效，不需要同步任何副本
- **零配置** — 没有注册、启用之类的步骤；Agent 目录从名单自动解析，文件夹拷到任何位置即可用
- **只增删链接** — 不覆盖、不删除任何真实内容；批量移除必须显式确认

## 工作原理

名单（agents.registry）记录每个 Agent 的标准 skills 目录，脚本据此解析路径，在对应目录创建符号链接：

```
                          ┌─ symlink ─▶ ~/.qwenworkcn/skills/my-skill
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

以下示例使用一个名为 `my-skill` 的 skill，机器上装着 QwenWork 和 Codex。

**1. 安装**

oneskill 是单文件脚本、没有依赖，clone 到任意位置即可（脚本按自身所在目录定位源目录和名单）。下面以 clone 进家目录为例：

```bash
git clone <repo-url> ~/oneskill
cd ~/oneskill
```

后续更新在目录里 `git pull` 即可：真身更新，所有 Agent 的链接立刻生效。

**2. 把 skill 放进源目录**

每个 skill 一个子目录，内含 SKILL.md。只放自行安装的 skill；各 Agent 自带的 skill 会随官方更新被覆盖或重建，不要搬进源目录：

```bash
cp -R /path/to/my-skill skills/my-skill
```

**3. 看本机有哪些 Agent 可用**

```
$ ./oneskill.sh detect
┌──────────┬──────────────────────┬─────────────────┐
│ AGENT    │ SKILL DIR            │ STATUS          │
├──────────┼──────────────────────┼─────────────────┤
│ qwenwork │ ~/.qwenworkcn/skills │ ✓ installed     │
│ codex    │ ~/.codex/skills      │ ✓ installed     │
│ claude   │ ~/.claude/skills     │ ✗ not installed │
└──────────┴──────────────────────┴─────────────────┘
```

**4. 链给某个 Agent**

第一个参数是 Agent 名（取自上表），第二个是源目录中的 skill 名：

```
$ ./oneskill.sh link codex my-skill
✓ linked: codex/my-skill -> ~/oneskill/skills/my-skill
```

想一次链全部 skill，用 `link-all codex`。

**5. 验证**

```
$ ./oneskill.sh list
┌──────────┬──────────┬───────┐
│ SKILL    │ qwenwork │ codex │
├──────────┼──────────┼───────┤
│ my-skill │ ✗        │ ✓     │
└──────────┴──────────┴───────┘

✓ linked   ! broken   ✗ not linked
```

codex 列的 ✓ 表示链接已生效；qwenwork 还是 ✗，需要的话再 `link qwenwork my-skill`。

## 命令一览

| 命令 | 作用 |
| --- | --- |
| `detect` | 报告本机已知 Agent 的安装状态 |
| `list` | 源目录各 skill × 各 Agent 的链接状态（✓ 已链 / ! 悬空 / ✗ 未链） |
| `link <agent> <skill>` | 创建一个 skill 的链接 |
| `unlink <agent> <skill>` | 移除一个链接 |
| `link-all <agent>` | 链接源目录中全部 skill |
| `unlink-all <agent> --yes` | 移除某 Agent 的全部链接，需确认 |
| `validate [agent]` | 修复悬空链接；源已不存在的只报告、不删除 |
| `agent add <name> <dir>` | 向名单添加一个 Agent |
| `agent update <name> <dir>` | 修改名单中已有条目 |

## 设计取舍

Agent 名单靠维护，不靠扫描。早期版本试过自动发现：扫家目录下所有 skills 目录，里面有 SKILL.md 就当是 Agent。结果扫出了 .r2c、.loongsuite-pilot 这类无关工具的缓存目录，差点往里面建链接。一个目录是不是 Agent 无法从文件系统猜出来，所以维护一份确认过的名单 agents.registry，用 `agent add` 增补。

符号链接不是复制。源目录一旦移走，所有链接就悬空；validate 会重建能重建的、报告不能重建的，但不会替使用者删任何东西，源恢复后悬空链接自行复活。

各 Agent 的 skill 格式并不互通。QwenWork、Codex、Claude Code 都用「一个含 SKILL.md 的目录」这套约定，链接过去直接生效；Cursor、Qoder 未必从这些目录加载，链之前先确认，否则链接建了也不起作用。

## 安全边界

脚本只创建和删除符号链接。目标位置若已存在同名的真实文件或目录，它报错停手，不覆盖；批量移除必须带 `--yes`。

## 维护

单文件 bash，无外部依赖；问题与改进直接修改 oneskill.sh 与 agents.registry 即可。
