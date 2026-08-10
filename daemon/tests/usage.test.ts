import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCodexUsage } from "../src/usage/usage.ts";

const root = mkdtempSync(join(tmpdir(), "sqwack-usage-"));
after(() => rmSync(root, { recursive: true, force: true }));

function writeSession(lines: string[]): string {
  const dir = join(root, "2026", "08", "10");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "rollout-test.jsonl");
  writeFileSync(path, lines.join("\n") + "\n");
  return root;
}

test("parses codex rate_limits from latest session rollout", () => {
  const sessions = writeSession([
    JSON.stringify({ type: "session_meta", payload: {} }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        rate_limits: {
          primary: { used_percent: 42.5, window_minutes: 300, resets_at: 1_786_828_408 },
          secondary: { used_percent: 12.0, window_minutes: 10080, resets_at: 1_786_900_000 },
          plan_type: "prolite",
        },
      },
    }),
  ]);
  const usage = collectCodexUsage(sessions)!;
  assert.equal(usage.provider, "codex");
  assert.equal(usage.planType, "prolite");
  assert.equal(usage.windows.length, 2);
  assert.deepEqual(usage.windows[0], {
    label: "5h",
    usedPercent: 42.5,
    resetsAt: new Date(1_786_828_408 * 1000).toISOString(),
  });
  assert.equal(usage.windows[1].label, "week");
});

test("missing or shapeless data yields undefined, never fake numbers", () => {
  assert.equal(collectCodexUsage(join(root, "nonexistent")), undefined);
  const sessions = writeSession([JSON.stringify({ type: "event_msg", payload: { type: "agent_message" } })]);
  assert.equal(collectCodexUsage(sessions), undefined);
});
