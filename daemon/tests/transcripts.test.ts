import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = mkdtempSync(join(tmpdir(), "sqwack-transcripts-"));
process.env.SQWACK_CLAUDE_PROJECTS = join(root, "claude");
process.env.SQWACK_CODEX_SESSIONS = join(root, "codex");

const { readTranscript } = await import("../src/transcripts/transcripts.ts");

after(() => rmSync(root, { recursive: true, force: true }));

test("reads modern Claude transcript messages", () => {
  const dir = join(process.env.SQWACK_CLAUDE_PROJECTS!, "-tmp-proj");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "abc-123.jsonl"), [
    JSON.stringify({ type: "queue-operation", content: "ignore me" }),
    JSON.stringify({ type: "user", timestamp: "2026-08-10T00:00:00.000Z", message: { role: "user", content: "hello" } }),
    JSON.stringify({ type: "assistant", timestamp: "2026-08-10T00:00:01.000Z", message: { role: "assistant", content: [{ type: "thinking", text: "skip" }, { type: "text", text: "hi" }] } }),
  ].join("\n"));

  const transcript = readTranscript("claude:abc-123");
  assert.equal(transcript.available, true);
  assert.deepEqual(transcript.messages.map((m) => [m.role, m.text]), [["user", "hello"], ["assistant", "hi"]]);
});

test("reads Codex rollout messages", () => {
  const dir = join(process.env.SQWACK_CODEX_SESSIONS!, "2026", "08", "10");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rollout-2026-08-10T00-00-00-thread-1.jsonl"), [
    JSON.stringify({ type: "response_item", timestamp: "2026-08-10T00:00:00.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "do it" }] } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-10T00:00:01.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "done" }] } }),
  ].join("\n"));

  const transcript = readTranscript("codex:thread-1");
  assert.equal(transcript.available, true);
  assert.deepEqual(transcript.messages.map((m) => [m.role, m.text]), [["user", "do it"], ["assistant", "done"]]);
});

test("maps Codex notify turn id to nearby rollout for the same cwd", () => {
  const dir = join(process.env.SQWACK_CODEX_SESSIONS!, "2026", "08", "11");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "rollout-2026-08-11T00-00-00-real-thread.jsonl"), [
    JSON.stringify({ type: "session_meta", timestamp: "2026-08-11T00:00:00.000Z", payload: { cwd: "/tmp/proj" } }),
    JSON.stringify({ type: "response_item", timestamp: "2026-08-11T00:00:01.000Z", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "start" }] } }),
  ].join("\n"));

  const transcript = readTranscript("codex:turn-only", {
    id: "codex:turn-only",
    machineId: "m",
    provider: "codex",
    cwd: "/tmp/proj",
    state: "done",
    startedAt: "2026-08-11T00:00:03.000Z",
    updatedAt: "2026-08-11T00:00:03.000Z",
    source: "codex-cli",
  });
  assert.equal(transcript.available, true);
  assert.equal(transcript.messages[0].text, "start");
});
