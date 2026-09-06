import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, delimiter, join } from "node:path";
import { promisify } from "node:util";
import type { DevProcess } from "../types.ts";

const exec = promisify(execFile);

// Allowlist approach: only processes that look like development tooling are
// surfaced. Everything else on the machine is none of Sqwack's business.
const CATEGORY: [RegExp, DevProcess["category"]][] = [
  [/^(node|bun|deno|npm|pnpm|yarn)$/, "node"],
  [/^java$/, "java"],
  [/^(python[\d.]*|uvicorn|gunicorn)$/, "python"],
  [/^(postgres|redis-server|mysqld|mongod|memcached|clickhouse)$/, "database"],
];
const DEV_HINTS = /vite|next|webpack|esbuild|jenkins|sonar|gradle|flutter|dart|rails|puma|php|dotnet|caddy|fastapi|flask|django|tsserver|storybook/i;

interface RawListener {
  pid: number;
  command: string;
  port: number;
}

async function listListeners(): Promise<RawListener[]> {
  const uid = process.getuid?.() ?? 0;
  let out: string;
  try {
    ({ stdout: out } = await exec("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-u", String(uid), "-Fpcn"]));
  } catch (err) {
    // lsof exits 1 when nothing matches
    out = (err as { stdout?: string }).stdout ?? "";
  }
  const listeners: RawListener[] = [];
  let pid = 0;
  let command = "";
  for (const line of out.split("\n")) {
    const tag = line[0];
    const value = line.slice(1);
    if (tag === "p") pid = Number(value);
    else if (tag === "c") command = value;
    else if (tag === "n") {
      const port = Number(value.slice(value.lastIndexOf(":") + 1));
      if (Number.isFinite(port) && port > 0) listeners.push({ pid, command, port });
    }
  }
  return listeners;
}

async function processDetails(pids: number[]): Promise<Map<number, { started: Date; fullCommand: string; cwd?: string }>> {
  const map = new Map<number, { started: Date; fullCommand: string; cwd?: string }>();
  if (pids.length === 0) return map;
  const list = pids.join(",");
  try {
    const { stdout } = await exec("ps", ["-o", "pid=,lstart=,command=", "-p", list]);
    for (const line of stdout.split("\n")) {
      const m = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+[\d ]\d\s[\d:]{8}\s\d{4})\s+(.*)$/);
      if (m) map.set(Number(m[1]), { started: new Date(m[2]), fullCommand: m[3] });
    }
  } catch { /* processes may have exited between listing and ps */ }
  try {
    const { stdout } = await exec("lsof", ["-a", "-p", list, "-d", "cwd", "-Fpn"]);
    let pid = 0;
    for (const line of stdout.split("\n")) {
      if (line[0] === "p") pid = Number(line.slice(1));
      else if (line[0] === "n") {
        const d = map.get(pid);
        if (d) d.cwd = line.slice(1);
      }
    }
  } catch { /* cwd is optional */ }
  return map;
}

