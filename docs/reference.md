# Reference

[README](../README.md) · [简体中文](reference.zh-CN.md)

## Agent directories

The catalog provides default search paths. A preset does not imply that every version or capability format of an Agent has been verified.

| Agent | Default skills directory |
| --- | --- |
| QwenWork | `~/.qwenworkcn/skills` (observed macOS compatibility path) |
| Qwen Code | `~/.qwen/skills` |
| Codex | `~/.agents/skills` |
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
| TraeCode CLI | Unconfigured; public installation path not established |
| Kimi Code | `~/.kimi-code/skills` |

Override preset fields in `agents.local.json`, then rescan. For example, a Skill target can be changed without changing the Agent's configuration root:

```json
[{ "name": "codex", "skillDir": "/absolute/path/to/codex/skills" }]
```

Installation discovery is independent of these directories; oneskill does not install Agents. See [Agent discovery](agent-discovery.md) for supported overrides and platform limits.

## Adding an Agent

Install a supported preset and rescan. For a new Agent, copy `agents.local.example.json` to `agents.local.json` and declare its command name. Add a Skill target, independent configuration root, and file format/key when resource inventory is needed. The identifier and executable name may differ; an absolute executable path is supported.

Local definitions are excluded from Git. Additions, changes, and removals take effect on rescan. Undeclared resources display `—`; command names do not imply storage locations.

Commands, icons, resource subdirectories, and MCP reading rules are shared. `configDir.macos` and `configDir.windows` explicitly list the roots; relative `skillDir`, `pluginDirs`, and MCP files use the selected root. Local overrides may omit unchanged fields. See the [discovery reference](agent-discovery.md) and [official path audit](agent-paths.md).

## Scan coverage

| Area | Behavior and limitations |
| --- | --- |
| Agents | **Installed** requires a matching command, supported macOS application bundle, or supported extension identity. CLI commands run `--version`; success records the version, while failures remain distinct. Configuration directories do not determine detection. Login and session health are not tested. |
| Skills | Recursively discovers `SKILL.md` packages in the shared library and configured personal skill directories. Project skills and plugin-bundled skills are not comprehensively included. |
| Plugins | Reads recognized native manifests, including `.codex-plugin/plugin.json`, `.claude-plugin/plugin.json`, `plugin.json`, and qualifying `package.json` files. Cached versions may be inactive. Generic VS Code extensions are excluded. |
| MCP | Reads declared JSON, JSONC, and TOML files through one parser interface; unreadable or malformed files produce diagnostics. Configuration discovery does not verify server health. |
| Hooks | Discovers recognized JSON hook configuration through the CLI. No separate Hooks page is provided. |

**Local skills** includes valid linked packages found in an Agent's configured skill directory. **Linked skills** counts only links to this shared library. Plugin and MCP views are read-only.

Scans are bounded by root, depth, and entry count. History, sessions, dependency folders, and build output are skipped. A count ending in `+` indicates a scan limit was reached. Missing locations, unsupported formats, or unreadable files can produce incomplete results. Configuration details do not expose command arguments, environment values, or secrets.

## Library and links

Each skill package contains a `SKILL.md`. Parent folders define collections; selecting a collection includes its descendants. **All skills** includes every package, including those directly under `skills/`. Nested branches expand on demand, and the collection navigation can be collapsed entirely.

Links refer to the shared package instead of duplicating its contents. Destination conflicts are reported without overwriting existing files. Before moving or renaming a linked package, unlink it, move it, rescan, and link the new location. Nested-directory loading depends on the target Agent.

## Import and recovery

**Skills → Unmanaged** lists packages in Agent skill directories that are outside the shared library.

- **Manage here** imports the complete package, preserves parent directories, backs up the original, and links it back to its source Agent.
- **Manage multiple** opens the batch import workflow.
- **Ignore** hides a package from the unmanaged list without changing its files or Agent access.
- **Ignored → Restore** returns it to the unmanaged list. Ignored packages remain inspectable and are excluded from batch imports.

An existing library package is reused only if its content and permissions match. Different content at the same destination is a conflict. Internal symlinks and special files require manual handling. The list identifies the source Agent; full filesystem paths remain available in the detail view. A directory name such as `.system` does not establish that a package is bundled with its Agent.

Imports save original packages in the source Agent's `.oneskill-backups/import-*/original`. Each backup includes a `restore.json` with the relevant paths. To restore manually:

1. Inspect the recorded source and destination paths.
2. Remove the corresponding Agent symlink.
3. Move the original backup to its recorded location.
4. Keep the shared copy if other Agents still use it.

## Storage

| Location | Purpose |
| --- | --- |
| `skills/` | Canonical library; excluded from Git except for `.gitkeep`. |
| `agents.catalog.json` | Agent commands, logos, independent configuration roots, resource declarations, and primary references. |
| `agents.local.json` | Local Agent definitions and preset overrides, excluded from Git. |
| `migrate.ignore` | Local import protection and persistent ignore rules, excluded from Git. |
| Agent `.oneskill-backups/` | Original packages and import restore records. |
| `web/dist/` | Generated browser assets; excluded from Git. |
| Browser local storage | Language and collection-navigation visibility preferences. Skill contents are not stored here. |

Ignore rules identify an Agent and a relative package directory:

```json
{"agent":"codex","relative":".system/agent-guide","ignored":true}
```

Legacy `Agent:skill-name` protection rules remain supported. A path-specific `ignored:false` rule restores one package without changing the protection of same-name packages elsewhere. Preference writes use atomic file replacement.

The service binds to loopback. Mutating requests require local access authorization; the browser renews it when necessary. Remote hosting and multi-user accounts are outside the current scope.

## CLI

Run commands with `npm run cli -- <command>`.

| Command | Purpose |
| --- | --- |
| `detect [--json]` | Scan the configured workspace and report capabilities. |
| `skills [--json]` | List shared skills and Agent links. |
| `plugins [--json]` | List detected native plugin manifests. |
| `mcp [--json]` | List detected MCP server configuration. |
| `hooks [--json]` | List detected hook configuration. |
| `agents [--json]` | List Agents with installation and configuration discovery. |
| `link <agent> <skill>` | Link a relative library package path to an Agent. |
| `unlink <agent> <skill>` | Remove a library link from an Agent. |
| `validate` | Report broken links and conflicts; exit nonzero if any are found. |
| `help` | Show command help. |

Agent JSON uses `installed` and `detected` for program installation evidence, and `configured` for an existing configuration directory. CLI `runnable` reports the `--version` result and `version` stores a recognized version; desktop and extension `runnable` is null. `status` is `installed`, `unavailable` for failed CLI probes, or `not-detected`. `detection.evidence` records the source, path, and CLI probe error. Version success does not certify authentication or session health.

## Platforms and development

Requires Node.js 20+, npm, and a desktop browser. macOS has been manually tested. Linux and Windows desktop workflows still require platform verification; Windows may need Developer Mode or additional symlink permissions, and Linux folder opening requires a desktop file manager. `oneskill.command` is a macOS launcher.

`--workspace <directory>` selects a separate library and preference directory for both CLI commands and `serve`. Built-in presets and Web assets remain in the application; a workspace can optionally provide its own `agents.catalog.json`.

For frontend development, run the API with `npm run dev` and Vite with `npm run dev:web` in separate terminals. The default `/api` proxy targets port 8787. `npm run check` runs syntax checks, filesystem/API tests, and a production web build.


## License and attribution

The project is licensed under [MIT](../LICENSE). Agent names and logos belong to their respective owners.
