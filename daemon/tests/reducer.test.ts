import { test } from "node:test";
import assert from "node:assert/strict";
import { reduceEvent, computeStatus, attentionSessions, sessionKey, sweepStale, isProbeWorkspace } from "../src/sessions/reducer.ts";
import { validateEvent } from "../src/events/validate.ts";
import type { AgentSession, SqwackEvent } from "../src/types.ts";

let n = 0;
function ev(overrides: Partial<SqwackEvent> & { type: SqwackEvent["type"] }): SqwackEvent {
  return {
    id: `evt-${++n}`,
    schemaVersion: 1,
    machineId: "m1",
    timestamp: new Date(1_700_000_000_000 + n * 1000).toISOString(),
    source: { provider: "codex", integration: "codex-cli", surface: "cli" },
    sessionId: "s1",
    ...overrides,
  };
}

test("started -> working -> needs_input -> working -> done", () => {
  let s = reduceEvent(undefined, ev({ type: "agent.started", title: "Tabor API" }));
  assert.equal(s!.state, "working");
  assert.ok(s!.startedAt);
  s = reduceEvent(s!, ev({ type: "agent.needs_input", message: "Waiting for permission" }));
  assert.equal(s!.state, "needs_input");
  assert.ok(s!.waitingSince);
  s = reduceEvent(s!, ev({ type: "agent.working" }));
  assert.equal(s!.state, "working");
  assert.equal(s!.waitingSince, undefined);
  s = reduceEvent(s!, ev({ type: "agent.finished" }));
  assert.equal(s!.state, "done");
  assert.ok(s!.finishedAt);
});

test("stale event does not overwrite newer state", () => {
  const fresh = reduceEvent(undefined, ev({ type: "agent.needs_input" }));
  const stale = ev({ type: "agent.working", timestamp: new Date(1_600_000_000_000).toISOString() });
  assert.equal(reduceEvent(fresh!, stale), null);
  assert.equal(fresh!.state, "needs_input");
});

test("event replay (same timestamp) is idempotent on state", () => {
  const e = ev({ type: "agent.working" });
  const s1 = reduceEvent(undefined, e);
  const s2 = reduceEvent(s1!, e);
  assert.equal(s2!.state, "working");
  assert.equal(s2!.updatedAt, s1!.updatedAt);
});

test("missing sessionId collapses to per-provider/project session", () => {
  const a = ev({ type: "agent.working", sessionId: undefined, project: { cwd: "/x" } });
  const b = ev({ type: "agent.working", sessionId: undefined, project: { cwd: "/x" } });
  const c = ev({ type: "agent.working", sessionId: undefined, project: { cwd: "/y" } });
  assert.equal(sessionKey(a), sessionKey(b));
  assert.notEqual(sessionKey(a), sessionKey(c));
});

test("two simultaneous codex sessions stay separate", () => {
  const a = reduceEvent(undefined, ev({ type: "agent.started", sessionId: "A" }));
  const b = reduceEvent(undefined, ev({ type: "agent.started", sessionId: "B" }));
  assert.notEqual(a!.id, b!.id);
});

test("codex + claude on same project stay separate", () => {
  const a = sessionKey(ev({ type: "agent.working", sessionId: undefined, project: { cwd: "/p" } }));
  const b = sessionKey(ev({
    type: "agent.working", sessionId: undefined, project: { cwd: "/p" },
    source: { provider: "claude", integration: "claude-code", surface: "cli" },
  }));
  assert.notEqual(a, b);
});

test("failed -> working retry resets finishedAt", () => {
  let s = reduceEvent(undefined, ev({ type: "agent.failed" }));
  assert.equal(s!.state, "failed");
  s = reduceEvent(s!, ev({ type: "agent.started" }));
  assert.equal(s!.state, "working");
  assert.equal(s!.finishedAt, undefined);
});

test("non-agent events do not create sessions", () => {
  assert.equal(reduceEvent(undefined, ev({ type: "system.heartbeat" })), null);
  assert.equal(reduceEvent(undefined, ev({ type: "process.started" })), null);
});

