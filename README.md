<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**One Skill library, connected to your Agents.**

**English** · [简体中文](README.zh-CN.md)

[![Check](https://github.com/zyfn/oneskill/actions/workflows/check.yml/badge.svg)](https://github.com/zyfn/oneskill/actions/workflows/check.yml)

oneskill is a local Skill manager for coding Agents. Keep packages in `~/.oneskill/skills/`, organize them with folders, and connect them to Agent directories through symbolic links. Edit a package once instead of maintaining separate copies for every Agent.

## How it works

![One Skill library, read by multiple Agents through symbolic links](docs/architecture.svg)

1. **Bring the files together.** Import an existing Skill into `~/.oneskill/skills/`. oneskill verifies the package, backs up the original, and moves it out of its former location.
2. **Choose the connections.** Enable an Agent in the Skill inspector. oneskill creates a symbolic link in that Agent's configured Skill directory, pointing to the package in your library. Importing alone creates no links.
3. **Edit one source.** Connected Agents read the same files. Removing a connection removes its link and keeps the library package.

Web, CLI, and the Codex plugin share one local Workspace service, started automatically by the entrypoint you use. Files stay on your machine. The [technical architecture](docs/architecture.md) covers discovery, snapshots, validation, and write recovery.

## Installation

You need **Git, Node.js 20+, and npm**. Choose an entrypoint below; each uses the same workspace.

| Entrypoint | Use it for | Installation steps |
| --- | --- | --- |
| Web | Browse and manage Skills in your browser | 1 + 2 |
| CLI | Read JSON and run workspace operations from the terminal | 1 |
| Codex plugin | Open the interface and use workspace tools inside Codex | 1 + 2 + 3 |

### 1. Get the program

```bash
git clone https://github.com/zyfn/oneskill.git
cd oneskill
npm ci
```

Run the remaining commands from this source directory. Your Skill library is stored separately in `~/.oneskill/skills/`.

### 2. Build the shared interface

For **Web and the Codex plugin**, install the frontend dependencies and build both interface formats:

```bash
npm --prefix web ci
npm run build
```

This prepares the browser interface and the embedded Codex interface. CLI-only use needs just step 1.

### 3. Install the Codex plugin

You also need the **Codex CLI** available as `codex` and a desktop client that supports local plugins and MCP Apps.

```bash
npm run build:plugin
codex plugin marketplace add ./dist/marketplace
codex plugin add oneskill@oneskill-local
```

The generated plugin contains the server, built interface, and Agent catalog. Your Skill packages remain in your workspace.

## Usage

### Web

After installation steps 1 and 2, run:

```bash
npm start
```

The command starts the local service and opens your browser. On macOS, you can also double-click `oneskill.command`. To open the page in another browser, copy the **complete access URL** printed in the terminal; the port alone cannot authorize a new session.

### CLI

After installation step 1, run commands directly with Node. Results are written as JSON:

```bash
node src/cli.mjs workspace
node src/cli.mjs skills
node src/cli.mjs agents
node src/cli.mjs plugins
node src/cli.mjs mcp-inventory
```

Use `node src/cli.mjs workspace --refresh` to rescan and `node src/cli.mjs help` to see the commands. For changes, use the Agent and Skill IDs returned by `workspace`. For example, replace the IDs below with your own before connecting a package:

```bash
node src/cli.mjs call setSkillLink '{"agentId":"agent:codex","skillId":"managed:engineering/code-review","linked":true}'
```

`call` generates a request ID for mutations. Input fields and the other operations are documented in the [operation reference](docs/reference.md).

### Codex plugin

After installation steps 1–3, restart the Codex desktop client. Open **oneskill** from its sidebar or additional-app menu. The plugin starts the local service automatically and uses the same interface and library as Web.

You can also ask Codex to use the tools in a conversation, for example: **“Use oneskill to list my unmanaged Skills.”** Sidebar placement depends on the host client. An already-open panel may need to be closed and reopened after a plugin update.

## Work with Skills

1. **Add a package.** Put a folder containing `SKILL.md` in the library, or choose **Skills → Unmanaged → Add to library**. Importing moves the original package with a backup; connect Agents separately afterward.
2. **Connect an Agent.** Select a library Skill and enable its Agent directory switch. Codex's target is `~/.codex/skills/`, or `$CODEX_HOME/skills`. Products sharing one physical target use one control. Shared discovery roots such as `~/.agents/skills/` remain separate from these switches.
3. **Organize and edit.** Collections follow the folder tree. Edit the library package directly. If you move a linked package, use the link-issue panel to reconnect its old reference or remove only the broken link. Reload behavior and nested-folder support follow each Agent's rules.
4. **Leave a package in place.** Use **Ignore** in the unmanaged list; **Ignored → Restore** shows it again. **Select** applies import, ignore, or restore to up to 100 visible packages. A link into the library is an existing reference, not another unmanaged package.

**Agents** shows installation status and local counts. **Plugins** and **MCP** show searchable, read-only cards. Counts describe discovered packages and configuration declarations, including inactive entries; they do not establish a live MCP connection. Shared physical configuration roots are counted once globally.

## Preview

**Skills library and Agent connections**

![Skills library with folder collections and Agent links](docs/screenshots/skills.png)

**Agent overview**

![Agent overview with local capability counts](docs/screenshots/agents.png)

## Workspace and Agent configuration

The first use creates a workspace and an empty library in your home directory:

| Platform | Workspace | Skill library |
| --- | --- | --- |
| macOS | `~/.oneskill/` | `~/.oneskill/skills/` |
| Windows | `%USERPROFILE%\.oneskill\` | `%USERPROFILE%\.oneskill\skills\` |

Source checkouts and plugin caches contain the program. Personal packages, overrides, preferences, and import backups are not included in source or plugin distributions.

```text
~/.oneskill/
├── skills/
│   ├── engineering/
│   │   └── code-review/SKILL.md
│   └── writing/
│       └── technical-docs/SKILL.md
├── agents.local.json      # Optional Agent definitions and overrides
└── skills.ignore.json     # Persisted ignore preferences
```

The built-in [Agent catalog](agents.catalog.json) declares commands, icons, macOS and Windows configuration locations, and resource-reading rules. To add an Agent or override a preset, create `agents.local.json` in your workspace and rescan:

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

Relative resource paths follow the selected configuration root. Existing JSON, JSONC, TOML, and plugin-manifest readers are configuration-driven; a new proprietary format requires a scanner implementation. See [Agent discovery](docs/agent-discovery.md) and the [reference](docs/reference.md) for supported locations and boundaries.

Agent installation does not guarantee support for every resource format. Skill loading and nested-directory support follow each Agent's own rules. Windows may require Developer Mode or permission to create symbolic links; native desktop behavior still needs platform-specific verification.

### Choose another workspace

To keep the library elsewhere, use the **same absolute directory** for every entrypoint:

```bash
node src/cli.mjs web --open --workspace /absolute/path/to/workspace
node src/cli.mjs skills --workspace /absolute/path/to/workspace
npm run build:plugin -- --workspace /absolute/path/to/workspace
```

For Codex, install the generated package after choosing the directory. Default plugin packages use the current user's `~/.oneskill/`.

### Update the program

In the source checkout, run `git pull` and `npm ci`. Web and plugin users then repeat the interface build from installation step 2. Plugin users also repeat step 3 and reopen the Codex client.

## Development

```bash
npm run dev          # Local service with the built UI
npm run check        # Syntax checks, tests, and both UI builds
```

For frontend hot reload, start the local service and point Vite at its printed service address:

```bash
ONESKILL_ENDPOINT=http://127.0.0.1:PORT npm run dev:web
```

The Node.js runtime and filesystem operations live in `src/`; React, Vite, and Tailwind CSS power `web/src/`. See [Architecture](docs/architecture.md) for module boundaries. Contributions should include sanitized fixtures for scanner changes, exercise both interface languages, and pass `npm run check`.

## License

[MIT](LICENSE). Agent names and logos belong to their respective owners.
