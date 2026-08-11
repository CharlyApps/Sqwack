import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { basename } from "node:path";
import type { AgentSession } from "../../types.ts";

const exec = promisify(execFile);

interface ClaudeProcess {
  pid: number;
  started: Date;
  command: string;
  cwd?: string;
}

export function isClaudeCodeProcess(command: string): boolean {
  if (command.includes("/Contents/Helpers/disclaimer ")) return false;
  if (command.includes("chrome-native-host") || command.includes("claude-ios-sim")) return false;
  return /(?:^|\s)(?:\S*\/)?claude(?:\s|$)/.test(command);
}

function processId(pid: number, started: Date): string {
  return `claude:process-${pid}-${Math.floor(started.getTime() / 1000).toString(36)}`;
}

export function sessionFromClaudeProcess(machineId: string, proc: ClaudeProcess, now = new Date()): AgentSession {
  const projectName = proc.cwd && proc.cwd !== process.env.HOME ? basename(proc.cwd) : "Claude";
  return {
    id: processId(proc.pid, proc.started),
    machineId,
    provider: "claude",
    projectName,
    cwd: proc.cwd,
    title: "Claude Code",
    state: "working",
    summary: "Claude Code process running",
    startedAt: proc.started.toISOString(),
    updatedAt: now.toISOString(),
    source: "claude-process",
    metadata: { inferredFromProcess: true, pid: proc.pid },
  };
}

function parsePs(stdout: string): ClaudeProcess[] {
  const processes: ClaudeProcess[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\w{3}\s+\w{3}\s+[\d ]\d\s[\d:]{8}\s\d{4})\s+(.*)$/);
    if (!m || !isClaudeCodeProcess(m[3])) continue;
    processes.push({ pid: Number(m[1]), started: new Date(m[2]), command: m[3] });
  }
  return processes;
}

async function cwdByPid(pids: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (pids.length === 0) return map;
  try {
    const { stdout } = await exec("lsof", ["-a", "-p", pids.join(","), "-d", "cwd", "-Fpn"]);
    let pid = 0;
    for (const line of stdout.split("\n")) {
      if (line[0] === "p") pid = Number(line.slice(1));
      else if (line[0] === "n") map.set(pid, line.slice(1));
    }
  } catch { /* cwd is best-effort */ }
  return map;
}

export async function discoverClaudeProcessSessions(machineId: string): Promise<AgentSession[]> {
  let processes: ClaudeProcess[] = [];
  try {
    const { stdout } = await exec("ps", ["-axo", "pid=,lstart=,command="]);
    processes = parsePs(stdout);
  } catch {
    return [];
  }
  const cwd = await cwdByPid(processes.map((p) => p.pid));
  return processes.map((p) => sessionFromClaudeProcess(machineId, { ...p, cwd: cwd.get(p.pid) }));
}
