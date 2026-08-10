import type { AgentSession, DevProcess, ServerMessage, Snapshot, SqwackEvent, SqwackStatus } from "./types.ts";
import type { Store } from "./persistence/db.ts";
import type { Config } from "./config.ts";
import { machineInfo } from "./config.ts";
import { reduceEvent, sessionKey, computeStatus, attentionSessions, sweepStale } from "./sessions/reducer.ts";
import { discoverProcesses } from "./processes/discovery.ts";
import { log } from "./log.ts";

/** Central state machine: events in, session/status updates + broadcasts out. */
export class Engine {
  private listeners = new Set<(msg: ServerMessage) => void>();
  private lastStatus: SqwackStatus = "quiet";
  private processes: DevProcess[] = [];

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

  private refreshStatus(): void {
    const status = computeStatus(this.store.allSessions());
    if (status !== this.lastStatus) {
      this.lastStatus = status;
      this.broadcast({ type: "status.updated", data: status });
    }
  }

  async refreshProcesses(): Promise<DevProcess[]> {
    this.processes = await discoverProcesses(this.config.machineId, this.config.processFilters.excludeCommands);
    this.broadcast({ type: "processes.updated", data: this.processes });
    return this.processes;
  }

  cachedProcesses(): DevProcess[] {
    return this.processes;
  }

  snapshot(): Snapshot {
    const sessions = this.store.allSessions();
    return {
      machine: machineInfo(this.config),
      status: computeStatus(sessions),
      sessions: sessions.slice(0, 50),
      attention: attentionSessions(sessions),
      processes: this.processes,
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
