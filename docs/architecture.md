# Sqwack Architecture

## Components

```text
┌─────────────────────────────────────────── Mac ───────────────────────────────────────────┐
│                                                                                           │
│  Claude Code hooks ──┐                                                                    │
│  Codex notify ───────┤   POST /v1/hooks/*        ┌──────────── sqwackd ────────────┐      │
│  send-event.sh ──────┴── POST /v1/events ──────► │ adapters (normalize)            │      │
│                                                  │   └► validate (SqwackEvent)     │      │
│                                                  │       └► Engine.ingest          │      │
│  lsof/ps ◄────────────────── process discovery ──│           ├► SQLite (persist)   │      │
│                                                  │           ├► session reducer    │      │
│                                                  │           └► broadcast          │      │
│                                                  └───────────────┬─────────────────┘      │
└──────────────────────────────────────────────────────────────────┼────────────────────────┘
                                                     LAN / Tailscale (WS + REST, bearer auth)
                                                                   │
                                                  ┌────────────────▼────────────────┐
                                                  │  Sqwack iPad app                │
                                                  │  SqwackStore                    │
                                                  │    └► NodeConnection[machine]   │
                                                  │  Overview/Agents/Dev/Settings   │
                                                  └─────────────────────────────────┘
```

- **sqwackd** (`daemon/`): Node.js/TypeScript, run directly by Node's native
  type-stripping (no build step). Plain `node:http` + `ws`; SQLite via
  `node:sqlite`. Single external runtime dependency (`ws`).
- **Sqwack** (`ios/`): SwiftUI, iPadOS 18+, Observation framework, URLSession
  WebSocket, Keychain credential storage. No third-party packages.
- **adapters** (`daemon/src/adapters/`): translate provider payloads into
  canonical `SqwackEvent`s. Provider formats never reach the iPad.

## Daemon modules

| Module | Responsibility |
|---|---|
| `config.ts` | `~/.sqwack/config.json`, stable machine UUID (generated once, never the hostname) |
| `persistence/db.ts` | repository over SQLite: events, sessions, paired devices, settings; retention pruning (events 14d, sessions 30d) |
| `events/validate.ts` | strict runtime validation of every incoming event |
| `sessions/reducer.ts` | pure state machine: event → session state; aggregate status |
| `core.ts` | Engine: ingest → persist → reduce → broadcast; snapshot; periodic sweeps |
| `api/server.ts` | REST + WebSocket, auth middleware, rate limits |
| `auth/auth.ts` | pairing codes, device tokens (SHA-256 hashed at rest), admin token (0600 file) |
| `processes/discovery.ts` | lsof-based listening-process discovery, categorization, safe kill |
| `adapters/` | Claude/Codex normalizers + safe installers |
| `demo.ts` | simulated event cycle through the real ingestion API |

## Session state reducer

Deterministic, pure, and tested (`daemon/tests/reducer.test.ts`):

```text
agent.started / agent.working  -> working
agent.needs_input              -> needs_input   (waitingSince latched)
agent.finished                 -> done          (finishedAt set)
agent.failed                   -> failed
agent.idle                     -> idle
```

Rules:

- **Out-of-order events never regress state**: an event older than the
  session's `updatedAt` is dropped.
- **Duplicates** are rejected by event-id uniqueness in SQLite before reduction.
- Events without a `sessionId` collapse onto a deterministic per-provider/
  per-project session key, so single-session CLIs still work.
- Working sessions silent for 30 minutes are swept to `idle`.
- `done` is informational: finished cards fade from the Overview board after an
  hour and never pulse.

Aggregate status (spec rule order): any `needs_input` → `attention`; else any
unacknowledged `failed` → `failure`; else any `working` → `working`; else
`quiet`. Failures can be acknowledged from the iPad (swipe on Agents), which
releases the global failure state without deleting history.

## Multi-machine readiness (built, not yet surfaced)

Every event, session, process, and API payload carries `machineId`. The iPad's
`SqwackStore` holds an array of `NodeConnection`s (one per daemon) and all its
query APIs take `machineId: String?` where `nil` = all machines; global status
is the worst across nodes. Adding machine #2 is: pair it, append a node, add a
machine picker — no schema or store changes.

## Security model

- Two credential classes: **admin token** (0600 file at `~/.sqwack/admin-token`,
  same-user only — used by CLI and hook scripts) and **device tokens** (issued
  by pairing, SHA-256 hashed in SQLite, revocable).
- Pairing codes are 8 chars, single-use, 5-minute expiry, rate-limited
  (5 attempts / 5 min), compared in constant time.
- Kill commands: rate-limited, PID-recycle-checked, SIGTERM only, daemon
  self-protected. No arbitrary command endpoint exists.
- Default bind is `127.0.0.1`; remote access is Tailscale-first
  (`tailscaleServe: true` keeps the daemon loopback-only). Funnel is never used.
- Event bodies are not logged by default (`logEventBodies: false`); hook
  payload summaries carry no prompt bodies or source code.
