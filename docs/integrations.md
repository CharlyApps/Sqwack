# Integrations

Adapters translate provider-specific payloads into canonical `SqwackEvent`s
(see [protocol.md](protocol.md)). Provider payloads never reach the iPad.
Support levels are reported honestly via `GET /v1/integrations` and
`sqwackd integrations status` — nothing is faked.

| Integration | Support | Confidence | Mechanism |
|---|---|---|---|
| Claude Code (CLI) | full | `native` | official lifecycle hooks |
| Codex (CLI) | partial | `derived` | official `notify` configuration |
| Claude Desktop | unsupported | — | no supported native event mechanism |
| Codex Desktop | partial/unknown | — | shares `~/.codex/config.toml`; behavior is capability-tested, not assumed |
| Cloud agent runs | not in MVP | — | schema reserves `surface: "cloud"` |

## Claude Code — `claude-code` (native)

`sqwackd integrations install claude` adds command hooks to
`~/.claude/settings.json` (backup written first; only the `hooks` key is
touched; existing hook entries are preserved — ours are appended):

| Claude hook | Sqwack event | Note |
|---|---|---|
| `SessionStart` | `agent.started` | |
| `UserPromptSubmit` | `agent.working` | |
| `Notification` | `agent.needs_input` | carries Claude's own message ("Claude needs your permission…") |
| `Stop` | `agent.finished` | **a turn finished, not necessarily the whole task** — summary reads "Finished a turn"; raw hook name kept in `metadata.claudeHook` |
| `SessionEnd` | `agent.idle` | |

The hook script (`~/.sqwack/bin/sqwack-claude-hook`) forwards the hook's stdin
JSON to `POST /v1/hooks/claude` with a 3s timeout and always exits 0 — a dead
daemon can never block Claude.

## Codex — `codex-cli` (derived)

`sqwackd integrations install codex` configures `notify` in
`~/.codex/config.toml` (user-level, so it applies across Codex surfaces that
honor it). TOML top-level placement is handled correctly, and:

- If **no** notify exists: `notify = ["~/.sqwack/bin/sqwack-codex-notify"]`.
- If a notify **already exists** (e.g. Codex Computer Use): a chain wrapper is
  installed that forwards to Sqwack *and then* execs your original notifier
  with the same arguments. Nothing is lost.

| Codex notify type | Sqwack event |
|---|---|
| `agent-turn-complete` | `agent.finished` (summary = first 140 chars of last assistant message) |
| `agent-turn-start` / `session-start` | `agent.working` |
| `*approval*` | `agent.needs_input` |

Codex's notify channel does not expose rich lifecycle state on every surface,
hence `derived` confidence. Do not expect `working` cards from every Codex
version; turn completion is the reliable signal.

## Desktop apps

Per the design requirement: no UI scraping, no accessibility-API integration,
no brittle private-file parsing in core. If a desktop surface gains an
official hook/notification/extension interface, it becomes a new adapter under
`daemon/src/adapters/`; until then it is reported as unsupported.

## Writing your own adapter

Anything that can run `curl` can feed Sqwack — POST canonical events to
`/v1/events` using the admin token (see `examples/send-event.sh`), or add a
normalizer under `daemon/src/adapters/<name>/` plus a route in
`api/server.ts` if the tool has its own payload format.
