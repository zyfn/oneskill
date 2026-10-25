<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**One Skill library, connected to your Agents.**

**English** · [简体中文](README.zh-CN.md)

oneskill is a local Skill manager for coding Agents. Keep shared packages in one library, organize them with folders, and connect them to Agent directories through symbolic links. Edit a package once instead of maintaining separate copies for every Agent.

## Features

- **A shared library:** Browse collections, search Skills, read `SKILL.md`, and manage Agent connections.
- **Explicit import and linking:** Move existing packages into the library with backups and conflict checks, then choose which Agents to connect. Ignore packages that should stay where they are.
- **Local inventories:** Inspect Agent installation status and discovered Skills, plugins, and MCP configuration.
- **Three entrypoints, one workspace:** Use the Web UI, CLI, or Codex plugin with the same data and operations. Web and the plugin share the same responsive interface, with English and Simplified Chinese support.
- **Files stay local:** No cloud account or database is required. Your library remains a directory of ordinary Skill packages.

## Preview

**Skills library and Agent connections**

![Skills library with folder collections and Agent links](docs/screenshots/skills.png)

**Agent overview**

![Agent overview with local capability counts](docs/screenshots/agents.png)

## Installation

Requires **Node.js 20+** and npm. The Web interface also requires a browser; the Codex integration requires a desktop client that supports local plugins and MCP Apps.

```bash
git clone https://github.com/zyfn/oneskill.git
cd oneskill
npm ci
npm --prefix web ci
npm run build
```

## Usage

### Web

```bash
npm start
```

On macOS, you can also double-click `oneskill.command`.

To open the interface manually, copy the complete access URL printed in the terminal. Opening only the local host and port does not authorize a new browser session.

1. **Add Skills.** Place packages containing `SKILL.md` under `~/.oneskill/skills/`, or open **Skills → Unmanaged** and choose **Add to library**. Importing moves the package away from its original location and retains a backup; it does not automatically connect any Agent. **Select** manages, ignores, or restores up to 100 visible packages without leaving the filtered list.
2. **Organize the library.** Collections follow the folder tree. If a linked package moves, the broken-link notice lets you reconnect its old reference to the new location or remove only that broken reference. **All skills** includes the library root and nested collections.
3. **Connect Agents.** Select a Skill and use its directory-link switches in the inspector. Agent products that write to the same directory share one link. Codex links use `~/.codex/skills/` or `$CODEX_HOME/skills`. Shared discovery roots such as `~/.agents/skills/` are read-only sources; their existing references appear under **Files** and do not turn on another Agent's directory switch.
4. **Review or ignore local packages.** The unmanaged list shows real packages outside the library, with their Agent or shared-directory source. Shared directories are listed once even when several Agents use them. A link pointing into the library is an existing reference and does not create another unmanaged entry. **Ignore** hides a package without changing its files; use **Ignored → Restore** to bring it back.
5. **Edit the source.** Open a Skill's folder and edit its files. Connected Agents read the same source package, subject to their own reload and discovery behavior.

The **Agents** page separates installed and not-installed entries. **Plugins** and **MCP** are separate pages with searchable, read-only cards and an Agent filter. A configuration root shared by multiple Agents contributes one entry to the global count and appears under their combined filter. MCP counts include Agent configuration and plugin declarations; repeated declarations within a plugin scope are merged, while different plugins remain separate. These counts may include inactive declarations and do not represent live connections.

### CLI

The CLI returns JSON and uses the same local service as the interface:

```bash
npm run cli -- workspace
npm run cli -- workspace --refresh
npm run cli -- skills
npm run cli -- agents
npm run cli -- plugins
npm run cli -- mcp-inventory
```

Use identifiers returned by the workspace for individual operations:

```bash
npm run cli -- call getSkill '{"skillId":"managed:engineering/code-review"}'
npm run cli -- call setSkillLink '{"agentId":"agent:codex","skillId":"managed:engineering/code-review","linked":true}'
```

`call` generates a request identifier for mutations when one is not supplied. See `npm run cli -- help` and the [operation reference](docs/reference.md) for details.

### Codex plugin

After building the project, package and install the local plugin:

```bash
npm run build:plugin
codex plugin marketplace add ./dist/marketplace
codex plugin add oneskill@oneskill-local
```

Restart the desktop client, then open **oneskill** from its sidebar or additional-app menu. The plugin includes the same interface and exposes workspace operations as MCP tools for use in conversations. Sidebar placement depends on the host client.

The generated package includes the server code, UI, and Agent catalog. It requires Node.js on `PATH`, but does not install dependencies or build the interface when launched. After updating the source, rebuild the Web assets and plugin package, reinstall the plugin, and reload the desktop client to use the new version.

### Choose a workspace

All entrypoints default to `~/.oneskill`. To use an existing library elsewhere, select the **same absolute directory** for each entrypoint:

```bash
npm run cli -- web --open --workspace /absolute/path/to/workspace
npm run cli -- skills --workspace /absolute/path/to/workspace
npm run build:plugin -- --workspace /absolute/path/to/workspace
```

For the plugin, install the generated package after choosing the workspace. The data directory is separate from the source checkout and plugin cache.

## How it works

![oneskill architecture: Web, CLI and Codex share one local Workspace service and filesystem operations](docs/architecture.svg)

1. **Discover.** Load Agent definitions for the current operating system and inspect their declared locations. CLI installation checks require `--version` to exit successfully with a recognized version; desktop applications and extensions use installation metadata. A configuration directory alone is not installation evidence.
2. **Read.** Scan the library and configured Agent roots. While the workspace is visible, polling refreshes snapshots older than 30 seconds; **Rescan** checks immediately. The footer shows the last successful scan and unreadable sources. Inventory counts describe discovered entries, subject to scan limits.
3. **Change through one service.** Web, CLI, and the MCP adapter share validation and errors. Writes are serialized and targets locked. Successful writes are recorded before the next scan, so a refresh failure cannot change a committed result. Unchanged rescans preserve the revision, and entrypoints verify the service version.
4. **Keep ordinary files.** Linking creates a filesystem reference from the configured Agent target to the library package. Unlinking removes that reference and preserves the source. Importing verifies the library copy, moves the original into a backup, and leaves its old location empty. Connect Agents separately with their switches. Conflicting content is not overwritten.

Multiple Agents may read a shared directory, so one physical reference can be visible to more than one Agent. oneskill keeps shared-source discovery separate from connections in configured Agent targets. The switches manage directory references; they do not override an Agent's own compatibility discovery rules or guarantee exclusive access to a Skill.

The service listens on `127.0.0.1` and is intended for one local user. Access credentials, service metadata, locks, and request receipts are kept separately from the Skill library. An interrupted write is not blindly replayed: rescan and inspect the files before retrying.

## Workspace and Agent configuration

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
