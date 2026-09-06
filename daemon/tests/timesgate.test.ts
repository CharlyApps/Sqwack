import { test } from "node:test";
import assert from "node:assert/strict";
import { renderTimesGatePanels } from "../src/outputs/timesgate.ts";
import type { Snapshot } from "../src/types.ts";

test("builds the five Times Gate panels from one Sqwack snapshot", () => {
  const snapshot = {
    status: "attention",
    sessions: [{ state: "needs_input" }],
    usage: [
      { provider: "codex", windows: [{ label: "week", usedPercent: 12 }] },
      { provider: "claude", windows: [{ label: "5h", usedPercent: 25 }, { label: "week", usedPercent: 40 }] },
    ],
    system: { stats: { cpuPercent: 13, ramUsedBytes: 52, ramTotalBytes: 100, diskUsedBytes: 42, diskTotalBytes: 100, uptimeSeconds: 90_061 } },
  } as Snapshot;

  const panels = renderTimesGatePanels(snapshot);
  assert.deepEqual(panels.map((panel) => panel.screen), [0, 1, 2, 3, 4]);
  assert.match(panels[0].signature, /codex:undefined:88/);
  assert.match(panels[1].signature, /claude:75:60/);
  assert.equal(panels[2].signature, "status:attention:1");
  assert.equal(panels[3].signature, "system:15:50");
  assert.equal(panels[4].signature, "machine:40:25");
});
