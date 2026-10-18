<img src="logo.svg" alt="oneskill" width="56" height="56">

# oneskill

**One Skill library, connected to your Agents.**

**English** · [简体中文](README.zh-CN.md)

oneskill is a local Skill manager for coding Agents. Keep shared packages in one library, organize them with folders, and connect them to Agent directories through symbolic links. Edit a package once instead of maintaining separate copies for every Agent.

## Features

- **A shared library:** Browse collections, search Skills, read `SKILL.md`, and manage Agent connections.
- **Existing Skills, organized:** Import packages from Agent directories with backups and conflict checks, or ignore packages that should stay where they are.
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

1. **Add Skills.** Place packages containing `SKILL.md` under `~/.oneskill/skills/`, or open **Skills → Unmanaged** and choose **Manage here**. **Manage multiple** imports several packages in one workflow.
2. **Organize the library.** Create folders under `skills/`, then select **Rescan**. Collections follow the directory tree; **All skills** includes packages at the library root and in nested folders. Collapse the collection navigation when you need more room.
3. **Connect Agents.** Select a link control in the library matrix. Agent products that write to the same directory share one column and one link. Links read from other scanned directories also appear as linked. Their tooltips show the source; those cells are read-only.
4. **Review or ignore local packages.** The unmanaged list shows each package's source Agent and its actions. **Ignore** hides a package without changing its files; use **Ignored → Restore** to bring it back.
5. **Edit the source.** Open a Skill's folder and edit its files. Connected Agents read the same source package, subject to their own reload and discovery behavior.

The **Agents** page separates installed and not-installed entries. **Plugins** and **MCP** are searchable, read-only configuration inventories. MCP counts include Agent configuration and plugin declarations, with repeated cached versions merged within each plugin scope; different plugins remain separate. These counts may include inactive declarations and do not represent live connections.

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
2. **Read.** Scan the Skill library and configured Agent roots, then publish a shared workspace snapshot. External filesystem changes appear after **Rescan**; this is not a filesystem watcher. Inventory counts describe discovered entries, subject to scan limits.
3. **Change through one service.** Web uses authenticated local HTTP; the CLI and MCP adapter connect to the same service. Operations share parameter validation and errors. Writes are serialized, target directories are locked, and request receipts prevent the same completed request from being applied twice.
4. **Keep ordinary files.** Linking creates a filesystem reference from the configured Agent target to the library package. Unlinking removes that reference and preserves the source. Importing verifies the copied package, backs up the original, and replaces its old location with a link. Conflicting content is not overwritten.

Multiple Agents may read a shared directory, so one physical link can be visible to more than one Agent. oneskill shows this relationship rather than claiming independent controls for the same path. Links found in additional scan roots are read-only in that Agent's matrix cell.

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
