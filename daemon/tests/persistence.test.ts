import { test } from "node:test";
import assert from "node:assert/strict";
import { openMemoryStore } from "../src/persistence/db.ts";
import type { AgentSession, SqwackEvent } from "../src/types.ts";

const event: SqwackEvent = {
  id: "e1", schemaVersion: 1, machineId: "m1",
  timestamp: new Date().toISOString(),
  source: { provider: "claude", integration: "claude-code" },
  type: "agent.working", sessionId: "s1",
};

test("duplicate event ids are rejected exactly once", () => {
  const store = openMemoryStore();
  assert.equal(store.insertEvent(event), true);
  assert.equal(store.insertEvent(event), false);
  assert.equal(store.recentEvents().length, 1);
  store.close();
});

test("sessions survive restart (upsert + read back)", () => {
  const store = openMemoryStore();
  const session: AgentSession = {
    id: "claude:s1", machineId: "m1", provider: "claude", state: "needs_input",
    updatedAt: new Date().toISOString(), source: "claude-code", waitingSince: new Date().toISOString(),
  };
  store.upsertSession(session);
  store.upsertSession({ ...session, state: "working", waitingSince: undefined });
  const all = store.allSessions();
  assert.equal(all.length, 1);
  assert.equal(all[0].state, "working");
  assert.equal(all[0].waitingSince, undefined);
  store.close();
});

test("retention prunes old rows", () => {
  const store = openMemoryStore();
  store.insertEvent({ ...event, id: "old", timestamp: new Date(Date.now() - 20 * 86400_000).toISOString() });
  store.insertEvent({ ...event, id: "new" });
  store.prune(14, 30);
  const remaining = store.recentEvents();
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].id, "new");
  store.close();
});

test("device pairing tokens round-trip and revoke", () => {
  const store = openMemoryStore();
  store.addDevice("d1", "iPad", "hash1");
  assert.equal(store.deviceByTokenHash("hash1")!.id, "d1");
  assert.equal(store.deviceByTokenHash("nope"), undefined);
  store.revokeDevice("d1");
  assert.equal(store.deviceByTokenHash("hash1"), undefined);
  store.close();
});
