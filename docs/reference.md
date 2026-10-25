# Reference

[README](../README.md) · [简体中文](reference.zh-CN.md)

## Agent directories

The catalog provides default search paths. A preset does not imply that every version or capability format of an Agent has been verified.

| Agent | Default skills directory |
| --- | --- |
| QwenWork | `~/.qwenworkcn/skills` (observed macOS compatibility path) |
| Qwen Code | `~/.qwen/skills` |
| Codex | `~/.codex/skills` (or `$CODEX_HOME/skills`) |
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

MCP configuration counts include Agent files and discovered plugin declarations. Cached versions of the same Agent/plugin-source/server identity are merged, with all paths retained in details. Same-name servers from different plugins remain separate. Plugin cache discovery does not establish enabled or running state.

## Library and links

Each skill package contains a `SKILL.md`. Parent folders define collections; selecting a collection includes its descendants. **All skills** includes every package, including those directly under `skills/`. Nested branches expand on demand; the collection rail stays visible when collections exist.

Links refer to the shared package instead of duplicating its contents. Destination conflicts are reported without overwriting existing files. After moving or renaming a package, review the broken-link notice. Select the package’s new library location to reconnect the old link, or remove only the broken reference. Links to sources outside this library are not eligible for this operation. Nested-directory loading depends on the target Agent.

Agents writing to the same Skill directory share one connection control and one link, such as Qoder and Qoder CLI. Codex writes to `~/.codex/skills` or `$CODEX_HOME/skills`. References discovered in shared roots such as `~/.agents/skills` appear under Files and do not enable Agent directory switches or increase linked counts. References elsewhere in an Agent's own target remain read-only. Linking and unlinking change only the configured target and preserve shared roots. Each Agent determines which compatibility directories it reads; directory links do not provide runtime isolation.

## Import and recovery

**Skills → Unmanaged** lists real packages in Agent skill directories that are outside the shared library. References pointing into the library are existing links, so they do not create duplicate unmanaged entries.

- **Add to library** moves the complete package into the library, preserves parent directories, and backs up the original. Its old location is left empty; use Agent switches to create connections separately.
- **Select** enables checkboxes within the current filtered list. Import, ignore, or restore up to 100 visible entries in one operation.
- **Ignore** hides a package from the unmanaged list without changing its files or Agent access.
- **Ignored → Restore** returns it to the unmanaged list. Ignored packages remain inspectable and are excluded from batch imports.

An existing library package is reused only if its content and permissions match. Different content at the same destination is a conflict. Internal symlinks and special files require manual handling. The list identifies the source Agent; full filesystem paths remain available in the detail view. A directory name such as `.system` does not establish that a package is bundled with its Agent.

Imports save original packages in the source Agent's `.oneskill-backups/import-*/original`. Each backup includes a `restore.json` with the relevant paths. To restore manually:

1. Inspect the recorded source and destination paths.
2. Check that the original location is empty. If you have since created a link there, verify and remove only that reference; preserve real files.
3. Move the original backup to its recorded location.
4. Keep the shared copy if other Agents still use it.

## Shared operations

The shared operation contract also exposes `setSkillsIgnored` for an atomic preference update across selected Skill IDs, and `resolveSkillLink` for a broken entry from `getWorkspace.linkIssues`. Pass its `issueId` and a managed `skillId` to reconnect; omit `skillId` to remove only that broken link. All writes require a unique `requestId` and accept `expectedRevision`. A successful receipt describes the completed write independently of the following scan.

## Storage

| Location | Purpose |
| --- | --- |
| `skills/` | Canonical library; excluded from Git except for `.gitkeep`. |
| `agents.catalog.json` | Agent commands, logos, independent configuration roots, resource declarations, and primary references. |
| `agents.local.json` | Local Agent definitions and preset overrides, excluded from Git. |
| `skills.ignore.json` | Local import protection and persistent ignore rules, excluded from Git. |
| Agent `.oneskill-backups/` | Original packages and import restore records. |
| `web/dist/` | Generated browser assets; excluded from Git. |
| Browser local storage | Language preference. Skill contents are not stored here. |

Ignore rules identify an Agent and a relative package directory:

```json
[{"agent":"codex","relative":".system/agent-guide","ignored":true}]
```

Ignore preferences are a JSON array keyed by Agent and package-relative path, saved through atomic replacement. Retired name-only rules are not read.

The service binds to loopback. Mutating requests require local access authorization; all reads and writes require authorization. Remote hosting and multi-user accounts are outside the current scope.

## CLI

Web, CLI and MCP use the same Workspace service. The default data directory is `~/.oneskill`.

```bash
npm run cli -- workspace --refresh
npm run cli -- skills
npm run cli -- agents
npm run cli -- plugins
npm run cli -- mcp-inventory
npm run cli -- call getSkill '{"skillId":"managed:review"}'
```

All entrypoints accept `--workspace <directory>`. Operation schemas live in `src/contracts/operations.mjs`. Output is JSON; errors contain a shared `code` and `message`.

## Platforms and development

Requires Node.js 20+, npm, and a desktop browser. macOS has been manually tested. Linux and Windows desktop workflows still require platform verification; Windows may need Developer Mode or additional symlink permissions, and Linux folder opening requires a desktop file manager. `oneskill.command` is a macOS launcher.

`--workspace <directory>` selects a separate library and preference directory for all entrypoints. Built-in presets and Web assets remain in the application; a workspace can optionally provide its own `agents.catalog.json`.

For frontend development, run the API with `npm run dev` and Vite with `npm run dev:web` in separate terminals. Set Vite’s `ONESKILL_ENDPOINT` to the service address printed by the Web command. `npm run check` runs syntax checks, filesystem/API tests, and a production web build.


## License and attribution

The project is licensed under [MIT](../LICENSE). Agent names and logos belong to their respective owners.
