import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = mkdtempSync(join(tmpdir(), "sqwack-timesgate-cli-"));
after(() => rmSync(root, { recursive: true, force: true }));

test("timesgate off and toggle persist the output state", () => {
  const bin = join(root, "bin");
  mkdirSync(bin);
  const launchctl = join(bin, "launchctl");
  writeFileSync(launchctl, "#!/bin/sh\nexit 0\n");
  chmodSync(launchctl, 0o755);
  const arp = join(bin, "arp");
  writeFileSync(arp, "#!/bin/sh\necho '? (192.168.1.9) at 98:a3:16:d8:f2:74 on en0'\n");
  chmodSync(arp, 0o755);
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify({
    machineId: "test", machineName: "test",
    network: { port: 4737, bind: "127.0.0.1", tailscaleServe: false },
    timesGate: { host: "192.168.1.2", localToken: 123456 },
  }));
  const cli = fileURLToPath(new URL("../src/index.ts", import.meta.url));
  const run = (...action: string[]) => spawnSync(process.execPath, [cli, "timesgate", ...action], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SQWACK_DATA_DIR: root },
  });

  assert.equal(run("off").status, 0);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).timesGate.enabled, false);
  assert.equal(run("toggle").status, 0);
  assert.equal(JSON.parse(readFileSync(configPath, "utf8")).timesGate.enabled, true);
  assert.equal(run("find", "98:A3:16:D8:F2:74").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(configPath, "utf8")).timesGate, {
    host: "192.168.1.9", localToken: 123456, enabled: true, mac: "98:a3:16:d8:f2:74",
  });
});
