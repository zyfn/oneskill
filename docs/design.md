# Interface conventions

oneskill is a local capability workspace. The primary task is to keep one skill library and choose which Agents can access each package. The interface should make that relationship visible before showing configuration detail.

## Hierarchy

- The application sidebar changes the capability type: Agents, Skills, Plugins, or MCP.
- Agents has two installation views, **Installed** and **Not installed**. Failed CLI checks belong to Not installed; the interface does not add a separate diagnostic group.
- Skills has two views: **Library** for everyday use and **Unmanaged** for review. Ignored items are a recoverable state inside Unmanaged.
- Collections navigate real directory structure. Selecting a parent includes descendants; root packages appear in All skills. The collection rail can be hidden completely and remembers that preference. Nested branches expand on demand, with bounded indentation; collapsing a branch preserves the current selection.
- The page introduction sits beside the title when space allows. A collapsed collection toggle, the active collection path, and link legend share the first matrix header. Keep column semantics accessible without repeating a visible Skill label. On mobile, collection navigation defaults closed; an expanded navigation sits above the matrix.
- Skill names and descriptions are primary. Agent link controls are aligned secondary actions. Agent names sit below their icons.
- A detail panel belongs to the selected item. Repeating the selection or pressing Escape closes it. Avoid repeating information already evident from the selected scope.

## Typography

The source of truth is `web/src/index.css`. Use Geist and the semantic size variables instead of ad hoc values.

| Role | Variable | Size |
| --- | --- | --- |
| Wordmark | `--type-brand` | 28 px, accompanied by a 32 px mark |
| Page title | `--type-page` | 30 px |
| Detail title | `--type-detail` | 22 px |
| Section title | `--type-section` | 16 px |
| Item title | `--type-title` | 14 px |
| Body | `--type-body` | 14 px |
| Supporting text | `--type-meta` | 13 px |
| Small label/count | `--type-label` | 12 px |

Use weight and space to establish hierarchy. Descriptions should remain readable; only supporting paths may use the smallest size. Counts use tabular numerals.

Skill, plugin, and MCP item names share 14 px, weight 580, line-height 1.5, and normal letter spacing. Their descriptions share 13 px, weight 400, and line-height 1.6. View and Agent filter labels use 14 px / 500; their counts remain 12 px / 400. Keep these shared rules out of per-component font utilities.

## Surfaces and controls

The canvas moves from neutral gray at the top into a muted blue-gray lower area. It is a fixed background; scrolling content must not introduce a separate bottom stripe.

Outer groups use a translucent surface and a restrained blur. Inner rows use a soft, gray-white surface with more opacity. Do not apply the same material depth to search, language switching, and every small button. Top-level scope and language choices share rounded capsules, a soft pale surface, and a muted blue selected label and border. Do not add decorative left accent bars, rainbow optics, or bright white selection outlines.

Plugins and MCP place their item cards directly on the canvas; Agent labels and spacing provide grouping without another card around them. Page titles do not display aggregate counts.

A muted blue border and tint identify selection. Hover affects the whole row, including the rounded ends; keyboard focus stays visible. Actions must distinguish idle, pending, completed, and failed states without relying only on color.

Agent filters remain one horizontal row with overflow edge fades and no visible scrollbar. Collection and matrix scrolling must stay inside their panes when a detail panel is open.

Use the single oneskill mark in `logo.svg`; `web/public/logo.svg` contains the same asset for the browser. Vendor marks identify vendors. Plugins use a supplied icon when available and the standard plugin icon otherwise.

The official mark is **Confluence**, rendered in muted slate blue `#5B78A4` on a transparent background.

## Product copy and acceptance

Describe the action and its actual scope. “Installed” requires program, desktop app, or extension installation evidence. CLI commands are checked with `--version`; failed checks appear under Not installed, with diagnostics retained in CLI JSON. Configuration folders only locate resources. Version success does not prove sign-in or session health. See [Agent discovery](agent-discovery.md). “Linked” refers to a filesystem symlink, not a network connection. Unmanaged rows show the source Agent; internal directory names belong in path details. A directory name does not establish that a skill is Agent-provided.

Check English and Chinese, desktop widths of 1280–1920 px, long names, empty collections, search with no results, selected details, inline failures, and real link/import/ignore/restore behavior. README screenshots remain in English.
