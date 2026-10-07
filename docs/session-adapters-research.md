# Agent session adapters

Research date: 2026-09-22

## Product boundary

The Sessions view should group sessions by Agent and sort each group by most recent activity. The first version only needs three fields and one action:

```ts
type SessionSummary = {
  agent: string
  id: string
  title: string
  updatedAt: string
  resumable: boolean
  cwd?: string
  resume?: { command: string; args: string[] }
  source: 'official-cli' | 'official-index' | 'local-store' | 'derived'
  confidence: 'high' | 'medium' | 'low'
}
```

An Agent should only expose **Resume** when its public CLI accepts an exact session identifier. Opening an Agent or project without selecting the requested session is not resume support.

Title fallback order:

1. official title/name in a CLI result or index;
2. title in session metadata;
3. first genuine user prompt, excluding injected system/context blocks;
4. workspace name plus a shortened session ID.

Updated-time fallback order:

1. official `updated_at`/`lastUpdatedAt` field;
2. latest timestamp in the session event stream;
3. session file modification time.

All local databases and event logs must be opened read-only. oneskill must never repair, rewrite, vacuum, or migrate another Agent's private storage.

## Support matrix

| Agent | Session source | Title / updated time | Exact resume | Confidence | First-version decision |
| --- | --- | --- | --- | --- | --- |
| Codex | `~/.codex/session_index.jsonl`; transcripts in `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl`; archived transcripts in `~/.codex/archived_sessions/` | `thread_name`, `updated_at` from the index | `codex resume <session-id>` | High, locally verified | Ship |
| QwenWork | `~/.qwenworkcn/projects/<encoded-cwd>/<session-id>.jsonl`; optional `<session-id>/state.json` | Derive title from first genuine user prompt; latest JSONL timestamp | No stable public exact-resume command found | Medium for listing, low for resume | Show read-only sessions; no Resume |
| Qwen Code | `$QWEN_RUNTIME_DIR/projects/<project>/chats/<session-id>.jsonl`; older releases also used `~/.qwen/tmp/<project-hash>/chats/` | Session metadata or first user prompt; latest record timestamp | `qwen --resume <session-id>` | Medium because the storage layout changed across versions | Ship behind version-aware adapter |
| Claude Code | `~/.claude/history.jsonl`; `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`; newer versions may add `sessions-index.json` | Prefer history/index title and timestamp; fall back to transcript | `claude --resume <session-id>` | High for resume, medium for enumeration because indexes may be stale | Ship with index + transcript reconciliation |
| Qoder | Official CLI session registry; diagnostic logs under `~/.qoder/logs/sessions/` are not the canonical conversation store | Parse `qoder --list-sessions`; exact fields require a machine with existing sessions | `qoder --resume <session-id>` | High for command contract, medium for list parsing | Ship through CLI, not filesystem logs |
| Cursor | `~/Library/Application Support/Cursor/User/globalStorage/conversation-search.db` table `conversations`; `state.vscdb` table `composerHeaders`; workspace `state.vscdb` contains composer data | `conversations.title`, `conversations.updated_at` | No stable public exact-resume interface found | High for local listing, low for resume | Show read-only sessions; no Resume |
| Gemini CLI | `~/.gemini/tmp/<project-hash>/chats/` | Official list includes first-prompt preview/date; session JSON provides timestamps | `gemini --resume <uuid>` | High | Ship; prefer CLI list |
| Antigravity | CLI/backend conversation registry; local cache `~/.gemini/antigravity-cli/cache/last_conversations.json` only maps workspace to the last conversation ID | Obtain title and recency from the official conversation picker/backend, not the cache | `agy --conversation <conversation-id>` | Medium; requires the Agent/backend to be available | Ship as a command-driven adapter |
| GitHub Copilot CLI | `~/.copilot/session-store.db`; per-session `~/.copilot/session-state/<session-id>/events.jsonl` and `workspace.yaml` | Store/metadata name and update time | `copilot --resume=<session-id>` | High | Ship |
| OpenCode | Current: `~/.local/share/opencode/opencode.db`; legacy: `~/.local/share/opencode/storage/session/<project-id>/<session-id>.json` | `opencode session list --format json` returns ID, title, updated time and directory | `opencode --session <session-id>` | High through CLI; DB fallback is version-sensitive | Ship; use JSON CLI first |
| OpenClaw | `openclaw sessions --all-agents --json`; current runtime state under `~/.openclaw/agents/<agent-id>/agent/openclaw-agent.sqlite`; legacy/archive data under `sessions/` | Official JSON exposes session activity fields | Not a coding-session resume model; continuation is channel/Gateway based | High for listing, incompatible resume semantics | Do not expose Resume in the coding-session view |
| Pi | `~/.pi/agent/sessions/--<encoded-cwd>--/<timestamp>_<uuid>.jsonl` | First user entry or metadata; latest event timestamp | `pi --session <path-or-id>` | High | Ship |
| DeepSeek Harness | `$DSH_HOME` (normally `~/.dsh`) owns session persistence; storage and resume behavior depend on the mounted profile/plugin | Read profile event metadata when the installed profile exposes it | Some profiles expose `dsh --resume <id>`; not a universal contract | Low to medium | Detect capability at runtime; otherwise hide Resume |
| Cline | VS Code: `~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/`; Cursor variant uses Cursor's corresponding `globalStorage`; task files live under `tasks/<task-id>/` with `api_conversation_history.json`, `ui_messages.json`, `task_metadata.json` | `state/taskHistory.json` and task metadata contain prompt/time information | No stable external exact-task resume interface found | Medium | Show read-only tasks; no Resume |
| Windsurf | Optional audit transcripts at `~/.windsurf/transcripts/<trajectory-id>.jsonl` when the transcript hook is configured | Transcript timestamps only; no guaranteed title | No stable public exact-resume interface found | Low | Unsupported for v1; audit transcript is not a session registry |
| Kiro CLI | `~/.kiro/sessions/cli/<session-id>.json` plus `<session-id>.jsonl`; `KIRO_HOME` can override the root | CLI/metadata title and timestamps | `kiro-cli chat --resume-id <session-id>` | High | Ship; official CLI list is source of truth |
| Trae | No documented stable local session schema or exact-resume interface found | Unknown | Unknown | Low | Unsupported until Trae provides a verified interface |
| Kimi Code | `$KIMI_CODE_HOME/sessions/` (default `~/.kimi-code/sessions/`), `~/.kimi-code/session_index.jsonl`, per-session `state.json`, and `agents/main/wire.jsonl` | Index/state title and update time | `kimi --session <session-id>` | High | Ship |

