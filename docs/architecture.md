# Architecture

oneskill is a local application with three entrypoints. Web and CLI connect to the same authenticated local Workspace service. A Codex MCP adapter connects to that service and exposes the shared UI as an MCP App resource. Agent resources remain in their own directories, and shared Skills are connected by filesystem links.

```text
React UI → HTTP server ─┐
                       ├→ workspace → discovery, inventory, Skill operations
CLI / MCP ──────────────┘
```

## Modules

| Module | Responsibility |
| --- | --- |
| `src/core.mjs` | Workspace construction, Agent loading, and the common overview response. |
| `src/agent-catalog.mjs` | Validate definitions, apply local overrides, and select host paths. |
| `src/agent-discovery.mjs` | Resolve executable/application/extension evidence and check CLI versions. |
| `src/filesystem.mjs` | Path display, file reading, and bounded directory traversal. |
| `src/skill-scan.mjs` | Read Skill metadata and discover packages. |
| `src/skill-links.mjs` | Resolve canonical destinations, inspect broken library links, and repair explicit references. |
| `src/inventory.mjs` | Read plugin manifests and declared MCP/Hook configuration. |
| `src/skills.mjs` | List managed/unmanaged Skills, link/unlink, and coordinate imports. |
| `src/skill-ignore.mjs` | Read and atomically update persistent ignore preferences. |
| `src/migration.mjs` | Copy, verify, back up, and adopt one local package. |
| `src/server.mjs` | Serve built Web assets and translate HTTP requests into workspace operations. |
| `src/npm-runtime.mjs` | Run npm's JavaScript entrypoint with Node, without shell interpolation. |
| `src/cli.mjs` | Parse commands and print the same workspace results. |
| `web/src/` | Navigation, filtering, item views, details, and actions. |

## Workspace boundaries

`createWorkspace({ root })` constructs an independent workspace instance. Its `skills/`, `agents.local.json`, and `skills.ignore.json` belong to that root. Application source, built-in presets, and Web assets remain in the installation directory. A workspace may provide a separate `agents.catalog.json` for fixtures or custom deployments. Definitions are read again on rescan.

The default data directory is `~/.oneskill`. All entrypoints support an explicit data location:

```bash
npm run cli -- skills --workspace /path/to/workspace
npm run cli -- web --workspace /path/to/workspace --open
```

Tests construct temporary data directories and use these same modules. They do not copy runtime source or substitute a different scanner.

## Scan and mutation flow

An overview loads Agent definitions once, checks installation evidence, then gathers bounded inventories and link counts. CLI detection requires a successful version response; resource directories are independent of installation evidence. Counts describe discovered data, not verified runtime availability of plugins or MCP servers.

Write operations revalidate their targets. Links never overwrite a real directory. Imports verify the library copy and move the original package into a backup directory associated with its source, leaving the source location empty. Importing never creates Agent links; those require a separate explicit link operation. Ignore changes update a local preference file; package contents are untouched. One owner process manages each canonical Workspace path. CLI, HTTP and MCP share a snapshot and mutation queue. Cached snapshots expire after 30 seconds; unchanged rescans preserve the data revision. Failed rescans retain the last successful snapshot with an explicit stale marker; filesystem target locks coordinate overlapping Agent roots across workspaces. Mutations use request receipts and optional revision preconditions. Completed writes are recorded and acknowledged before any further scan. Interrupted pending requests require a rescan and review rather than automatic replay. The service identity includes the application version; a new entrypoint drains and replaces an authenticated older owner. Browser requests also identify their UI version.

The HTTP service binds to loopback and checks local write authorization. It is intended for a single local user. All API reads and writes require authorization and same-origin checks. Browser cookies are scoped by Workspace identity so independent local services do not overwrite each other's access. CLI/MCP clients can reconnect to a verified replacement owner; mutation retries keep their original request identifiers. Plugin and MCP inventories expose names and locations without command arguments or environment secrets.

Skill controls represent writable filesystem targets. Agents with the same canonical target share one connection control in the inspector. Links found only in additional scan roots are reported as `inherited` availability, rather than independent writable links. Link/unlink writes only the configured target and never removes links from additional roots; those sources remain visible with their paths. Unmanaged packages found through a shared Skill root are inventoried once and identified as coming from a shared directory.

## Verification

`npm run check` checks all Node module syntax, executes fixture tests, and builds the Web UI. CI tests Node 20/22/24 on Linux and exercises discovery, configuration, workspace isolation, and real npm startup on macOS and Windows. Tests include an HTTP request that changes a link in an isolated workspace. Successful CI does not replace visual acceptance or a platform's actual Agent installation checks.

## Shared contracts and adapters

`src/contracts/operations.mjs` defines the only operation schemas and error model. `src/runtime/` owns lifecycle, snapshots, locks and request receipts. `src/adapters/mcp.mjs` publishes the same operations and the global UI entry. Web clients in `web/src/clients/` adapt HTTP and the standard MCP Apps bridge to the same interface. Managed, unmanaged and ignored Skills use one `skills` array.

Generated plugins under `dist/marketplace` are self-contained and excluded from Git. They include bundled Node code, built UI resources and the Agent catalog; user data stays in the selected Workspace. Web and the MCP App render the same top navigation and responsive layout. The UI resource URI includes the package version so hosts can distinguish updated resources; already-open frames may still require reopening. Desktop Sidebar app rendering is verified separately from SDK test-host checks.

The Skill library and unmanaged inbox share the `skills-surface` container. The library adds collection navigation; the inbox uses the same row rhythm with optional checkboxes for filtered bulk import/ignore/restore. Broken library links have an explicit repair panel. A footer exposes scan freshness and diagnostics. They share surface padding, row rhythm, selected-state tokens, and the same detail inspector. Plugin and MCP inventories deduplicate a physical configuration root used by multiple Agents and expose one combined filter for that source.