export function categorize(command: string, fullCommand: string): DevProcess["category"] | undefined {
  const base = basename(command).toLowerCase();
  for (const [re, cat] of CATEGORY) if (re.test(base)) return cat;
  if (/\/bin\/(?:Debug|Release)\/net[\w.-]+\//i.test(fullCommand)) return "other";
  if (DEV_HINTS.test(base) || DEV_HINTS.test(fullCommand)) return "other";
  return undefined; // not a development process
}

export function processId(pid: number, started: Date | undefined): string {
  return `${pid}-${(started ? Math.floor(started.getTime() / 1000) : 0).toString(36)}`;
}

export function parseDockerContainer(line: string, machineId: string): DevProcess | undefined {
  try {
    const row = JSON.parse(line) as Record<string, unknown>;
    if (typeof row.ID !== "string" || typeof row.Names !== "string") return undefined;
    const port = typeof row.Ports === "string"
      ? row.Ports.split(",").map((value) => value.match(/:(\d+)->\d+\/tcp/)?.[1]).find(Boolean)
      : undefined;
    return {
      id: `docker:${row.ID}`,
      machineId,
      pid: 0,
      name: row.Names,
      command: typeof row.Image === "string" ? row.Image : undefined,
      port: port ? Number(port) : undefined,
      protocol: "tcp",
      category: "container",
      containerRuntime: "docker",
      killable: false,
    };
  } catch {
    return undefined;
  }
}

async function discoverContainers(machineId: string): Promise<DevProcess[]> {
  const candidates = [
    process.env.DOCKER_CLI_PATH,
    "/opt/homebrew/bin/docker",
    "/usr/local/bin/docker",
    "/Applications/Docker.app/Contents/Resources/bin/docker",
    ...(process.env.PATH ?? "").split(delimiter).map((dir) => join(dir, "docker")),
  ];
  const docker = candidates.find((candidate): candidate is string => !!candidate && existsSync(candidate));
  if (!docker) return [];
  try {
    // The CLI honors Docker contexts and DOCKER_HOST, including Colima's socket.
    const { stdout } = await exec(docker, ["ps", "--format", "{{json .}}"], { timeout: 3_000 });
    return stdout.split("\n").map((line) => parseDockerContainer(line, machineId)).filter((item): item is DevProcess => !!item);
  } catch {
    return []; // Docker/Colima is optional or stopped.
  }
}

export async function discoverProcesses(machineId: string, excludeCommands: string[] = []): Promise<DevProcess[]> {
  const listeners = await listListeners();
  const byPid = new Map<number, RawListener[]>();
  for (const l of listeners) {
    if (!byPid.has(l.pid)) byPid.set(l.pid, []);
    byPid.get(l.pid)!.push(l);
  }
  const details = await processDetails([...byPid.keys()]);
  const result: DevProcess[] = [];
  for (const [pid, entries] of byPid) {
    const d = details.get(pid);
    const command = entries[0].command;
    const category = categorize(command, d?.fullCommand ?? "");
    if (!category) continue;
    if (excludeCommands.some((x) => command.includes(x) || d?.fullCommand.includes(x))) continue;
    const ports = [...new Set(entries.map((e) => e.port))].sort((a, b) => a - b);
    const cwdName = d?.cwd && d.cwd !== process.env.HOME ? basename(d.cwd) : "";
    const name = pid === process.pid ? "sqwackd" : cwdName || command;
    result.push({
      id: processId(pid, d?.started),
      machineId,
      pid,
      name,
      command: d?.fullCommand?.slice(0, 200),
      cwd: d?.cwd,
      port: ports[0],
      protocol: "tcp",
      startedAt: d?.started?.toISOString(),
      category,
      killable: pid !== process.pid && command !== "sqwackd",
    });
  }
  result.push(...await discoverContainers(machineId));
  return result.sort((a, b) => (a.port ?? 0) - (b.port ?? 0));
}

/**
 * Safely terminate a previously-discovered process. Re-verifies that the PID
 * still belongs to the same process (start time embedded in the id) so a
 * recycled PID is never killed.
 */
export async function killProcess(proc: DevProcess): Promise<{ ok: true; outcome: "exited" | "terminating" } | { ok: false; error: string }> {
  if (!proc.killable) return { ok: false, error: "process is not killable" };
  const details = await processDetails([proc.pid]);
  const current = details.get(proc.pid);
  if (!current) return { ok: false, error: "process no longer exists" };
  if (processId(proc.pid, current.started) !== proc.id) {
    return { ok: false, error: "PID was recycled by another process; refusing to kill" };
  }
  try {
    process.kill(proc.pid, "SIGTERM");
  } catch (err) {
    return { ok: false, error: `kill failed: ${(err as Error).message}` };
  }
  // ponytail: graceful SIGTERM only; add SIGKILL escalation if real servers ignore TERM.
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 200));
    try {
      process.kill(proc.pid, 0);
    } catch {
      return { ok: true, outcome: "exited" };
    }
  }
  return { ok: true, outcome: "terminating" };
}
