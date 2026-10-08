# Architecture

oneskill is a local application with two entrypoints. The Web UI calls the loopback HTTP API; the CLI calls the same workspace service directly. Agent resources remain in their own directories, and shared Skills are connected by filesystem links.

```text
React UI → HTTP server ─┐
                       ├→ workspace → discovery, inventory, Skill operations
CLI ───────────────────┘
```

## Modules

| Module | Responsibility |
| --- | --- |
| `src/core.mjs` | Workspace construction, Agent loading, and the common overview response. |
| `src/agent-catalog.mjs` | Validate definitions, apply local overrides, and select host paths. |
| `src/agent-discovery.mjs` | Resolve executable/application/extension evidence and check CLI versions. |
| `src/filesystem.mjs` | Path display, file reading, and bounded directory traversal. |
| `src/skill-scan.mjs` | Read Skill metadata, discover packages, and inspect links. |
| `src/inventory.mjs` | Read plugin manifests and declared MCP/Hook configuration. |
| `src/skills.mjs` | List managed/unmanaged Skills, link/unlink, and coordinate imports. |
| `src/skill-ignore.mjs` | Read and atomically update persistent ignore preferences. |
| `src/migration.mjs` | Copy, verify, back up, and adopt one local package. |
| `src/server.mjs` | Serve built Web assets and translate HTTP requests into workspace operations. |
| `src/npm-runtime.mjs` | Run npm's JavaScript entrypoint with Node, without shell interpolation. |
| `src/cli.mjs` | Parse commands and print the same workspace results. |
| `web/src/` | Navigation, filtering, item views, details, and actions. |

## Workspace boundaries

`createWorkspace({ root })` constructs an independent workspace instance. Its `skills/`, `agents.local.json`, and `migrate.ignore` belong to that root. Application source, built-in presets, and Web assets remain in the installation directory. A workspace may provide a separate `agents.catalog.json` for fixtures or custom deployments. Definitions are read again on rescan.

The default remains the repository directory. Both entrypoints support an explicit data location:

```bash
npm run cli -- skills --workspace /path/to/workspace --json
npm run cli -- serve --workspace /path/to/workspace --open
```

Demo and tests construct temporary data directories and use these same modules. They do not copy runtime source or substitute a different scanner. Demo executable responses are synthetic sample data.

## Scan and mutation flow

An overview loads Agent definitions once, checks installation evidence, then gathers bounded inventories and link counts. CLI detection requires a successful version response; resource directories are independent of installation evidence. Counts describe discovered data, not verified runtime availability of plugins or MCP servers.

Write operations revalidate their targets. Links never overwrite a real directory. Imports preserve the original package in an Agent backup directory before replacing it with a link. Ignore changes update a local preference file; package contents are untouched. Mutation queues belong to the workspace instance; concurrent multi-process management is outside the current scope.

The HTTP service binds to loopback and checks local write authorization. It is intended for a single local user, rather than remote hosting. Plugin and MCP inventories expose names and locations without command arguments or environment secrets.

## Verification

`npm run check` checks all Node module syntax, executes fixture tests, and builds the Web UI. CI tests Node 20/22/24 on Linux and exercises discovery, configuration, workspace isolation, and real npm startup on macOS and Windows. Tests include an HTTP request that changes a link in an isolated workspace. Successful CI does not replace visual acceptance or a platform's actual Agent installation checks.
