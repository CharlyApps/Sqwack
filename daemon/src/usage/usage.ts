import { readdirSync, statSync, openSync, readSync, closeSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface UsageWindow {
  label: string; // "5h" | "week"
  usedPercent: number;
  resetsAt?: string;
}

export interface ProviderUsage {
  provider: "codex" | "claude";
  planType?: string;
  windows: UsageWindow[];
  collectedAt: string;
  source: string;
}

const CODEX_SESSIONS = () => process.env.SQWACK_CODEX_SESSIONS ?? join(homedir(), ".codex", "sessions");

/** Newest file under sessions/YYYY/MM/DD/ without walking the whole tree. */
function latestCodexSession(root: string): string | undefined {
  let dir = root;
  try {
    for (let depth = 0; depth < 3; depth++) {
      const entries = readdirSync(dir).filter((e) => !e.startsWith(".")).sort().reverse();
      if (entries.length === 0) return undefined;
      dir = join(dir, entries[0]);
    }
    const files = readdirSync(dir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime);
    return files[0]?.path;
  } catch {
    return undefined;
  }
}

function tailOf(path: string, bytes = 262_144): string {
  const size = statSync(path).size;
  const fd = openSync(path, "r");
  try {
    const length = Math.min(bytes, size);
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, size - length);
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function windowLabel(minutes: number): string {
  if (minutes >= 10080) return "week";
  if (minutes >= 60) return `${Math.round(minutes / 60)}h`;
  return `${minutes}m`;
}

/**
 * Codex writes account rate-limit snapshots into its session rollout files
 * (the same local data its own UI uses). Best-effort: absent file or shape
 * change simply yields no usage — never fake numbers.
 */
export function collectCodexUsage(root = CODEX_SESSIONS()): ProviderUsage | undefined {
  const file = latestCodexSession(root);
  if (!file) return undefined;
  const tail = tailOf(file);
  const index = tail.lastIndexOf('"rate_limits"');
  if (index === -1) return undefined;
  // Parse the enclosing JSON line so we get the full nested object.
  const lineStart = tail.lastIndexOf("\n", index) + 1;
  const lineEnd = tail.indexOf("\n", index);
  let parsed: unknown;
  try {
    parsed = JSON.parse(tail.slice(lineStart, lineEnd === -1 ? undefined : lineEnd));
  } catch {
    return undefined;
  }
  const rateLimits = findKey(parsed, "rate_limits") as Record<string, unknown> | undefined;
  if (!rateLimits) return undefined;

  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary"]) {
    const w = rateLimits[key] as Record<string, unknown> | null | undefined;
    if (!w || typeof w.used_percent !== "number") continue;
    windows.push({
      label: typeof w.window_minutes === "number" ? windowLabel(w.window_minutes) : key,
      usedPercent: Math.round(w.used_percent * 10) / 10,
      resetsAt: typeof w.resets_at === "number" ? new Date(w.resets_at * 1000).toISOString() : undefined,
    });
  }
  if (windows.length === 0) return undefined;
  return {
    provider: "codex",
    planType: typeof rateLimits.plan_type === "string" ? rateLimits.plan_type : undefined,
    windows,
    collectedAt: new Date().toISOString(),
    source: "codex-sessions",
  };
}

function findKey(obj: unknown, key: string): unknown {
  if (typeof obj !== "object" || obj === null) return undefined;
  const record = obj as Record<string, unknown>;
  if (key in record && record[key] !== null) return record[key];
  for (const value of Object.values(record)) {
    const found = findKey(value, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * All providers. Claude Code does not expose account rate limits in any local
 * file (verified against transcripts), so Claude has no usage entry rather
 * than a fabricated one — an adapter slot exists for when it does.
 */
export function collectUsage(): ProviderUsage[] {
  const usage: ProviderUsage[] = [];
  const codex = collectCodexUsage();
  if (codex) usage.push(codex);
  return usage;
}
