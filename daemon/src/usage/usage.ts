import { execFile } from "node:child_process";
import { readdirSync, statSync, openSync, readSync, closeSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export interface UsageWindow {
  label: string; // "5h" | "week"
  usedPercent: number;
  resetsAt?: string;
  detail?: string;
}

export interface ProviderUsage {
  provider: "codex" | "claude" | "deepseek";
  planType?: string;
  windows: UsageWindow[];
  collectedAt: string;
  source: string;
}

export type UsageProvider = ProviderUsage["provider"];

const CODEX_SESSIONS = () => process.env.SQWACK_CODEX_SESSIONS ?? join(homedir(), ".codex", "sessions");
const CODEXBAR_BIN = () => process.env.SQWACK_CODEXBAR_BIN;
const execFileAsync = promisify(execFile);

const CODEXBAR_CANDIDATES = [
  "/Applications/CodexBar.app/Contents/Helpers/CodexBarCLI",
  "/opt/homebrew/bin/codexbar",
  "/usr/local/bin/codexbar",
];
export const USAGE_PROVIDERS = ["codex", "claude", "deepseek"] as const satisfies readonly UsageProvider[];

/** Recent files under sessions/YYYY/MM/DD/, newest first, without walking old history. */
function recentCodexSessions(root: string, limit = 25): string[] {
  let days: string[] = [];
  try {
    for (const year of readdirSync(root).filter((e) => !e.startsWith(".")).sort().reverse().slice(0, 2)) {
      for (const month of readdirSync(join(root, year)).filter((e) => !e.startsWith(".")).sort().reverse()) {
        for (const day of readdirSync(join(root, year, month)).filter((e) => !e.startsWith(".")).sort().reverse()) {
          days.push(join(root, year, month, day));
        }
      }
    }
    return days
      .flatMap((dir) => readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs })))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((f) => f.path);
  } catch {
    return [];
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
  for (const file of recentCodexSessions(root)) {
    const usage = collectCodexUsageFromFile(file);
    if (usage) return usage;
  }
  return undefined;
}

export async function collectCodexBarUsage(provider: UsageProvider = "codex", bin = findCodexBarBin()): Promise<ProviderUsage | undefined> {
  if (!bin || process.env.SQWACK_CODEXBAR_DISABLE === "1") return undefined;
  let raw = "";
  try {
    const source = provider === "deepseek" ? "auto" : "cli";
    const result = await execFileAsync(bin, ["usage", "--provider", provider, "--source", source, "--format", "json"], {
      encoding: "utf8",
      timeout: 30_000,
    });
    raw = result.stdout;
  } catch {
    return undefined;
  }
  const rows = parseCodexBarJson(raw);
  const row = rows.find((item) => item?.provider === provider && item?.usage);
  if (!row) return undefined;

  const usage = row.usage as Record<string, unknown>;
  const windows: UsageWindow[] = [];
  for (const key of ["primary", "secondary", "tertiary"]) {
    const window = usage[key] as Record<string, unknown> | null | undefined;
    if (!window || typeof window.usedPercent !== "number") continue;
    windows.push({
      label: typeof window.windowMinutes === "number" ? windowLabel(window.windowMinutes) : key,
      usedPercent: window.usedPercent,
      resetsAt: typeof window.resetsAt === "string" ? window.resetsAt : undefined,
      detail: typeof window.resetDescription === "string" ? window.resetDescription : undefined,
    });
  }
  if (windows.length === 0) return undefined;
  return {
    provider,
    planType: typeof usage.loginMethod === "string" ? usage.loginMethod : undefined,
    windows,
    collectedAt: typeof usage.updatedAt === "string" ? usage.updatedAt : new Date().toISOString(),
    source: typeof row.source === "string" ? row.source : `codexbar-${provider}`,
  };
}

function findCodexBarBin(): string | undefined {
  const configured = CODEXBAR_BIN();
  if (configured) return existsSync(configured) ? configured : undefined;
  return CODEXBAR_CANDIDATES.find((path) => existsSync(path));
}

function parseCodexBarJson(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
  } catch {
    const start = raw.indexOf("[");
    const end = raw.lastIndexOf("]");
    if (start === -1 || end <= start) return [];
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      return Array.isArray(parsed) ? parsed as Array<Record<string, unknown>> : [];
    } catch {
      return [];
    }
  }
}

function collectCodexUsageFromFile(file: string): ProviderUsage | undefined {
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

/** All providers, best-effort each; a failing provider simply has no entry. */
export async function collectUsage(provider?: UsageProvider): Promise<ProviderUsage[]> {
  // Claude Code owns its OAuth token lifecycle; sqwackd must not read Keychain
  // or refresh Claude tokens itself. CodexBar CLI-source usage is the safe bridge.
  if (provider) {
    const usage = await collectCodexBarUsage(provider) ?? (provider === "codex" ? collectCodexUsage() : undefined);
    return usage ? [usage] : [];
  }
  const [codex, claude, deepseek] = await Promise.all(USAGE_PROVIDERS.map((p) => collectCodexBarUsage(p)));
  const usage = [
    codex ?? collectCodexUsage(),
    claude,
    deepseek,
  ].filter((item): item is ProviderUsage => Boolean(item));
  return usage;
}
