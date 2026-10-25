# Interface conventions

oneskill is a local Skill library with explicit Agent connections. The working interface uses an editorial library layout: the original blue-gray canvas and translucent working surfaces, restrained blue interaction states, and a small Confluence mark. The same React interface serves Web and Codex.

## Product hierarchy

- **Skills** is the default route and the brand's home destination. Library and Unmanaged share the same header, inspector, and list rhythm.
- **Agents** lists installation evidence and discovered resource counts. Installed and Not installed remain the only two views; selecting an Agent opens its evidence and paths.
- **Plugins** and **MCP** have separate top-level routes. Both show read-only inventories in compact cards. Neither a cached package nor an MCP declaration establishes activation or server health.
- Two-way filters sit immediately before search. Resource ownership uses a compact select rather than another full row of capsules.
- Collections reflect real directories. Parent selection includes descendants; root packages belong to All skills. The rail stays visible when collections exist.

## Working surfaces

Use Geist and semantic type tokens from `web/src/index.css`: page title 28 px, detail title 20–21 px, item title 14 px, supporting text 13 px, labels 12 px. Keep filter labels at least 12 px at narrow widths.

Skills use compact rows with a name, one line of description, and connection context. Plugins and MCP share one compact card component: an icon, title, supporting description, and optional version or declaration state. Cards sit directly on the canvas below Agent headings, without an enclosing card; use two columns on desktop and one on narrow screens. Hover and selection use a light blue tint. Agent tables retain aligned numeric columns. All inventories share typography, spacing, and color tokens edited at their source.

Only linked Agent targets appear in the Skill preview. Conflicts have an explicit attention label. A selected Skill shows its directory-link controls near the top of the inspector; paths and the full document are secondary disclosures. The inspector's connection branches reuse the Confluence motif. Shared discoveries never activate an Agent's directory indicator. Read-only references elsewhere within an Agent's own directory show their source rather than an inoperable switch.

## Changes and recovery

Unmanaged selection happens within the current filtered list. Bulk import, ignore, and restore act on at most 100 visible items. The list preserves the search, source filter, and partial failure results. Import receipts expose original backup locations.

Adding a Skill to the library moves it away from its original directory and retains a verified backup. It does not connect any Agent automatically. Agent switches handle connections as a separate action. A real package outside the library is unmanaged; an existing link pointing into the library remains a reference to a managed package.

Broken links pointing into this library appear in a review disclosure above the list. Reconnecting requires an explicit managed Skill choice; removing a broken link never removes the shared source. Real folders, healthy links, and references outside this library are not eligible. The backend rechecks ownership and rejects nested destination aliases.

The footer shows the library location and last successful scan for the visible inventory. Agents summarizes Skills, Plugins, and MCP; hidden CLI-only inventories do not mark these pages as failed. A disclosure distinguishes unreadable files from scan limits. Polling visible workspaces refreshes expired snapshots; stale results are identified, and writes are blocked until a successful scan. A committed write stays successful if refreshing the interface fails.

## Navigation and feedback

The transparent Confluence mark in `logo.svg` is shared with `web/public/logo.svg` and the plugin icon. Vendor marks identify vendors, not connection status.

The header displays the static Confluence logo and wordmark. A transparent glass capsule glides between routes with a soft, brief CSS stretch; a fine outline and stronger blue label keep selection legible on the original blue-gray background. Inactive routes stay muted. Reduced-motion preferences disable the transition and stretch.

There is no shader dependency, canvas renderer, mirrored entrance, or decorative connection animation. The navigation lens uses native elements, CSS gradients, backdrop blur, and one bounded selection transition. Ordinary loading and focus feedback remain available. Web and the self-contained MCP App use the same CSS tokens and components.

## Acceptance

Check English and Chinese at desktop and narrow widths, long names, empty/search states, selected details, readable focus states, inline failures, and scan diagnostics. Exercise link/unlink, broken-link repair/removal, filtered bulk import, ignore, and restore in an isolated workspace. Verify both the rendered state and resulting filesystem contents. Installed plugin assets must match the source build.
