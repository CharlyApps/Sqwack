#!/usr/bin/env node
import { execFileSync, execFile } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, networkInterfaces } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, VERSION, loadConfig } from "./config.ts";
import { initLog, log, LOG_PATH } from "./log.ts";
import { openStore } from "./persistence/db.ts";
import { Engine } from "./core.ts";
import { startServer } from "./api/server.ts";
import { adminToken } from "./auth/auth.ts";
import { runDemo } from "./demo.ts";
import { installClaude, installCodex, integrationsStatus } from "./adapters/install.ts";

const [, , command = "help", ...args] = process.argv;

function api(path: string, init?: RequestInit): Promise<Response> {
  const config = loadConfig();
  return fetch(`http://127.0.0.1:${config.network.port}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${adminToken()}`, "Content-Type": "application/json", ...init?.headers },
  });
}

function lanIP(): string | undefined {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family === "IPv4" && !a.internal) return a.address;
    }
  }
}

function tailscaleBin(): string | undefined {
  const appBin = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";
  if (existsSync(appBin)) return appBin;
  try {
    return execFileSync("which", ["tailscale"], { encoding: "utf8" }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function tailscaleInfo(): { hostname?: string; ip?: string } {
  const bin = tailscaleBin();
  if (!bin) return {};
  try {
    const status = JSON.parse(execFileSync(bin, ["status", "--json"], { encoding: "utf8" }));
    return {
      hostname: status?.Self?.DNSName?.replace(/\.$/, ""),
      ip: status?.Self?.TailscaleIPs?.[0],
    };
  } catch {
    return {};
  }
}

async function cmdStart(): Promise<void> {
  const config = loadConfig();
  initLog(config.logLevel);
  adminToken(); // ensure it exists before adapters need it
  const store = openStore(DATA_DIR);
  store.prune(config.retentionDays.events, config.retentionDays.sessions);
  const engine = new Engine(store, config);
  const api = startServer(engine);
  log.info(`machine ${config.machineName} (${config.machineId})`);
  if (config.network.tailscaleServe) {
    // Expose the API inside the tailnet only (never Funnel). The daemon can
    // stay bound to 127.0.0.1; tailscale serve proxies tailnet traffic to it.
    const bin = tailscaleBin();
    if (!bin) {
      log.warn("network.tailscaleServe is on but Tailscale is not installed");
    } else {
      try {
        execFileSync(bin, ["serve", "--bg", `--tcp=${config.network.port}`, `tcp://127.0.0.1:${config.network.port}`], { stdio: "ignore" });
        log.info(`tailscale serve enabled on tailnet port ${config.network.port}`);
      } catch (err) {
        log.warn(`tailscale serve failed: ${String(err)}`);
      }
    }
  }
  const shutdown = () => {
    log.info("shutting down");
    api.close();
    store.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const PLIST_PATH = join(homedir(), "Library", "LaunchAgents", "com.sqwack.sqwackd.plist");

function cmdSetup(): void {
  const entry = resolve(dirname(fileURLToPath(import.meta.url)), "index.ts");
  mkdirSync(dirname(PLIST_PATH), { recursive: true });
  writeFileSync(
    PLIST_PATH,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.sqwack.sqwackd</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${entry}</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${join(DATA_DIR, "logs", "launchd.log")}</string>
  <key>StandardErrorPath</key><string>${join(DATA_DIR, "logs", "launchd.log")}</string>
</dict>
</plist>
`,
  );
  mkdirSync(join(DATA_DIR, "logs"), { recursive: true });
  const uid = process.getuid?.();
  const label = `gui/${uid}/com.sqwack.sqwackd`;
  const sleep = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  const loaded = () => {
    try { execFileSync("launchctl", ["print", label], { stdio: "ignore" }); return true; } catch { return false; }
  };
  // Unload any previous instance and wait until launchd has actually let go —
  // bootstrapping while the old instance is still unloading fails with EIO.
  if (loaded()) {
    try { execFileSync("launchctl", ["bootout", label], { stdio: "ignore" }); } catch { /* already going down */ }
    for (let i = 0; i < 20 && loaded(); i++) sleep(250);
  }
  let lastError = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      execFileSync("launchctl", ["bootstrap", `gui/${uid}`, PLIST_PATH], { stdio: "pipe" });
      lastError = "";
      break;
    } catch (err) {
      lastError = String((err as { stderr?: Buffer }).stderr ?? err).trim();
      sleep(1000);
    }
  }
  if (lastError) {
    console.error(`Could not load the LaunchAgent: ${lastError}`);
    console.error(`Plist written to ${PLIST_PATH}. Try:`);
    console.error(`  launchctl bootout ${label}   # then wait a moment`);
    console.error(`  launchctl bootstrap gui/${uid} ${PLIST_PATH}`);
    process.exit(1);
  }
  console.log(`Installed LaunchAgent: ${PLIST_PATH}`);
  console.log("sqwackd is now running and will start at login.");
  console.log("Uninstall with: sqwackd uninstall");
}

function cmdUninstall(): void {
  const uid = process.getuid?.();
  try { execFileSync("launchctl", ["bootout", `gui/${uid}/com.sqwack.sqwackd`], { stdio: "ignore" }); } catch { /* not loaded */ }
  if (existsSync(PLIST_PATH)) execFileSync("rm", [PLIST_PATH]);
  console.log("LaunchAgent removed. Data kept in ~/.sqwack (delete manually if desired).");
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig();
  const pad = (label: string, value: string) => console.log(label.padEnd(23) + value);
  let health: { version: string } | undefined;
  try {
    const r = await api("/v1/health");
    health = r.ok ? ((await r.json()) as { version: string }) : undefined;
  } catch { /* daemon down */ }
  pad("Sqwack daemon", health ? "running" : "not running");
  pad("Machine", config.machineName);
  pad("Machine ID", config.machineId);
  pad("Local API", health ? `ready on http://${config.network.bind}:${config.network.port}` : "unreachable");
  const ts = tailscaleInfo();
  pad("Tailscale", ts.hostname ? `reachable (${ts.hostname})` : tailscaleBin() ? "installed, not connected" : "not installed");
  for (const i of integrationsStatus().slice(0, 2)) {
    pad(`${i.integration}`, i.installed ? `${i.confidence} / active` : "not installed");
  }
  if (health) {
    const snap = (await (await api("/v1/snapshot")).json()) as { status: string; sessions: { state: string }[]; processes: unknown[] };
    pad("Active agents", String(snap.sessions.filter((s: { state: string }) => s.state === "working" || s.state === "needs_input").length));
    pad("Development services", String(snap.processes.length));
    pad("Status", snap.status);
  }
}

async function cmdPair(): Promise<void> {
  const config = loadConfig();
  const res = await api("/v1/pair/start", { method: "POST" });
  if (!res.ok) {
    console.error("Could not start pairing — is sqwackd running? (sqwackd setup / sqwackd start)");
    process.exit(1);
  }
  const { code, expiresAt } = (await res.json()) as { code: string; expiresAt: string };
  const ts = tailscaleInfo();
  console.log("\n  Pairing code:  " + code + "\n");
  console.log("  Enter this code in the Sqwack iPad app within 5 minutes.");
  console.log(`  Expires: ${expiresAt}\n`);
  console.log("  Connect the iPad to one of:");
  if (lanIP()) console.log(`    LAN:       http://${lanIP()}:${config.network.port}`);
  if (ts.ip) console.log(`    Tailscale: http://${ts.ip}:${config.network.port}  (${ts.hostname})`);
  if (config.network.bind === "127.0.0.1") {
    console.log("\n  NOTE: daemon is bound to 127.0.0.1 — set network.bind to \"0.0.0.0\" in");
    console.log(`  ${join(DATA_DIR, "config.json")} (or enable Tailscale Serve) for the iPad to reach it, then restart.`);
  }
}

async function cmdDoctor(): Promise<void> {
  const config = loadConfig();
  const check = (name: string, ok: boolean, detail: string) =>
    console.log(`${ok ? "✓" : "✗"} ${name.padEnd(28)} ${detail}`);
  let alive = false;
  try { alive = (await api("/v1/health")).ok; } catch { /* down */ }
  check("daemon alive", alive, alive ? "responding" : "start with: sqwackd setup (or sqwackd start)");
  check("API port", true, `${config.network.bind}:${config.network.port}`);
  check("machine ID", !!config.machineId, config.machineId);
  const dbPath = join(DATA_DIR, "sqwack.db");
  check("SQLite", existsSync(dbPath), dbPath);
  const integ = integrationsStatus();
  for (const i of integ.slice(0, 2)) {
    check(`${i.integration} integration`, i.installed, i.installed ? `${i.confidence}` : `install with: sqwackd integrations install ${i.integration.split("-")[0]}`);
  }
  const ts = tailscaleInfo();
  check("Tailscale", !!ts.ip, ts.ip ? `${ts.ip} (${ts.hostname})` : "not installed or not connected");
  if (alive) {
    let wsOk = false;
    try {
      const { WebSocket: WS } = await import("ws");
      wsOk = await new Promise<boolean>((resolveWs) => {
        const sock = new WS(`ws://127.0.0.1:${config.network.port}/v1/ws?token=${adminToken()}`);
        const timer = setTimeout(() => { sock.terminate(); resolveWs(false); }, 3000);
        sock.on("message", () => { clearTimeout(timer); sock.close(); resolveWs(true); });
        sock.on("error", () => { clearTimeout(timer); resolveWs(false); });
      });
    } catch { /* ws failed */ }
    check("WebSocket", wsOk, wsOk ? "snapshot received" : "no snapshot");
    try {
      const snap = (await (await api("/v1/snapshot")).json()) as { processes: unknown[] };
      check("process discovery", true, `${snap.processes.length} development processes visible`);
    } catch {
      check("process discovery", false, "snapshot failed");
    }
  }
}

function cmdLogs(): void {
  const follow = args.includes("-f") || args.includes("--follow");
  if (!existsSync(LOG_PATH())) {
    console.log("No logs yet.");
    return;
  }
  if (follow) {
    execFile("tail", ["-f", LOG_PATH()], { maxBuffer: Infinity }).stdout?.pipe(process.stdout);
  } else {
    console.log(readFileSync(LOG_PATH(), "utf8").split("\n").slice(-200).join("\n"));
  }
}

async function cmdDemo(): Promise<void> {
  const config = loadConfig();
  try { await api("/v1/health"); } catch {
    console.error("sqwackd is not running. Start it first: sqwackd start (or sqwackd setup)");
    process.exit(1);
  }
  console.log("Sending demo event cycle" + (args.includes("--loop") ? " (looping, Ctrl-C to stop)" : "") + "...");
  await runDemo(`http://127.0.0.1:${config.network.port}`, adminToken(), config.machineId, args.includes("--loop"));
}

async function cmdIntegrations(): Promise<void> {
  const [sub, name] = args;
  if (sub === "install" && (name === "claude" || name === "codex")) {
    const result = name === "claude" ? installClaude() : installCodex();
    console.log(`Changed files:\n  ${result.changed.join("\n  ")}`);
    for (const note of result.notes) console.log(note);
    return;
  }
  if (sub === "status" || sub === undefined) {
    for (const i of integrationsStatus()) {
      console.log(`${i.integration.padEnd(18)} ${(i.installed ? "installed" : "not installed").padEnd(15)} ${i.confidence.padEnd(12)} events: ${i.events.join(", ") || "none"}`);
    }
    return;
  }
  console.error("usage: sqwackd integrations [status | install claude | install codex]");
  process.exit(1);
}

async function cmdDevices(): Promise<void> {
  if (args[0] === "revoke" && args[1]) {
    const config = loadConfig();
    const store = openStore(DATA_DIR);
    store.revokeDevice(args[1]);
    store.close();
    console.log(`Revoked device ${args[1]}. Restart daemon connections take effect immediately; config: ${join(DATA_DIR, "config.json")}, port ${config.network.port}.`);
    return;
  }
  const res = await api("/v1/devices");
  const { devices } = (await res.json()) as { devices: { id: string; name: string; created_at: string; last_seen_at?: string; revoked: number }[] };
  if (!devices.length) return console.log("No paired devices. Run: sqwackd pair");
  for (const d of devices) {
    console.log(`${d.id}  ${d.name.padEnd(20)} paired ${d.created_at}  last seen ${d.last_seen_at ?? "never"}  ${d.revoked ? "REVOKED" : ""}`);
  }
}

const HELP = `sqwackd ${VERSION} — Sqwack local machine daemon

usage: sqwackd <command>

  start                       run the daemon in the foreground
  setup                       install + start as a LaunchAgent (auto-start at login)
  uninstall                   remove the LaunchAgent
  status                      one-glance daemon status
  pair                        generate a pairing code for the iPad app
  demo [--loop]               send a realistic simulated event cycle
  integrations status         show integration health
  integrations install claude install Claude Code hooks
  integrations install codex  install Codex notify hook
  devices [revoke <id>]       list or revoke paired devices
  doctor                      diagnose common problems
  logs [-f]                   show (or follow) daemon logs
`;

const commands: Record<string, () => void | Promise<void>> = {
  start: cmdStart,
  setup: cmdSetup,
  uninstall: cmdUninstall,
  status: cmdStatus,
  pair: cmdPair,
  doctor: cmdDoctor,
  logs: cmdLogs,
  demo: cmdDemo,
  integrations: cmdIntegrations,
  devices: cmdDevices,
  version: () => console.log(VERSION),
  help: () => console.log(HELP),
};

const run = commands[command];
if (!run) {
  console.error(`unknown command '${command}'\n\n${HELP}`);
  process.exit(1);
}
await run();
