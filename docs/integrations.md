# Integrations

Adapters translate provider-specific payloads into canonical `SqwackEvent`s
(see [protocol.md](protocol.md)). Provider payloads never reach the iPad.
Support levels are reported honestly via `GET /v1/integrations` and
`sqwackd integrations status` — nothing is faked.

| Integration | Support | Confidence | Mechanism |
|---|---|---|---|
| Claude Code (CLI, desktop app, IDE) | full | `native` | official lifecycle hooks via `~/.claude/settings.json` |
| Codex (CLI + desktop, interactive) | full | `native` with trusted hooks, else `derived` | lifecycle hooks (`~/.codex/hooks.json`) + `notify` fallback |
| Codex `exec` (non-interactive) | full | `native` | `sqwack-codex-exec` wrapper over `codex exec --json` |
| Claude Desktop (chat app) | unsupported | — | no supported native event mechanism |
| Cloud agent runs | not in MVP | — | schema reserves `surface: "cloud"` |

Integrations apply per *session*: a Claude/Codex session that was already
running when hooks were installed will not report — start a new session.

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

## Codex — three channels, capability-detected

`sqwackd integrations install codex` installs all three; the daemon
shape-detects which one each payload came from on `/v1/hooks/codex`:

**1. Lifecycle hooks (`codex-hooks`, `native`) — richest.** Merged additively
into `~/.codex/hooks.json` (backup written; existing hooks preserved):

| Codex hook | Sqwack event |
|---|---|
| `SessionStart` | `agent.started` |
| `UserPromptSubmit` | `agent.working` |
| `PermissionRequest` | `agent.needs_input` — the amber NEEDS YOU card, with the tool name |
| `Stop` | `agent.finished` |
| `SessionEnd` | `agent.idle` |

The hook script emits nothing on stdout, so it can never influence a
PermissionRequest decision — Codex's own approval prompt always continues.
**One manual step:** Codex requires trusting new command hooks — run `/hooks`
inside Codex once and trust the sqwack entries. Until trusted, the notify
fallback still reports turn completions.

**2. `codex exec --json` wrapper (`codex-exec`, `native`).** Non-interactive
runs are observable through `~/.sqwack/bin/sqwack-codex-exec` — a drop-in for
`codex exec` that passes the JSONL stream through untouched and forwards
`thread.started` / `turn.started` / `turn.completed` / `turn.failed` / `error`
/ agent messages to Sqwack (so exec runs get WORKING, DONE, and FAILED cards).
Plain `codex exec` (without the wrapper) fires no notify and stays unobserved.

**3. `notify` fallback (`codex-cli`, `derived`).** Configured in
`~/.codex/config.toml`; reports turn completions only. Needs no hook trust and
survives being re-chained by other tools:

- If no notify existed: `notify = [".../sqwack-codex-notify"]`.
- If one existed (e.g. Codex Computer Use): a chain wrapper preserves it.
- Codex Computer Use rewrites `notify` on app start and re-chains previous
  notifiers via `--previous-notify` — the forwarder takes the *last* argument
  as payload so it survives. Invocations are logged (timestamp + size only) to
  `~/.sqwack/logs/codex-notify.log`.

Capability-tested notes (Codex 0.147, macOS): the desktop app shares
`config.toml`/`hooks.json` with the CLI and reads them **only at startup** —
restart the app after installing.

## Usage / rate limits

The Overview shows provider usage meters where a *local, native* data source
exists — no reverse-engineered network calls:

- **Codex**: rate-limit snapshots (used %, window, reset time, plan) that Codex
  itself writes into its session rollout files. Refreshed manually from the app.
- **Claude**: Claude Code exposes no account rate-limit data in any local file
  (verified against transcripts) — so no meter is shown rather than a fake one.
  The adapter slot exists (`daemon/src/usage/usage.ts`) for when it does.

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
