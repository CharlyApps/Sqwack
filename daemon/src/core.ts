import type { AgentSession, DevProcess, ServerMessage, Snapshot, SqwackEvent, SqwackStatus } from "./types.ts";
import type { Store } from "./persistence/db.ts";
import type { Config } from "./config.ts";
import { machineInfo } from "./config.ts";
import { reduceEvent, sessionKey, computeStatus, attentionSessions, sweepStale } from "./sessions/reducer.ts";
import { discoverProcesses } from "./processes/discovery.ts";
import { discoverClaudeProcessSessions } from "./adapters/claude/processes.ts";
import { collectUsage, USAGE_PROVIDERS, type ProviderUsage, type UsageProvider } from "./usage/usage.ts";
import { collectSystemStats, topProcesses, type ProcessMetric } from "./system/stats.ts";
import type { ActivityItem, SystemSnapshot } from "./types.ts";
import { log } from "./log.ts";

/** Central state machine: events in, session/status updates + broadcasts out. */
export class Engine {
  private listeners = new Set<(msg: ServerMessage) => void>();
  private lastStatus: SqwackStatus = "quiet";
  private processes: DevProcess[] = [];
  private usage: ProviderUsage[] = [];
  private system: SystemSnapshot | undefined;
  private processMetrics = new Map<number, ProcessMetric>();
  private top: ProcessMetric[] = [];
  private serviceCpuHistory = new Map<number, number[]>();
  private usageRefreshes = new Map<string, Promise<void>>();

  public store: Store;
  public config: Config;

  constructor(store: Store, config: Config) {
    this.store = store;
    this.config = config;
    this.lastStatus = computeStatus(this.store.allSessions());
  }

  onBroadcast(fn: (msg: ServerMessage) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(msg: ServerMessage): void {
    for (const fn of this.listeners) fn(msg);
  }

  /** Ingest a validated event. Returns false for duplicates. */
  ingest(event: SqwackEvent): boolean {
    if (!this.store.insertEvent(event)) {
      log.debug("duplicate event ignored", { id: event.id });
      return false;
    }
    if (this.config.logEventBodies) log.debug("event", event);
    else log.info(`event ${event.type} from ${event.source.integration}`);
    this.broadcast({ type: "event", data: event });

    const key = sessionKey(event);
    if (key) {
      const updated = reduceEvent(this.store.getSession(key), event);
      if (updated) {
        this.store.upsertSession(updated);
        this.broadcast({ type: "session.updated", data: updated });
      }
    }
    this.refreshStatus();
    return true;
  }

  acknowledgeSession(id: string): AgentSession | undefined {
    const session = this.store.getSession(id);
    if (!session) return undefined;
    const updated: AgentSession = {
      ...session,
      metadata: { ...session.metadata, acknowledgedAt: new Date().toISOString() },
    };
    this.store.upsertSession(updated);
    this.broadcast({ type: "session.updated", data: updated });
    this.refreshStatus();
    return updated;
  }

  private refreshStatus(broadcast = true): void {
    const status = computeStatus(this.store.allSessions());
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      if (broadcast) this.broadcast({ type: "status.updated", data: status });
    }
  }

  async refreshProcesses(broadcast = true): Promise<DevProcess[]> {
    const discovered = await discoverProcesses(this.config.machineId, this.config.processFilters.excludeCommands);
    await this.refreshClaudeProcessSessions(broadcast);
    // Enrich with per-process cpu/mem from the latest system sample.
    const livePids = new Set(discovered.map((p) => p.pid));
    for (const pid of this.serviceCpuHistory.keys()) if (!livePids.has(pid)) this.serviceCpuHistory.delete(pid);
    for (const proc of discovered) {
      const metric = this.processMetrics.get(proc.pid);
      if (metric) {
        proc.cpuPercent = metric.cpuPercent;
        proc.memoryBytes = metric.memoryBytes;
        const history = this.serviceCpuHistory.get(proc.pid) ?? [];
        history.push(metric.cpuPercent);
        if (history.length > 30) history.shift();
        this.serviceCpuHistory.set(proc.pid, history);
        proc.cpuHistory = history;
      }
    }
    this.processes = discovered;
    if (broadcast) this.broadcast({ type: "processes.updated", data: this.processes });
    return this.processes;
  }

  private async refreshClaudeProcessSessions(broadcast = true): Promise<void> {
    const sessions = this.store.allSessions();
    const hookSessions = sessions.filter((s) =>
      s.provider === "claude" && s.source !== "claude-process" && s.cwd && s.startedAt
    );
    const live = (await discoverClaudeProcessSessions(this.config.machineId)).filter((proc) =>
      !hookSessions.some((hook) =>
        hook.cwd === proc.cwd
        && hook.startedAt
        && proc.startedAt
        && Math.abs(Date.parse(hook.startedAt) - Date.parse(proc.startedAt)) < 5 * 60_000
      )
    );
    const liveIds = new Set(live.map((s) => s.id));
    for (const session of live) {
      const existing = this.store.getSession(session.id);
      this.store.upsertSession(session);
      if (broadcast && (!existing || existing.state !== "working")) {
        this.broadcast({ type: "session.updated", data: session });
      }
    }
    for (const session of sessions) {
      if (session.source !== "claude-process" || liveIds.has(session.id) || session.state !== "working") continue;
      const idle = {
        ...session,
        state: "idle" as const,
        summary: "Claude Code process exited",
        updatedAt: new Date().toISOString(),
      };
      this.store.upsertSession(idle);
      if (broadcast) this.broadcast({ type: "session.updated", data: idle });
    }
    this.refreshStatus(broadcast);
  }

