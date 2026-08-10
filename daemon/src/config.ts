import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { homedir, hostname, platform, arch } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Machine } from "./types.ts";

export const VERSION = "0.1.0";
export const DATA_DIR = process.env.SQWACK_DATA_DIR ?? join(homedir(), ".sqwack");
const CONFIG_PATH = () => join(DATA_DIR, "config.json");

export interface Config {
  machineId: string;
  machineName: string;
  network: { port: number; bind: string; tailscaleServe: boolean };
  logLevel: "error" | "warn" | "info" | "debug";
  logEventBodies: boolean; // default false: don't log prompt/summary bodies
  retentionDays: { events: number; sessions: number };
  processFilters: { excludeCommands: string[] };
}

const DEFAULTS: Omit<Config, "machineId"> = {
  machineName: hostname().replace(/\.local$/, ""),
  network: { port: 4737, bind: "127.0.0.1", tailscaleServe: false },
  logLevel: "info",
  logEventBodies: false,
  retentionDays: { events: 14, sessions: 30 },
  processFilters: { excludeCommands: [] },
};

let cached: Config | undefined;

export function loadConfig(): Config {
  if (cached) return cached;
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  chmodSync(DATA_DIR, 0o700);
  let stored: Partial<Config> = {};
  if (existsSync(CONFIG_PATH())) {
    stored = JSON.parse(readFileSync(CONFIG_PATH(), "utf8"));
  }
  cached = {
    ...DEFAULTS,
    ...stored,
    machineId: stored.machineId ?? randomUUID(),
    network: { ...DEFAULTS.network, ...stored.network },
    retentionDays: { ...DEFAULTS.retentionDays, ...stored.retentionDays },
    processFilters: { ...DEFAULTS.processFilters, ...stored.processFilters },
  };
  saveConfig(cached);
  return cached;
}

export function saveConfig(config: Config): void {
  cached = config;
  writeFileSync(CONFIG_PATH(), JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function machineInfo(config: Config): Machine {
  return {
    id: config.machineId,
    name: config.machineName,
    hostname: hostname(),
    platform: platform(),
    architecture: arch(),
    daemonVersion: VERSION,
    status: "online",
    lastSeenAt: new Date().toISOString(),
    capabilities: ["events", "sessions", "processes", "process.kill"],
  };
}
