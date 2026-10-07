# Agent discovery

[README](../README.md) · [Reference](reference.md) · [中文参考](reference.zh-CN.md) · [Verified paths](agent-paths.md)

Agent rules live in `agents.catalog.json`. Commands, icons, resource subdirectories, and file-reading rules are shared. A `configDir` table explicitly lists each operating system's configuration root. There are no empty platform objects, platform-wide overrides, or `common` inheritance blocks.

## Definition format

```json
{
  "name": "claude",
  "logo": "/agent-logos/claude.svg",
  "commands": ["claude"],
  "configDir": {
    "macos": "~/.claude",
    "windows": "${USERPROFILE}/.claude"
  },
  "configDirEnv": "CLAUDE_CONFIG_DIR",
  "skillDir": "skills",
  "pluginDirs": ["plugins/cache"],
  "mcp": [
    { "file": "~/.claude.json", "key": "mcpServers" }
  ]
}
```

| Field | Purpose |
| --- | --- |
| `name`, `logo` | Stable identifier and optional icon. |
| `commands` | Executable names, checked with `--version`. |
| `configDir` | Explicit `macos` and `windows` root paths. |
| `configDirEnv` | Optional documented environment variable replacing that root. |
| `skillDir` | Skill link target; relative paths use the selected configuration root. |
| `pluginDirs` | Plugin search roots; relative paths use the selected configuration root. |
| `mcp` | Configuration `file` and the server-map `key` inside it. |

Absolute paths, `~`, and environment-based paths remain independent of `configDir`. For example, Codex uses `skillDir: "~/.agents/skills"`, while Claude uses `skillDir: "skills"`. `~/.claude.json` is in the user's home, outside Claude's configuration directory.

File format is inferred from `.json`, `.jsonc`, and `.toml`. An explicit `format` is available when a vendor uses JSONC content in a `.json` file. Undeclared plugin and MCP locations stay unavailable; they are not guessed from directory names.

## Scan pipeline

1. Read the host system from Node.js: `darwin` → `macos`, `win32` → `windows`.
2. Select that root and any explicitly platform-specific installation locations.
3. Expand the current user's home and documented environment overrides.
4. Locate the CLI and execute `--version`, or inspect declared app/extension installation metadata.
5. Scan declared Skill and plugin roots and parse the declared MCP files.

A CLI definition must complete `--version` with exit code zero and a recognized version before `detected` or `installed` is true. A missing, killed, timed-out, nonzero, empty, or unrecognizable response never passes. A configured CLI does not fall back to app or extension metadata, even when no command is found. Failed executable evidence remains available with `status: "unavailable"` and the real error code.

Definitions without command rules can confirm desktop or extension installation metadata; their `runnable` and CLI `version` remain null. Qoder desktop (`qoder`) and its CLI (`qoder-cli`, accepting `qodercli` and `qoder` command names) are separate definitions sharing the documented user root. QwenWork is a desktop definition. A found desktop installation is not a certification that the app can launch or authenticate.

A missing configuration directory does not prevent CLI discovery. An existing directory alone never establishes installation. A missing or `null` root for the current host disables that full definition on this host; another host's root is never borrowed. A command-only definition can omit directories entirely.

## Custom Agents and local overrides

Copy `agents.local.example.json` to `agents.local.json`, which is ignored by Git. Edits take effect on rescan without restarting the server.

A minimal command-only registration is valid:

```json
[{ "name": "my-agent", "commands": ["my-agent-cli"] }]
```

To override only an existing Agent's Windows root:

```json
[
  {
    "name": "claude",
    "configDir": { "windows": "D:/AgentConfig/Claude" }
  }
]
```

The macOS root and shared resource rules stay intact. Relative `skillDir`, `pluginDirs`, and MCP files follow the selected root. An explicit local root has priority over an inherited `configDirEnv`, unless the local override explicitly retains the variable. Arrays replace inherited arrays, including `[]`; path tables merge only the named entries.

New full definitions with a `configDir` table must specify both `macos` and `windows`. An additional explicit `linux` path is allowed. A local override can omit unchanged fields. Native Windows and WSL are different host environments.

`agents.registry` still supports legacy Skill-target overrides (`name|directory`). A local `skillDir` overrides that target. Explicit registry targets remain independent of an Agent's configuration root. Previous flat runtime declarations remain readable for existing workspaces; the new documented configuration uses the format above. Experimental nested `common` and platform-wide override declarations are not part of the final schema.

Invalid JSON, duplicate identifiers, unknown fields, invalid commands, incomplete full path tables, and unsupported file formats produce explicit errors.

## Advanced declarations

Add these only when the vendor requires them:

| Field | Purpose |
| --- | --- |
| `appNames` | Platform lists of macOS bundle names and exact Windows registration names. |
| `executablePaths` | Platform lists of documented executables outside PATH. |
| `executableDirEnv` | Installer-directory variable name and the executable's relative path. |
| `extensions`, `extensionDirs` | Editor extension identities and their declared search directories. |
| `packages` | Package identities for ambiguous command names. |
| `configDirEnvSuffix` | Appended folder for variables that supply a parent home, such as `GEMINI_CLI_HOME`. |
| `extraSkillDirs` | Additional roots with stable `id`, `path`, and optional compatibility metadata. |
| `mcp[].fileEnv` | Optional environment variable overriding one configuration file's path. |
| `mcp[].platforms` | Explicit host availability for a compatibility file known only on those hosts. |

Platform-specific paths and installation lists are direct maps, not default-plus-override structures. A rare `skillDir` or additional root that differs by host may also use an explicit path map. Compatibility root IDs and ignore prefixes preserve existing links and ignore selections.

## Paths and environment variables

`~` means the current user's home on either operating system. `${VARIABLE}` reads the oneskill process environment without a shell. `${VARIABLE:-fallback}` supplies a literal path fallback when the variable is empty or unset. Required missing variables produce an error; optional native candidates are skipped. On Windows, `${USERPROFILE}` can use Node's current user home when the variable is unavailable.

For Gemini, `configDirEnv: "GEMINI_CLI_HOME"` and `configDirEnvSuffix: ".gemini"` describe the vendor's parent-home semantics. `CODEX_HOME` replaces the root itself. These rules are data and use the same resolver.

The [path audit](agent-paths.md) records published references and known gaps. Unpublished resource subdirectories stay unconfigured. Locally observed compatibility rules are identified in the catalog. Project-specific flags, dynamically configured extra roots, all plugin-bundled capabilities, JSON5/YAML configurations, and JavaScript extensions are outside the current normalized inventory.

## Installation evidence and bounds

CLI probes have closed stdin, a five-second deadline, bounded output, and four-way concurrency. A failed command remains unavailable; another installation does not conceal the failed probe. Timeouts terminate the process group on POSIX or the process tree on Windows. A recognized version does not establish sign-in or model access.

Windows command discovery combines inherited, user-registry, and machine-registry PATH, excluding relative paths and WindowsApps execution aliases. npm scripts use the system interpreter with AutoRun disabled. Desktop app detection requires an exact declared registration name and an existing executable. macOS detection verifies bundle metadata and its executable. Editor detection verifies publisher/name and ignores obsolete extensions. Metadata reads are bounded and do not launch GUI apps.

Shared physical Skill roots are deduplicated per Agent. Existing links and ignore rules are preserved. New links target the selected location; unlink removes only references to that library package, without removing real directories or unrelated links. Configuration contents, credentials, and transport arguments are not exposed in the inventory.
