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
 * Claude usage comes from the same OAuth usage endpoint Claude Code's /usage
 * panel uses, authenticated with the token Claude Code already keeps in the
 * macOS Keychain. The token is read at call time, never persisted, never
 * logged, and never leaves this machine — only percentages go to the iPad.
 */
export async function collectClaudeUsage(): Promise<ProviderUsage | undefined> {
  let token: string | undefined;
  try {
    const { execFileSync } = await import("node:child_process");
    const raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    token = (JSON.parse(raw) as { claudeAiOauth?: { accessToken?: string } }).claudeAiOauth?.accessToken;
  } catch {
    return undefined; // no keychain entry / access denied: no meter, no noise
  }
  if (!token) return undefined;
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
      headers: { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20", "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as Record<string, { utilization?: number; resets_at?: string | null } | null>;
    const windows: UsageWindow[] = [];
    for (const [key, label] of [["five_hour", "5h"], ["seven_day", "week"], ["seven_day_opus", "opus wk"]] as const) {
      const w = body[key];
      if (w && typeof w.utilization === "number") {
        windows.push({
          label,
          usedPercent: Math.round(w.utilization * 10) / 10,
          resetsAt: w.resets_at ?? undefined,
        });
      }
    }
    if (windows.length === 0) return undefined;
    return { provider: "claude", windows, collectedAt: new Date().toISOString(), source: "claude-oauth" };
  } catch {
    return undefined; // offline or endpoint changed: show nothing rather than stale fakes
  }
}

/** All providers, best-effort each; a failing provider simply has no entry. */
export async function collectUsage(): Promise<ProviderUsage[]> {
  const usage: ProviderUsage[] = [];
  const [codex, claude] = await Promise.all([
    Promise.resolve(collectCodexUsage()),
    collectClaudeUsage(),
  ]);
  if (claude) usage.push(claude);
  if (codex) usage.push(codex);
  return usage;
}
