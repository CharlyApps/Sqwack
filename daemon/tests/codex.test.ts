import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeCodex } from "../src/adapters/codex/adapter.ts";

const M = "m1";

test("lifecycle hook shape: PermissionRequest -> needs_input with tool name", () => {
  const event = normalizeCodex(
    { hook_event_name: "PermissionRequest", session_id: "s1", cwd: "/p/api", tool_name: "Bash", tool_input: { command: "rm -rf" } },
    M,
  );
  assert.equal(event!.type, "agent.needs_input");
  assert.equal(event!.sessionId, "s1");
  assert.equal(event!.project?.name, "api");
  assert.equal(event!.message, "Waiting for approval: Bash");
  assert.equal(event!.source.integration, "codex-hooks");
});

test("lifecycle hook shape: full session flow maps to states", () => {
  const type = (raw: Record<string, unknown>) => normalizeCodex(raw, M)!.type;
  assert.equal(type({ hook_event_name: "SessionStart", session_id: "s" }), "agent.started");
  assert.equal(type({ hook_event_name: "UserPromptSubmit", session_id: "s" }), "agent.working");
  assert.equal(type({ hook_event_name: "Stop", session_id: "s" }), "agent.finished");
  assert.equal(type({ hook_event_name: "SessionEnd", session_id: "s" }), "agent.idle");
  assert.equal(normalizeCodex({ hook_event_name: "PreCompact" }, M), undefined);
});

test("exec --json shape: thread/turn lifecycle including failure", () => {
  const started = normalizeCodex({ type: "thread.started", thread_id: "t1" }, M);
  assert.equal(started!.type, "agent.started");
  assert.equal(started!.sessionId, "t1");

  const working = normalizeCodex({ type: "turn.started", _sqwack_thread_id: "t1", _sqwack_cwd: "/p/x" }, M);
  assert.equal(working!.type, "agent.working");
  assert.equal(working!.sessionId, "t1");
  assert.equal(working!.project?.name, "x");

  const message = normalizeCodex(
    { type: "item.completed", item: { type: "agent_message", text: "Refactored the auth module" }, _sqwack_thread_id: "t1" },
    M,
  );
  assert.equal(message!.type, "agent.working");
  assert.equal(message!.message, "Refactored the auth module");

  const failed = normalizeCodex({ type: "turn.failed", _sqwack_thread_id: "t1", error: { message: "sandbox denied" } }, M);
  assert.equal(failed!.type, "agent.failed");
  assert.equal(failed!.message, "sandbox denied");

  const done = normalizeCodex({ type: "turn.completed", usage: {}, _sqwack_thread_id: "t1" }, M);
  assert.equal(done!.type, "agent.finished");

  assert.equal(normalizeCodex({ type: "item.started", item: {} }, M), undefined);
});

test("notify shape still works as fallback", () => {
  const event = normalizeCodex(
    { type: "agent-turn-complete", "turn-id": "n1", "last-assistant-message": "All tests green" },
    M,
  );
  assert.equal(event!.type, "agent.finished");
  assert.equal(event!.message, "All tests green");
  assert.equal(event!.source.integration, "codex-cli");
});

test("unknown shapes are ignored, not faked", () => {
  assert.equal(normalizeCodex({ something: "else" }, M), undefined);
  assert.equal(normalizeCodex({ type: "mystery-event" }, M), undefined);
});
