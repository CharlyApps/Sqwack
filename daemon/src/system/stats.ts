import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { totalmem, uptime, cpus } from "node:os";

const exec = promisify(execFile);

export interface SystemStats {
  cpuPercent: number;
  cpuUserPercent: number;
  cpuSystemPercent: number;
  ramUsedBytes: number;
  ramTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  uptimeSeconds: number;
  processCount: number;
  networkMbps: number;
  collectedAt: string;
}

export interface ProcessMetric {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
}

let lastNet: { bytes: number; at: number } | undefined;

async function cpuAndCounts(): Promise<{ user: number; system: number; count: number; metrics: Map<number, ProcessMetric> }> {
  // One ps call yields total process count, per-pid cpu/mem, and (summed and
  // normalized by core count) a good-enough total CPU figure.
  const { stdout } = await exec("ps", ["-Aceo", "pid=,pcpu=,rss=,comm=", "-r"]);
  const metrics = new Map<number, ProcessMetric>();
  let totalCpu = 0;
  let count = 0;
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    count++;
    const cpu = Number(m[2]);
    totalCpu += cpu;
    metrics.set(Number(m[1]), { pid: Number(m[1]), name: m[4].trim(), cpuPercent: cpu, memoryBytes: Number(m[3]) * 1024 });
  }
  const cores = cpus().length || 1;
  const normalized = Math.min(100, totalCpu / cores);
  // ponytail: user/system split approximated as 50/50 of total; use host_statistics if fidelity matters.
  return { user: normalized / 2, system: normalized / 2, count, metrics };
}

async function ramUsed(): Promise<number> {
  const { stdout } = await exec("vm_stat", []);
  const page = Number(stdout.match(/page size of (\d+)/)?.[1] ?? 16384);
  const get = (name: string) => Number(stdout.match(new RegExp(`${name}:\\s+(\\d+)`))?.[1] ?? 0);
  return (get("Pages active") + get("Pages wired down") + get("Pages occupied by compressor")) * page;
}

async function disk(): Promise<{ used: number; total: number }> {
  const { stdout } = await exec("df", ["-k", "/System/Volumes/Data"]);
  const fields = stdout.split("\n")[1]?.split(/\s+/) ?? [];
  return { total: Number(fields[1] ?? 0) * 1024, used: Number(fields[2] ?? 0) * 1024 };
}

async function networkMbps(): Promise<number> {
  const { stdout } = await exec("netstat", ["-ib"]);
  let bytes = 0;
  const seen = new Set<string>();
  for (const line of stdout.split("\n")) {
    const fields = line.split(/\s+/);
    if (fields.length < 10 || seen.has(fields[0]) || fields[0] === "Name" || fields[0].startsWith("lo")) continue;
    seen.add(fields[0]);
    const ibytes = Number(fields[6]);
    const obytes = Number(fields[9]);
    if (Number.isFinite(ibytes) && Number.isFinite(obytes)) bytes += ibytes + obytes;
  }
  const now = Date.now();
  const previous = lastNet;
  lastNet = { bytes, at: now };
  if (!previous || bytes < previous.bytes) return 0;
  const seconds = (now - previous.at) / 1000;
  return seconds > 0 ? Math.round(((bytes - previous.bytes) * 8) / seconds / 1e6 * 10) / 10 : 0;
}

export async function collectSystemStats(): Promise<{ stats: SystemStats; processMetrics: Map<number, ProcessMetric> }> {
  const [cpu, ram, disks, net] = await Promise.all([cpuAndCounts(), ramUsed(), disk(), networkMbps()]);
  return {
    stats: {
      cpuPercent: Math.round((cpu.user + cpu.system) * 10) / 10,
      cpuUserPercent: Math.round(cpu.user * 10) / 10,
      cpuSystemPercent: Math.round(cpu.system * 10) / 10,
      ramUsedBytes: ram,
      ramTotalBytes: totalmem(),
      diskUsedBytes: disks.used,
      diskTotalBytes: disks.total,
      uptimeSeconds: Math.round(uptime()),
      processCount: cpu.count,
      networkMbps: net,
      collectedAt: new Date().toISOString(),
    },
    processMetrics: cpu.metrics,
  };
}

/** Top N user-relevant processes by CPU. */
export function topProcesses(metrics: Map<number, ProcessMetric>, n = 5): ProcessMetric[] {
  return [...metrics.values()]
    .filter((p) => p.cpuPercent > 0 && !["kernel_task", "launchd", "WindowServer"].includes(p.name))
    .sort((a, b) => b.cpuPercent - a.cpuPercent)
    .slice(0, n);
}