## Locally verified details

### Codex

`session_index.jsonl` rows on this machine contain:

```json
{"id":"...","thread_name":"...","updated_at":"..."}
```

Each rollout JSONL begins with a session metadata record containing the session ID, timestamp, working directory, source and version. The index is sufficient for the requested list; transcripts are only needed to recover a missing title or distinguish archived sessions.

### QwenWork

Observed JSONL record types include `user`, `assistant`, `active-leaf`, `runtime-config`, `workspace-directories`, `last-prompt`, `attachment`, `file-history-snapshot`, and `worktree-state`. User and assistant records include `sessionId`, `cwd`, `timestamp`, `message`, `uuid`, and `parentUuid`. The sibling `state.json` contains revision/update metadata but its item payloads are opaque, so it is not a safe title source.

QwenWork's installed management CLI does not expose a verified coding-session resume command. A derived title is useful for discovery, but the UI must not imply the session can be resumed.

### Qoder

The locally installed CLI exposes `--list-sessions`, `--resume [id]`, `--continue`, `--session-id`, `--delete-session`, and `--name`. Files under `~/.qoder/logs/sessions/` are diagnostic JSONL segments (`type`, `ts`, `seq`, `level`, `data`), not a supported conversation API. The adapter should execute the official list command and treat its output as authoritative.

### Cursor

`conversation-search.db` has a `conversations` table with:

```text
id, title, updated_at, source, scope, branches, is_archived,
root_fingerprint, cache_fingerprint
```

