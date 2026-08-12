import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sqwack-hermes-"));
process.env.SQWACK_HERMES_HOME = join(dir, ".hermes");

const { discoverHermes } = await import("../src/adapters/hermes/discovery.ts");
const { normalizeHermesHook } = await import("../src/adapters/hermes/adapter.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

test("Hermes discovery groups cron jobs by profile and rejects stale gateway state", () => {
  const home = process.env.SQWACK_HERMES_HOME!;
  const writer = join(home, "profiles", "writer");
  mkdirSync(join(home, "cron"), { recursive: true });
  mkdirSync(join(writer, "cron"), { recursive: true });
  writeFileSync(join(home, "config.yaml"), "model: test\n");
  writeFileSync(join(home, "gateway_state.json"), JSON.stringify({
    pid: 999_999,
    gateway_state: "running",
    active_agents: 7,
    platforms: { slack: { state: "connected" } },
  }));
  writeFileSync(join(home, "cron", "jobs.json"), JSON.stringify({ jobs: [{
    id: "daily",
    name: "Daily report",
    enabled: true,
    prompt: "secret prompt",
    schedule: { kind: "interval", minutes: 60 },
    next_run_at: "2026-08-12T00:00:00Z",
    last_status: "error",
    last_error: "429 quota reached with secret details",
    deliver: "slack",
  }] }));
  writeFileSync(join(writer, "state.db"), "");
  writeFileSync(join(writer, "cron", "jobs.json"), JSON.stringify({ jobs: [{
    id: "cleanup", name: "Cleanup", enabled: false, schedule: { kind: "cron", expr: "0 2 * * *" },
  }] }));

  const snapshot = discoverHermes();
  assert.deepEqual(snapshot?.gateways.map((gateway) => gateway.profile), ["default", "writer"]);
  assert.equal(snapshot?.gateways[0].running, false, "a stale PID file never reports running");
  assert.equal(snapshot?.gateways[0].activeAgents, 0);
  assert.equal(snapshot?.gateways[0].platforms[0].state, "stopped");
  assert.equal(snapshot?.gateways[0].cronJobs[0].errorKind, "rate_limited");
  assert.equal(snapshot?.gateways[0].cronJobs[0].delivery, "slack");
  assert.ok(!JSON.stringify(snapshot).includes("secret"));
});

test("Hermes hook normalization whitelists lifecycle metadata", () => {
  const event = normalizeHermesHook({
    event_type: "agent:step",
    profile: "writer",
    platform: "slack",
    session_id: "session-1",
    iteration: 2,
    tool_names: ["search", "shell"],
    message: "private user text",
    response: "private response",
    tools: [{ name: "shell", arguments: "rm secret" }],
  }, "mac-1");
  assert.equal(event?.source.provider, "hermes");
  assert.equal(event?.type, "agent.working");
  assert.equal(event?.project?.name, "writer");
  assert.equal(event?.message, "Using search, shell");
  assert.ok(!JSON.stringify(event).includes("private"));
  assert.ok(!JSON.stringify(event).includes("arguments"));
});