  async refreshSystem(): Promise<void> {
    const { stats, processMetrics } = await collectSystemStats();
    this.processMetrics = processMetrics;
    this.top = topProcesses(processMetrics);
    const history = this.system?.history ?? { cpu: [], ram: [], network: [] };
    const push = (arr: number[], value: number) => {
      arr.push(Math.round(value * 10) / 10);
      if (arr.length > 60) arr.shift();
    };
    push(history.cpu, stats.cpuPercent);
    push(history.ram, (stats.ramUsedBytes / stats.ramTotalBytes) * 100);
    push(history.network, stats.networkMbps);
    this.system = { stats, history };
    this.broadcast({ type: "system.updated", data: this.system });
  }

  /** Human-readable feed of the most recent normalized events. */
  private recentActivity(limit = 20): ActivityItem[] {
    return this.store
      .recentEvents(limit)
      .filter((e) => e.type.startsWith("agent."))
      .map((e) => {
        const who = e.source.provider.charAt(0).toUpperCase() + e.source.provider.slice(1);
        const project = e.project?.name ? ` (${e.project.name})` : "";
        const verb = e.type.replace("agent.", "").replace("needs_input", "needs input").replace("started", "started").replace("finished", "finished");
        return {
          timestamp: e.timestamp,
          message: `${who}${project} ${verb}`,
          severity: e.severity ?? "info",
        };
      });
  }

  /** Per-minute event counts for the last 30 minutes for one session. */
  private sessionActivity(sessionId: string): number[] {
    const raw = sessionId.includes(":") ? sessionId.slice(sessionId.indexOf(":") + 1) : sessionId;
    const since = Date.now() - 30 * 60_000;
    const bins = new Array<number>(30).fill(0);
    for (const ts of this.store.sessionEventTimes(raw, new Date(since).toISOString())) {
      const bin = Math.min(29, Math.max(0, Math.floor((ts - since) / 60_000)));
      bins[bin]++;
    }
    return bins;
  }

  cachedProcesses(): DevProcess[] {
    return this.processes;
  }

  async refreshUsage(provider?: UsageProvider): Promise<void> {
    const key = provider ?? "all";
    const active = this.usageRefreshes.get(key);
    if (active) return active;
    const refresh = this.refreshUsageNow(provider).finally(() => { this.usageRefreshes.delete(key); });
    this.usageRefreshes.set(key, refresh);
    return refresh;
  }

  private async refreshUsageNow(provider?: UsageProvider): Promise<void> {
    if (!provider) {
      await Promise.all(USAGE_PROVIDERS.map((p) => this.refreshUsageNow(p)));
      return;
    }
    const fresh = await collectUsage(provider);
    const cutoff = Date.now() - 15 * 60_000;
    // ponytail: short stale window smooths transient 429/offline reads; add per-provider error state if users need diagnostics.
    const usage = this.usage.filter((u) => Date.parse(u.collectedAt) > cutoff);
    for (const item of fresh) {
      const i = usage.findIndex((u) => u.provider === item.provider);
      if (i === -1) usage.push(item);
      else usage[i] = item;
    }
    if (JSON.stringify(usage.map(u => ({...u, collectedAt: ""}))) !== JSON.stringify(this.usage.map(u => ({...u, collectedAt: ""})))) {
      this.broadcast({ type: "usage.updated", data: usage });
    }
    this.usage = usage;
  }

  snapshot(): Snapshot {
    const sessions = this.store.allSessions();
    const withActivity = sessions.slice(0, 50).map((s) => ({ ...s, activity: this.sessionActivity(s.id) }));
    return {
      machine: machineInfo(this.config),
      status: computeStatus(sessions),
      sessions: withActivity,
      attention: attentionSessions(sessions),
      processes: this.processes,
      usage: this.usage,
      system: this.system,
      topProcesses: this.top,
      activity: this.recentActivity(),
      connectedAt: new Date().toISOString(),
    };
  }

  /** Periodic upkeep: idle out silent sessions, prune old rows. */
  sweep(): void {
    for (const changed of sweepStale(this.store.allSessions(), Date.now())) {
      this.store.upsertSession(changed);
      this.broadcast({ type: "session.updated", data: changed });
    }
    this.refreshStatus();
  }

  heartbeat(): void {
    this.broadcast({ type: "heartbeat", timestamp: new Date().toISOString() });
  }
}