`state.vscdb` has a `composerHeaders` table containing `composerId`, `workspaceId`, `createdAt`, `lastUpdatedAt`, archive/subagent flags, recency, checkpoint time and a JSON value. This is enough to enumerate local conversations without opening full transcripts. It remains a private implementation detail, so the adapter needs schema checks and must fail closed when a Cursor update changes the database.

## Recommended adapter architecture

Do not add session directories to the existing general capability scan. `src/core.mjs` intentionally prunes `sessions`, `archived_sessions`, logs and history to keep Skill/Plugin/MCP discovery bounded. Sessions need explicit per-Agent adapters:

```text
src/sessions/
  index.mjs                 registry + normalized sorting
  command.mjs               bounded process runner
  stores.mjs                read-only JSONL / JSON / SQLite helpers
  adapters/
    codex.mjs
    claude.mjs
    qoder.mjs
    cursor.mjs
    ...
```

Each adapter should implement:

```ts
interface SessionAdapter {
  detect(): Promise<{ available: boolean; reason?: string }>
  list(): Promise<SessionSummary[]>
  resume?(id: string): Promise<void>
}
```

The first implementation batch should be **Codex, Claude Code, Qoder, Gemini CLI, GitHub Copilot CLI, OpenCode, Pi, Kiro CLI and Kimi Code**. They have a usable exact-ID resume contract. Cursor, QwenWork and Cline can appear as read-only groups only if the UI clearly omits Resume. Antigravity and DeepSeek Harness should be enabled only after runtime capability detection. Windsurf and Trae should remain absent or show an explicit unsupported state.

Session adapters must verify the relevant CLI with a successful version command before enabling command-based resume. Session stores and configuration directories are independent filesystem evidence; neither an existing store nor an executable file establishes that the CLI runs successfully. This document is a dated research plan, not a report of current runtime availability or shipped session support.

## UI behavior

- One section per Agent, sorted by the newest session in that group.
- A collapsed section shows Agent logo/name, session count and last activity.
- A row shows title, relative update time, optional workspace, and Resume only when exact resume is supported.
- Resume launches an argument array directly; never interpolate the ID into a shell string.
- Empty groups should be hidden by default. “Installed but no sessions” is useful only in a diagnostic view.
- A read-only group should say “可查看历史记录，当前 Agent 暂不支持从这里继续”, rather than showing a disabled Resume button on every row.
- Scanning errors belong at the Agent-group level so one damaged database does not blank the whole page.

## Reliability and validation

Before marking an adapter supported, add fixture tests for title fallback, latest-time selection, malformed/truncated JSONL, missing indexes, archived sessions and schema drift. Add an opt-in local smoke command that only prints redacted summaries:

```bash
oneskill sessions --agent codex --json
oneskill sessions --agent qoder --json
```

Resume must be tested with a disposable session for each installed Agent. A successful process launch alone is insufficient: the Agent must open the requested session ID.

## Primary references

- [Codex CLI resume](https://developers.openai.com/de-DE/docs/codex/cli)
- [Qwen Code settings and chat recording](https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md)
- [Qoder CLI reference](https://docs.qoder.com/cli/cli-reference)
- [Gemini CLI session management](https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/session-management.md)
- [Antigravity resume command](https://antigravity.google/docs/cli/commands/resume)
- [GitHub Copilot CLI configuration directory](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference)
- [GitHub Copilot CLI multiple sessions](https://docs.github.com/en/copilot/how-tos/copilot-cli/use-copilot-cli/work-with-multiple-sessions)
- [OpenCode TUI and session flags](https://opencode.ai/docs/tui/)
- [OpenClaw session CLI](https://github.com/openclaw/openclaw/blob/main/docs/cli/sessions.md)
- [Pi session format](https://github.com/fivewillow/badlogic-pi-mono/blob/main/packages/coding-agent/docs/session.md)
- [Cline task management](https://github.com/cline/cline/blob/main/docs/core-workflows/task-management.mdx)
- [Windsurf transcript hook](https://docs.windsurf.com/de/windsurf/cascade/hooks)
- [Kiro CLI session management](https://kiro.dev/docs/cli/chat/session-management/)
- [Kimi Code sessions](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/guides/sessions.md)
