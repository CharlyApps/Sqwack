# Sqwack Wire Protocol (v1)

Schema version: `1`. All timestamps are ISO-8601 UTC with milliseconds.
Canonical TypeScript definitions: `daemon/src/types.ts`. Swift mirrors:
`ios/Sqwack/Models/Models.swift`. The two are kept in sync by hand — this
document is the contract.

## Authentication

Every endpoint except `GET /v1/health` and `POST /v1/pair` requires
`Authorization: Bearer <token>`. Tokens are either the machine-local admin
token or a paired-device token. WebSocket clients may pass the token as a
`?token=` query parameter instead of a header.

## Canonical event

```ts
interface SqwackEvent {
  id: string;                 // unique; duplicates are rejected
  schemaVersion: 1;
  machineId: string;
  timestamp: string;
  source: {
    provider: "codex" | "claude" | "deepseek" | "hermes" | "system" | "generic";
    integration: string;      // e.g. "claude-code", "codex-cli"
    surface?: "cli" | "desktop" | "ide" | "cloud" | "manual";
  };
  type:
    | "agent.started" | "agent.working" | "agent.needs_input"
    | "agent.finished" | "agent.failed" | "agent.idle"
    | "process.started" | "process.stopped" | "process.failed"
    | "system.heartbeat";
  sessionId?: string;
  project?: { id?: string; name?: string; cwd?: string };
  title?: string;
  message?: string;
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
}
```

## Derived models

```ts
type AgentState = "working" | "needs_input" | "done" | "failed" | "idle" | "unknown";
type SqwackStatus = "quiet" | "working" | "attention" | "failure";

interface AgentSession {
  id: string;                 // "<provider>:<sessionId>" or a derived project key
  machineId: string;
  provider: "codex" | "claude" | "deepseek" | "hermes" | "generic";
  projectId?: string; projectName?: string; cwd?: string;
  title?: string;
  state: AgentState;
  summary?: string;
  startedAt?: string; updatedAt: string; finishedAt?: string; waitingSince?: string;
  source: string;             // integration name
  metadata?: Record<string, unknown>;   // includes acknowledgedAt when acked
}

interface Machine {
  id: string;                 // stable UUID, generated on first run
  name: string; hostname: string; platform: string; architecture: string;
  daemonVersion: string;
  status: "online" | "offline" | "degraded";
  lastSeenAt: string;
  capabilities: string[];
}

interface DevProcess {
  id: string;                 // "<pid>-<start-time-b36>": stable across PID recycling
  machineId: string;
  pid: number; name: string; command?: string; cwd?: string;
  port?: number; protocol?: string; startedAt?: string;
  category?: "node" | "java" | "python" | "database" | "other";
  killable: boolean;
}
```

```ts
interface ProviderUsage {
  provider: "codex" | "claude" | "deepseek";
  planType?: string;
  windows: { label: string; usedPercent: number; resetsAt?: string; detail?: string }[]; // "5h", "week", balance text
  collectedAt: string;
  source: string;
}
```

```ts
interface SystemSnapshot {   // host machine stats + last ~10min history
  stats: { cpuPercent, cpuUserPercent, cpuSystemPercent, ramUsedBytes, ramTotalBytes,
           diskUsedBytes, diskTotalBytes, uptimeSeconds, processCount, networkMbps, collectedAt };
  history: { cpu: number[]; ram: number[]; network: number[] };
}
// Snapshot also carries: topProcesses (top-5 by CPU), activity (recent event feed),
// per-session `activity` (per-minute event bins, sparkline data), and per-process
// cpuPercent / memoryBytes / cpuHistory.
```

## REST endpoints

| Method & path | Auth | Description |
|---|---|---|
| `GET /v1/health` | none | `{ status, version, machineId }` |
| `POST /v1/pair` | none (rate-limited) | body `{ code, deviceName }` → `{ token, deviceId, machine }`; codes are single-use, 5-min expiry |
| `POST /v1/pair/start` | admin | begin pairing → `{ code, expiresAt }` |
| `GET /v1/snapshot` | yes | `{ machine, status, sessions, attention, processes, usage, system, topProcesses, activity, connectedAt }` |
| `POST /v1/events` | yes | ingest a canonical event; `202` accepted, `200` + `duplicate: true`, `400` invalid |
| `POST /v1/hooks/claude` | admin | raw Claude Code hook payload → normalized + ingested |
| `POST /v1/hooks/codex` | admin | raw Codex notify payload → normalized + ingested |
| `GET /v1/sessions` | yes | filters: `state`, `provider`, `project`, `machineId` (or `all`) |
| `GET /v1/sessions/:id` | yes | one session |
| `POST /v1/sessions/:id/ack` | yes | acknowledge (clears attention/failure hold) |
| `GET /v1/sessions/:id/transcript` | yes | conversation read live from the provider's own files (never persisted by Sqwack) |
| `GET /v1/processes` | yes | fresh discovery of listening dev processes |
| `POST /v1/usage/refresh` | yes | refresh provider usage on demand; optional body `{ provider: "codex" \| "claude" \| "deepseek" }` → `{ usage }` |
| `POST /v1/processes/:id/kill` | yes (rate-limited) | verify identity → SIGTERM → `{ outcome: "exited" \| "terminating" }`; `404` unknown id, `409` refused |
| `GET /v1/integrations` | yes | `IntegrationCapability[]` |
| `GET /v1/devices` | yes | paired devices |

## WebSocket — `GET /v1/ws`

On connect the server immediately sends a full `snapshot`, then streams:

```ts
type ServerMessage =
  | { type: "snapshot";          data: Snapshot }      // on every (re)connect
  | { type: "event";             data: SqwackEvent }
  | { type: "session.updated";   data: AgentSession }
  | { type: "processes.updated"; data: DevProcess[] }  // every ~20s and after kills
  | { type: "usage.updated";     data: ProviderUsage[] } // after manual refresh, on change
  | { type: "system.updated";    data: SystemSnapshot }  // every ~10s
  | { type: "status.updated";    data: SqwackStatus }  // only on change
  | { type: "heartbeat";         timestamp: string };  // every 30s
```

Clients send nothing; commands go over REST. Reconnecting clients need no
catch-up protocol — the fresh snapshot supersedes everything missed.

## Versioning

Breaking changes bump `schemaVersion` and the `/v1` prefix together. Events
with an unknown `schemaVersion` are rejected with `400`.
