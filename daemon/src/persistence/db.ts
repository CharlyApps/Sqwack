import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import type { AgentSession, SqwackEvent } from "../types.ts";

// Repository layer over SQLite. Callers never touch SQL outside this module.
export class Store {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        session_id TEXT,
        timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL,
        received_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_ts ON events(timestamp);
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        machine_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL,
        last_seen_at TEXT,
        revoked INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
  }

  // --- events ---
  insertEvent(event: SqwackEvent): boolean {
    try {
      this.db
        .prepare(
          "INSERT INTO events (id, machine_id, session_id, timestamp, type, payload, received_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          event.id,
          event.machineId,
          event.sessionId ?? null,
          event.timestamp,
          event.type,
          JSON.stringify(event),
          new Date().toISOString(),
        );
      return true;
    } catch (err: unknown) {
      if (String(err).includes("UNIQUE")) return false; // duplicate event id
      throw err;
    }
  }

  recentEvents(limit = 100): SqwackEvent[] {
    return this.db
      .prepare("SELECT payload FROM events ORDER BY timestamp DESC LIMIT ?")
      .all(limit)
      .map((r) => JSON.parse(r.payload as string));
  }

  // --- sessions ---
  getSession(id: string): AgentSession | undefined {
    const row = this.db.prepare("SELECT payload FROM sessions WHERE id = ?").get(id);
    return row ? JSON.parse(row.payload as string) : undefined;
  }

  upsertSession(session: AgentSession): void {
    this.db
      .prepare(
        `INSERT INTO sessions (id, machine_id, payload, updated_at, state) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at, state = excluded.state`,
      )
      .run(session.id, session.machineId, JSON.stringify(session), session.updatedAt, session.state);
  }

  allSessions(): AgentSession[] {
    return this.db
      .prepare("SELECT payload FROM sessions ORDER BY updated_at DESC")
      .all()
      .map((r) => JSON.parse(r.payload as string));
  }

  /** Event timestamps for one raw session id since a cutoff (sparkline bins). */
  sessionEventTimes(rawSessionId: string, sinceIso: string): number[] {
    return this.db
      .prepare("SELECT timestamp FROM events WHERE session_id = ? AND timestamp > ? ORDER BY timestamp")
      .all(rawSessionId, sinceIso)
      .map((r) => Date.parse(r.timestamp as string));
  }

  // --- devices (paired iPads) ---
  addDevice(id: string, name: string, tokenHash: string): void {
    this.db
      .prepare("INSERT INTO devices (id, name, token_hash, created_at) VALUES (?, ?, ?, ?)")
      .run(id, name, tokenHash, new Date().toISOString());
  }

  deviceByTokenHash(tokenHash: string): { id: string; name: string } | undefined {
    const row = this.db
      .prepare("SELECT id, name FROM devices WHERE token_hash = ? AND revoked = 0")
      .get(tokenHash);
    return row as { id: string; name: string } | undefined;
  }

  touchDevice(id: string): void {
    this.db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  listDevices(): { id: string; name: string; created_at: string; last_seen_at: string | null; revoked: number }[] {
    return this.db.prepare("SELECT id, name, created_at, last_seen_at, revoked FROM devices").all() as never;
  }

  revokeDevice(id: string): void {
    this.db.prepare("UPDATE devices SET revoked = 1 WHERE id = ?").run(id);
  }

  isDeviceActive(id: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM devices WHERE id = ? AND revoked = 0").get(id));
  }

  // --- settings ---
  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
    return row ? (row.value as string) : undefined;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  // --- retention ---
  prune(eventDays: number, sessionDays: number): void {
    const cutoff = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();
    this.db.prepare("DELETE FROM events WHERE timestamp < ?").run(cutoff(eventDays));
    this.db.prepare("DELETE FROM sessions WHERE updated_at < ?").run(cutoff(sessionDays));
  }

  vacuum(): void {
    this.db.exec("VACUUM");
  }

  close(): void {
    this.db.close();
  }
}

export function openStore(dataDir: string): Store {
  return new Store(join(dataDir, "sqwack.db"));
}

export function openMemoryStore(): Store {
  return new Store(":memory:");
}
