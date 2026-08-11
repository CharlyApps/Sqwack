import test from "node:test";
import assert from "node:assert/strict";
import { isClaudeCodeProcess, sessionFromClaudeProcess } from "../src/adapters/claude/processes.ts";

test("detects Claude Code workers without counting app wrappers", () => {
  assert.equal(isClaudeCodeProcess("/Users/me/.claude/local/claude --output-format stream-json"), true);
  assert.equal(isClaudeCodeProcess("/Applications/Claude.app/Contents/Helpers/disclaimer /Users/me/.claude/local/claude"), false);
  assert.equal(isClaudeCodeProcess("/Applications/Claude.app/Contents/Helpers/chrome-native-host chrome-extension://x"), false);
});

test("maps a Claude process to a working fallback session", () => {
  const started = new Date("2026-08-10T10:02:02Z");
  const session = sessionFromClaudeProcess("m1", {
    pid: 94395,
    started,
    command: "/Users/me/.claude/local/claude --output-format stream-json",
    cwd: "/Users/me/Repos/Sqwack",
  }, new Date("2026-08-11T03:20:00Z"));
  assert.equal(session.provider, "claude");
  assert.equal(session.state, "working");
  assert.equal(session.projectName, "Sqwack");
  assert.equal(session.source, "claude-process");
  assert.deepEqual(session.metadata, { inferredFromProcess: true, pid: 94395 });
});
