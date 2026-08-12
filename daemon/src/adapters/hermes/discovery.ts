import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { HermesCronJob, HermesGateway, HermesSnapshot } from "../../types.ts";

export const hermesHome = (): string => process.env.SQWACK_HERMES_HOME ?? join(homedir(), ".hermes");

function json(path: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

const string = (value: unknown): string | undefined => typeof value === "string" && value ? value : undefined;

function isProfile(path: string): boolean {
  return ["config.yaml", "state.db", "gateway.pid", "gateway_state.json", join("cron", "jobs.json")]
    .some((marker) => existsSync(join(path, marker)));
}

export function hermesProfiles(): { name: string; path: string }[] {
  const home = hermesHome();
  const profiles = isProfile(home) ? [{ name: "default", path: home }] : [];
  const named = join(home, "profiles");
  if (!existsSync(named)) return profiles;
  try {
    for (const entry of readdirSync(named, { withFileTypes: true })) {
      const path = join(named, entry.name);
      if (entry.isDirectory() && isProfile(path)) profiles.push({ name: entry.name, path });
    }
  } catch { /* an unreadable profiles directory means no named profiles */ }
  return profiles;
}

function gatewayIsRunning(pid: number | undefined): boolean {
  if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    // A stale PID file can point at a reused PID. Fail closed unless the live
    // command still looks like Hermes' gateway process.
    return /hermes|gateway/i.test(execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8" }));
  } catch {
    return false;
  }
}

function schedule(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Unscheduled";
  const raw = value as Record<string, unknown>;
  if (string(raw.display)) return raw.display as string;
  if (raw.kind === "interval" && typeof raw.minutes === "number") return `Every ${raw.minutes} min`;
  if (raw.kind === "cron" && string(raw.expr)) return raw.expr as string;
  if (raw.kind === "once" && string(raw.run_at)) return `Once · ${raw.run_at}`;
  return string(raw.kind) ?? "Unscheduled";
}

function errorKind(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  if (/rate|429|quota/i.test(value)) return "rate_limited";
  if (/auth|token|credential|401|403/i.test(value)) return "auth_failed";
  if (/timeout|timed out/i.test(value)) return "timeout";
  if (/network|connect|dns|socket|502|503|504/i.test(value)) return "network_error";
  if (/config|configured|invalid/i.test(value)) return "invalid_config";
  if (/interrupt|shutdown|signal/i.test(value)) return "interrupted";
  return "unknown";
}

function delivery(job: Record<string, unknown>): string | undefined {
  if (typeof job.deliver === "string") return job.deliver;
  const origin = job.origin;
  if (origin && typeof origin === "object" && !Array.isArray(origin)) {
    return string((origin as Record<string, unknown>).platform);
  }
  return undefined;
}

function cronJobs(profile: string, path: string): HermesCronJob[] {
  const root = json(join(path, "cron", "jobs.json"));
  const jobs = Array.isArray(root?.jobs) ? root.jobs : [];
  return jobs.flatMap((value): HermesCronJob[] => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const job = value as Record<string, unknown>;
    const jobId = string(job.id) ?? string(job.job_id);
    if (!jobId) return [];
    return [{
      id: `${profile}:${jobId}`,
      jobId,
      name: string(job.name) ?? jobId,
      enabled: job.enabled !== false,
      state: string(job.state),
      schedule: schedule(job.schedule),
      nextRunAt: string(job.next_run_at),
      lastRunAt: string(job.last_run_at),
      lastStatus: string(job.last_status),
      errorKind: errorKind(job.last_error) ?? errorKind(job.last_delivery_error),
      delivery: delivery(job),
    }];
  });
}

function gateway(profile: { name: string; path: string }): HermesGateway {
  const runtime = json(join(profile.path, "gateway_state.json")) ?? {};
  const pidFile = json(join(profile.path, "gateway.pid")) ?? {};
  const rawPid = runtime.pid ?? pidFile.pid;
  const pid = typeof rawPid === "number" ? rawPid : Number(rawPid);
  const running = gatewayIsRunning(pid);
  const rawPlatforms = runtime.platforms;
  const platforms = rawPlatforms && typeof rawPlatforms === "object" && !Array.isArray(rawPlatforms)
    ? Object.entries(rawPlatforms).map(([name, value]) => ({
        name,
        state: running && value && typeof value === "object" && !Array.isArray(value)
          ? string((value as Record<string, unknown>).state) ?? "unknown"
          : "stopped",
      }))
    : [];
  return {
    profile: profile.name,
    running,
    state: running ? string(runtime.gateway_state) ?? "running" : "stopped",
    activeAgents: running && typeof runtime.active_agents === "number" ? Math.max(0, runtime.active_agents) : 0,
    platforms,
    cronJobs: cronJobs(profile.name, profile.path),
  };
}

export function discoverHermes(): HermesSnapshot | undefined {
  const profiles = hermesProfiles();
  if (!profiles.length) return undefined;
  return { gateways: profiles.map(gateway), updatedAt: new Date().toISOString() };
}

export function hermesInstalled(): boolean {
  return hermesProfiles().some(({ path }) => existsSync(join(path, "hooks", "sqwack", "handler.py")));
}
