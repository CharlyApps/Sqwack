import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.SQWACK_DATA_DIR = mkdtempSync(join(tmpdir(), "sqwack-test-"));

const { openMemoryStore } = await import("../src/persistence/db.ts");
const { Engine } = await import("../src/core.ts");
const { startServer } = await import("../src/api/server.ts");
const { adminToken } = await import("../src/auth/auth.ts");
const { initLog } = await import("../src/log.ts");
type ConfigT = import("../src/config.ts").Config;

initLog("error", false);
const PORT = 47999;
const BASE = `http://127.0.0.1:${PORT}`;

const config: ConfigT = {
  machineId: "test-machine",
  machineName: "test",
  network: { port: PORT, bind: "127.0.0.1", tailscaleServe: false },
  logLevel: "error",
  logEventBodies: false,
  retentionDays: { events: 14, sessions: 30 },
  processFilters: { excludeCommands: [] },
};

let api: ReturnType<typeof startServer>;
let admin: string;
const engine = new Engine(openMemoryStore(), config);

before(async () => {
  admin = adminToken();
  api = startServer(engine);
  await new Promise((r) => api.server.once("listening", r));
});

after(() => {
  api.close();
  rmSync(process.env.SQWACK_DATA_DIR!, { recursive: true, force: true });
});

const authed = (token: string): Record<string, string> => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
});

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: crypto.randomUUID(),
    schemaVersion: 1,
    machineId: "test-machine",
    timestamp: new Date().toISOString(),
    source: { provider: "codex", integration: "test", surface: "cli" },
    type: "agent.started",
    sessionId: "s-api",
    project: { name: "Proj" },
    ...overrides,
  };
}

test("health is public, everything else requires auth", async () => {
  assert.equal((await fetch(`${BASE}/v1/health`)).status, 200);
  assert.equal((await fetch(`${BASE}/v1/snapshot`)).status, 401);
  assert.equal((await fetch(`${BASE}/v1/sessions`)).status, 401);
  const bad = await fetch(`${BASE}/v1/snapshot`, { headers: authed("wrong-token") });
  assert.equal(bad.status, 401);
});

test("pairing flow: start -> complete -> device token works, code is single-use", async () => {
  const start = await fetch(`${BASE}/v1/pair/start`, { method: "POST", headers: authed(admin) });
  assert.equal(start.status, 200);
  const { code } = (await start.json()) as { code: string };

  const wrong = await fetch(`${BASE}/v1/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code: "WRONGCOD", deviceName: "iPad" }),
  });
  assert.equal(wrong.status, 401);

  const ok = await fetch(`${BASE}/v1/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName: "Test iPad" }),
  });
  assert.equal(ok.status, 200);
  const { token } = (await ok.json()) as { token: string };

  const reuse = await fetch(`${BASE}/v1/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, deviceName: "iPad2" }),
  });
  assert.equal(reuse.status, 401);

  const snap = await fetch(`${BASE}/v1/snapshot`, { headers: authed(token) });
  assert.equal(snap.status, 200);
});

test("event ingestion creates a session; duplicates are flagged", async () => {
  const event = makeEvent();
  const res = await fetch(`${BASE}/v1/events`, { method: "POST", headers: authed(admin), body: JSON.stringify(event) });
  assert.equal(res.status, 202);
  const dup = await fetch(`${BASE}/v1/events`, { method: "POST", headers: authed(admin), body: JSON.stringify(event) });
  assert.equal((await dup.json() as { duplicate: boolean }).duplicate, true);

  const sessions = (await (await fetch(`${BASE}/v1/sessions?provider=codex`, { headers: authed(admin) })).json()) as { sessions: { id: string; state: string }[] };
  const s = sessions.sessions.find((x) => x.id === "codex:s-api");
  assert.ok(s);
  assert.equal(s.state, "working");
});

test("malformed events are rejected with 400", async () => {
  const res = await fetch(`${BASE}/v1/events`, {
    method: "POST", headers: authed(admin), body: JSON.stringify({ nope: true }),
  });
  assert.equal(res.status, 400);
});

test("websocket: snapshot on connect, then live event broadcast", async () => {
  const { WebSocket: WS } = await import("ws");
  const ws = new WS(`ws://127.0.0.1:${PORT}/v1/ws?token=${admin}`);
  const messages: { type: string }[] = [];
  const gotEvent = new Promise<void>((resolve) => {
    ws.on("message", (data: Buffer) => {
      const msg = JSON.parse(data.toString());
      messages.push(msg);
      if (msg.type === "event") resolve();
    });
  });
  await new Promise((r) => ws.on("open", r));
  await fetch(`${BASE}/v1/events`, {
    method: "POST", headers: authed(admin),
    body: JSON.stringify(makeEvent({ sessionId: "s-ws", type: "agent.needs_input" })),
  });
  await gotEvent;
  ws.close();
  assert.equal(messages[0].type, "snapshot");
  assert.ok(messages.some((m) => m.type === "event"));
  assert.ok(messages.some((m) => m.type === "session.updated"));
});

test("websocket rejects bad token", async () => {
  const { WebSocket: WS } = await import("ws");
  const ws = new WS(`ws://127.0.0.1:${PORT}/v1/ws?token=nope`);
  const failed = await new Promise<boolean>((resolve) => {
    ws.on("error", () => resolve(true));
    ws.on("open", () => resolve(false));
  });
  assert.equal(failed, true);
});

test("claude hook normalization end-to-end", async () => {
  const res = await fetch(`${BASE}/v1/hooks/claude`, {
    method: "POST", headers: authed(admin),
    body: JSON.stringify({ hook_event_name: "Notification", session_id: "c1", cwd: "/tmp/proj", message: "Claude needs your permission" }),
  });
  assert.equal(res.status, 202);
  const session = (await (await fetch(`${BASE}/v1/sessions/${encodeURIComponent("claude:c1")}`, { headers: authed(admin) })).json()) as { state: string; summary: string };
  assert.equal(session.state, "needs_input");
  assert.equal(session.summary, "Claude needs your permission");
});

test("codex notify normalization end-to-end", async () => {
  const res = await fetch(`${BASE}/v1/hooks/codex`, {
    method: "POST", headers: authed(admin),
    body: JSON.stringify({ type: "agent-turn-complete", "turn-id": "t1", "last-assistant-message": "Done refactoring" }),
  });
  assert.equal(res.status, 202);
  const session = (await (await fetch(`${BASE}/v1/sessions/${encodeURIComponent("codex:t1")}`, { headers: authed(admin) })).json()) as { state: string };
  assert.equal(session.state, "done");
});

test("kill validates process id", async () => {
  const res = await fetch(`${BASE}/v1/processes/999999-zz/kill`, { method: "POST", headers: authed(admin) });
  assert.equal(res.status, 404);
});

test("session ack clears attention", async () => {
  await fetch(`${BASE}/v1/events`, {
    method: "POST", headers: authed(admin),
    body: JSON.stringify(makeEvent({ sessionId: "s-fail", type: "agent.failed" })),
  });
  const ack = await fetch(`${BASE}/v1/sessions/${encodeURIComponent("codex:s-fail")}/ack`, { method: "POST", headers: authed(admin) });
  assert.equal(ack.status, 200);
  const session = (await ack.json()) as { metadata: { acknowledgedAt?: string } };
  assert.ok(session.metadata.acknowledgedAt);
});
