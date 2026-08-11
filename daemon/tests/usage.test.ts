import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectCodexBarUsage, collectCodexUsage, collectUsage } from "../src/usage/usage.ts";

const root = mkdtempSync(join(tmpdir(), "sqwack-usage-"));
after(() => rmSync(root, { recursive: true, force: true }));

function writeSession(lines: string[], name = "rollout-test.jsonl"): string {
  const dir = join(root, "2026", "08", "10");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
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

test("falls back to recent rollout with rate limits", () => {
  writeSession([JSON.stringify({
    type: "event_msg",
    payload: {
      rate_limits: {
        primary: { used_percent: 9, window_minutes: 300 },
      },
    },
  })], "rollout-old.jsonl");
  writeSession([JSON.stringify({ type: "event_msg", payload: { type: "agent_message" } })], "rollout-new.jsonl");
  const usage = collectCodexUsage(root)!;
  assert.equal(usage.windows[0].usedPercent, 9);
});

test("parses CodexBar CLI usage snapshot", async () => {
  const bin = join(root, "codexbar-fake");
  writeFileSync(bin, `#!/bin/sh
cat <<JSON
[
  {
    "provider": "$3",
    "source": "$3-cli",
    "usage": {
      "loginMethod": "prolite",
      "secondary": {
        "resetDescription": "\\$6.24 (Paid: \\$6.24 / Granted: \\$0.00)",
        "resetsAt": "2026-08-17T23:59:02Z",
        "usedPercent": 4,
        "windowMinutes": 10080
      },
      "updatedAt": "2026-08-11T03:23:03Z"
    }
  }
]
JSON
`);
  chmodSync(bin, 0o755);
  const usage = (await collectCodexBarUsage("claude", bin))!;
  assert.equal(usage.provider, "claude");
  assert.equal(usage.source, "claude-cli");
  assert.equal(usage.planType, "prolite");
  assert.deepEqual(usage.windows[0], {
    label: "week",
    usedPercent: 4,
    resetsAt: "2026-08-17T23:59:02Z",
    detail: "$6.24 (Paid: $6.24 / Granted: $0.00)",
  });
});

test("default usage refresh does not call Claude network endpoint", async () => {
  const originalFetch = globalThis.fetch;
  process.env.SQWACK_CODEXBAR_DISABLE = "1";
  globalThis.fetch = (() => { throw new Error("fetch should not run"); }) as typeof fetch;
  try {
    await collectUsage();
  } finally {
    delete process.env.SQWACK_CODEXBAR_DISABLE;
    globalThis.fetch = originalFetch;
  }
});

test("claude usage refresh does not touch oauth network", async () => {
  const originalFetch = globalThis.fetch;
  process.env.SQWACK_CODEXBAR_DISABLE = "1";
  globalThis.fetch = (() => { throw new Error("fetch should not run"); }) as typeof fetch;
  try {
    assert.deepEqual(await collectUsage("claude"), []);
  } finally {
    delete process.env.SQWACK_CODEXBAR_DISABLE;
    globalThis.fetch = originalFetch;
  }
});
