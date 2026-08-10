import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./config.ts";

const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 } as const;
export type LogLevel = keyof typeof LEVELS;

let current: LogLevel = "info";
let logFile: string | undefined;

export function initLog(level: LogLevel, toFile = true): void {
  current = level;
  if (toFile) {
    const dir = join(DATA_DIR, "logs");
    mkdirSync(dir, { recursive: true });
    logFile = join(dir, "sqwackd.log");
  }
}

export const LOG_PATH = () => join(DATA_DIR, "logs", "sqwackd.log");

function write(level: LogLevel, msg: string, extra?: unknown): void {
  if (LEVELS[level] > LEVELS[current]) return;
  const line = `${new Date().toISOString()} [${level}] ${msg}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`;
  (level === "error" ? console.error : console.log)(line);
  if (logFile) {
    try { appendFileSync(logFile, line + "\n"); } catch { /* logging must never crash the daemon */ }
  }
}

export const log = {
  error: (msg: string, extra?: unknown) => write("error", msg, extra),
  warn: (msg: string, extra?: unknown) => write("warn", msg, extra),
  info: (msg: string, extra?: unknown) => write("info", msg, extra),
  debug: (msg: string, extra?: unknown) => write("debug", msg, extra),
};