test("status aggregation priority", () => {
  const mk = (state: AgentSession["state"], meta?: Record<string, unknown>): AgentSession => ({
    id: state + Math.random(), machineId: "m1", provider: "codex", state,
    updatedAt: new Date().toISOString(), source: "t", metadata: meta,
  });
  assert.equal(computeStatus([]), "quiet");
  assert.equal(computeStatus([mk("idle"), mk("done")]), "quiet");
  assert.equal(computeStatus([mk("working")]), "working");
  assert.equal(computeStatus([mk("working"), mk("failed")]), "failure");
  assert.equal(computeStatus([mk("failed"), mk("needs_input")]), "attention");
  // acknowledged failure no longer holds global failure state
  assert.equal(computeStatus([mk("failed", { acknowledgedAt: new Date().toISOString() }), mk("working")]), "working");
  const att = attentionSessions([mk("failed"), mk("needs_input"), mk("working")]);
  assert.equal(att.length, 2);
  assert.equal(att[0].state, "needs_input");
});

test("stale working sessions sweep to idle", () => {
  const old: AgentSession = {
    id: "s", machineId: "m1", provider: "codex", state: "working",
    updatedAt: new Date(Date.now() - 60 * 60_000).toISOString(), source: "t",
  };
  const changed = sweepStale([old], Date.now());
  assert.equal(changed.length, 1);
  assert.equal(changed[0].state, "idle");
  assert.equal(sweepStale([{ ...old, updatedAt: new Date().toISOString() }], Date.now()).length, 0);
});

test("event validation accepts canonical and rejects malformed", () => {
  const good = ev({ type: "agent.working" });
  assert.ok("event" in validateEvent(good));
  assert.ok("error" in validateEvent({}));
  assert.ok("error" in validateEvent({ ...good, schemaVersion: 2 }));
  assert.ok("error" in validateEvent({ ...good, type: "agent.exploded" }));
  assert.ok("error" in validateEvent({ ...good, timestamp: "not-a-date" }));
  assert.ok("error" in validateEvent({ ...good, source: { provider: "skynet", integration: "x" } }));
  assert.ok("error" in validateEvent({ ...good, severity: "catastrophic" }));
});

test("probe workspace paths are recognised, real projects are not", () => {
  assert.equal(isProbeWorkspace("/Users/me/Library/Application Support/CodexBar/ClaudeProbe"), true);
  assert.equal(isProbeWorkspace("/Users/me/Repos/Sqwack"), false);
  assert.equal(isProbeWorkspace(undefined), false);
});

test("probe events are dropped at ingest — no event, no session, no activity", async () => {
  const { openMemoryStore } = await import("../src/persistence/db.ts");
  const { Engine } = await import("../src/core.ts");
  const engine = new Engine(openMemoryStore(), {
    machineId: "m1",
    machineName: "test",
    network: { port: 0, bind: "127.0.0.1", tailscaleServe: false },
    logLevel: "error",
    logEventBodies: false,
    retentionDays: { events: 14, sessions: 30 },
    processFilters: { excludeCommands: [] },
  } as Parameters<typeof Engine.prototype.constructor>[1]);

  const probe = ev({
    type: "agent.started",
    sessionId: "probe-1",
    source: { provider: "claude", integration: "claude-code", surface: "cli" },
    project: { name: "ClaudeProbe", cwd: "/Users/me/Library/Application Support/CodexBar/ClaudeProbe" },
  });
  assert.equal(engine.ingest(probe), false);

  const real = ev({
    type: "agent.started",
    sessionId: "real-1",
    source: { provider: "claude", integration: "claude-code", surface: "cli" },
    project: { name: "Sqwack", cwd: "/Users/me/Repos/Sqwack" },
  });
  assert.equal(engine.ingest(real), true);

  const snap = engine.snapshot();
  assert.deepEqual(snap.sessions.map((s) => s.projectName), ["Sqwack"]);
  assert.equal(snap.activity.some((a) => a.message.includes("ClaudeProbe")), false);
});
