// Canonical wire types. Documented in docs/protocol.md — keep in sync.

export type AgentState =
  | "working"
  | "needs_input"
  | "done"
  | "failed"
  | "idle"
  | "unknown";

export type SqwackStatus = "quiet" | "working" | "attention" | "failure";

export type Provider =
  | "codex"
  | "claude"
  | "deepseek"
  | "hermes"
  | "system"
  | "generic";

export type EventType =
  | "agent.started"
  | "agent.working"
  | "agent.needs_input"
  | "agent.finished"
  | "agent.failed"
  | "agent.idle"
  | "process.started"
  | "process.stopped"
  | "process.failed"
  | "system.heartbeat";

export interface SqwackEvent {
  id: string;
  schemaVersion: 1;
  machineId: string;
  timestamp: string;
  source: {
    provider: Provider;
    integration: string;
    surface?: "cli" | "desktop" | "ide" | "cloud" | "manual";
  };
  type: EventType;
  sessionId?: string;
  project?: { id?: string; name?: string; cwd?: string };
  title?: string;
  message?: string;
  severity?: "info" | "success" | "warning" | "error";
  metadata?: Record<string, unknown>;
}

export interface ActivityItem {
  timestamp: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
}

export interface AgentSession {
  id: string;
  machineId: string;
  provider: Exclude<Provider, "system">;
  projectId?: string;
  projectName?: string;
  cwd?: string;
  title?: string;
  state: AgentState;
  summary?: string;
  startedAt?: string;
  updatedAt: string;
  finishedAt?: string;
  waitingSince?: string;
  source: string;
  metadata?: Record<string, unknown>;
  /** Transient: per-minute event counts for the last 30 min (sparklines). */
  activity?: number[];
}

export interface Machine {
  id: string;
  name: string;
  hostname: string;
  platform: string;
  architecture: string;
  daemonVersion: string;
  status: "online" | "offline" | "degraded";
  lastSeenAt: string;
  capabilities: string[];
}

export interface DevProcess {
  id: string;
  machineId: string;
  pid: number;
  name: string;
  command?: string;
  cwd?: string;
  port?: number;
  protocol?: string;
  startedAt?: string;
  category?: "node" | "java" | "python" | "database" | "other";
  killable: boolean;
  cpuPercent?: number;
  memoryBytes?: number;
  cpuHistory?: number[];
}

export interface IntegrationCapability {
  integration: string;
  installed: boolean;
  surfaces: string[];
  events: string[];
  confidence: "native" | "derived" | "best_effort";
}

export interface HermesPlatform {
  name: string;
  state: string;
}

export interface HermesCronJob {
  id: string;
  jobId: string;
  name: string;
  enabled: boolean;
  state?: string;
  schedule: string;
  nextRunAt?: string;
  lastRunAt?: string;
  lastStatus?: string;
  errorKind?: string;
  delivery?: string;
}

export interface HermesGateway {
  profile: string;
  running: boolean;
  state: string;
  activeAgents: number;
  platforms: HermesPlatform[];
  cronJobs: HermesCronJob[];
}

export interface HermesSnapshot {
  gateways: HermesGateway[];
  updatedAt: string;
}

export interface Snapshot {
  machine: Machine;
  status: SqwackStatus;
  sessions: AgentSession[];
  attention: AgentSession[];
  processes: DevProcess[];
  usage: import("./usage/usage.ts").ProviderUsage[];
  system?: SystemSnapshot;
  topProcesses?: import("./system/stats.ts").ProcessMetric[];
  activity?: ActivityItem[];
  hermes?: HermesSnapshot;
  connectedAt: string;
}

export interface SystemSnapshot {
  stats: import("./system/stats.ts").SystemStats;
  history: { cpu: number[]; ram: number[]; network: number[] };
}

export type ServerMessage =
  | { type: "snapshot"; data: Snapshot }
  | { type: "event"; data: SqwackEvent }
  | { type: "session.updated"; data: AgentSession }
  | { type: "processes.updated"; data: DevProcess[] }
  | { type: "usage.updated"; data: import("./usage/usage.ts").ProviderUsage[] }
  | { type: "system.updated"; data: SystemSnapshot }
  | { type: "hermes.updated"; data: HermesSnapshot }
  | { type: "status.updated"; data: SqwackStatus }
  | { type: "heartbeat"; timestamp: string };

export const STATE_PRIORITY: AgentState[] = [
  "needs_input",
  "failed",
  "done",
  "working",
  "idle",
  "unknown",
];
