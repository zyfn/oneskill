<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**One skill library, connected to your Agents.**

**English** · [简体中文](README.zh-CN.md)

oneskill is a local Skill manager for coding Agents. It stores Skill packages in one library and links them into Agent directories, reducing duplicate copies and inconsistent versions. Organize Skills by folder and manage which Agents can use each package.

## Features

- **Skill management:** Store each package once and connect it to multiple Agents through symbolic links. Unlinking preserves the source package.
- **Folder collections:** Organize Skills in nested folders, filter by collection, search packages, and view their details.
- **Import and ignore:** Import existing packages with backups and conflict checks, or ignore packages that should stay in their Agent directory.
- **Local Web UI and CLI:** Manage the same files from a browser or terminal. The interface supports English and Simplified Chinese; no cloud account or database is required.

```text
oneskill/skills/code-review/            shared source
    ▲
    ├── ~/.agents/skills/code-review    symbolic link
    └── ~/.claude/skills/code-review    symbolic link
```

Link and unlink operations create or remove symbolic links without deleting the source package.

## Preview

**Skills management.** Browse folder collections and view each Skill's Agent connections.

![Skills library with folder collections and Agent links](docs/screenshots/skills.png)

**Agents overview.** View detection results and local Skill, plugin, and MCP counts.

![Agents overview with local capability counts](docs/screenshots/agents.png)

## Installation

Requires **Node.js 20+**, npm, and a desktop browser.

```bash
git clone https://github.com/zyfn/oneskill.git
cd oneskill
npm ci
```

## Usage

### Web UI

Start the browser interface:

```bash
npm start
```

On macOS, you can also double-click `oneskill.command` in the project folder.

#### 1. Add or import Skills

Add a package containing `SKILL.md` to `skills/`, or open **Skills → Unmanaged** to review packages already present in your Agent directories. **Manage here** imports the complete package and links it back to its original Agent, so that Agent can continue using it.

The original package is backed up before its location becomes a link. If a destination contains different content, oneskill reports the conflict instead of overwriting it.

#### 2. Organize by folder

Create parent folders under `skills/` to group related packages:

```text
skills/
├── engineering/
│   ├── code-review/SKILL.md
│   └── backend/query-plan/SKILL.md
├── writing/
│   └── technical-docs/SKILL.md
└── workspace-notes/SKILL.md
```

The collection tree follows these folders. Expand branches as needed, select a parent to include its descendants, or collapse the navigation to give the library more room. **All skills** includes every package, including those directly under `skills/`.

After adding or reorganizing folders, **Rescan** the workspace. Unlink a package before changing its path, then reconnect it at the new location.

#### 3. Link and unlink Agents

The library's Agent columns show **Linked** and **Not linked**. Select a connection to change it. A skill can be available to several Agents, one Agent, or none; it stays in the library in every case.

Linking creates a symbolic link in the selected Agent's skill directory. Unlinking removes that link and preserves the shared package.

#### 4. Edit or ignore packages

Update a shared skill in place so its linked Agents read the same revision. Use search and collections to focus on the skills you need, and inspect a package's details or open its folder when editing.

Use **Ignore** to hide a package from the unmanaged list without changing its files or Agent access. This choice persists across scans and restarts; **Ignored → Restore** brings it back.

#### Agent, plugin, and MCP inventories

The **Agents** page shows detection results and local resource counts. **Plugins** and **MCP** provide searchable, read-only inventories with Agent filters and source details.

### CLI

Place Skill packages containing `SKILL.md` under `skills/`, then run commands from the project folder. The CLI uses the same files as the Web UI and does not require the Web service to be running.

```bash
npm run cli -- agents --json
npm run cli -- skills --json
npm run cli -- plugins --json
npm run cli -- mcp --json
npm run cli -- link codex engineering/code-review
npm run cli -- unlink codex engineering/code-review
npm run cli -- validate
```

Run `npm run cli -- help` for all available commands.

## Agent support and detection

The catalog records command names, official configuration conventions, and compatibility locations for Codex, Claude Code, Cursor, Gemini CLI, Qwen Code, and other Agents. Shared rules are declared once, with explicit macOS and Windows configuration roots. Add custom Agents or override presets in `agents.local.json`; see the [local definition example](agents.local.example.json). Changes take effect on rescan. Legacy Skill target overrides in `agents.registry` remain supported, and shared skill directories may be read by several Agents.

CLI entries are detected only when `--version` exits successfully with a recognized version. Failed checks remain visible with their error code. Desktop and extension entries confirm installation metadata only; they do not establish runtime health. Qoder desktop and Qoder CLI are separate entries. Configuration directories are scanned independently and never prove installation. Skill loading follows each Agent's own rules. See [Agent discovery](docs/agent-discovery.md) for detection methods and limits, or the [reference](docs/reference.md) for skill directories and scan coverage.

## Development

```bash
npm --prefix web ci
npm run dev          # API and built UI
npm run dev:web      # Vite development server, in another terminal
npm run check        # Syntax checks, tests, and production build
```

The frontend uses React, Vite, and Tailwind CSS. The scanner, filesystem operations, HTTP API, and CLI live in `src/`; the interface lives in `web/src/`.

Contributions are welcome, especially Agent discovery improvements, platform verification, and focused interaction refinements. Include sanitized fixtures for scanner changes, verify both interface languages for UI changes, and run `npm run check` before submitting a pull request.
