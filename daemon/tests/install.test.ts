import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "sqwack-install-"));
process.env.SQWACK_DATA_DIR = join(dir, "data");
process.env.SQWACK_CLAUDE_SETTINGS = join(dir, "claude", "settings.json");
process.env.SQWACK_CODEX_CONFIG = join(dir, "codex", "config.toml");
process.env.SQWACK_CODEX_HOOKS = join(dir, "codex", "hooks.json");
mkdirSync(join(dir, "claude"), { recursive: true });
mkdirSync(join(dir, "codex"), { recursive: true });

const { installClaude, installCodex } = await import("../src/adapters/install.ts");

after(() => rmSync(dir, { recursive: true, force: true }));

test("claude installer preserves unrelated settings and existing hooks, and is idempotent", () => {
  writeFileSync(
    process.env.SQWACK_CLAUDE_SETTINGS!,
    JSON.stringify({
      model: "opus",
      permissions: { defaultMode: "auto" },
      hooks: { Stop: [{ hooks: [{ type: "command", command: "/my/own/hook.sh" }] }] },
    }),
  );
  installClaude();
  const settings = JSON.parse(readFileSync(process.env.SQWACK_CLAUDE_SETTINGS!, "utf8"));
  assert.equal(settings.model, "opus"); // untouched
  assert.equal(settings.permissions.defaultMode, "auto"); // untouched
  const stopHooks = JSON.stringify(settings.hooks.Stop);
  assert.ok(stopHooks.includes("/my/own/hook.sh"), "existing hook preserved");
  assert.ok(stopHooks.includes("sqwack-claude-hook"), "sqwack hook added");
  assert.ok(JSON.stringify(settings.hooks.Notification).includes("sqwack-claude-hook"));

  const before = readFileSync(process.env.SQWACK_CLAUDE_SETTINGS!, "utf8");
  const second = installClaude();
  assert.equal(readFileSync(process.env.SQWACK_CLAUDE_SETTINGS!, "utf8"), before, "second install is a no-op");
  assert.ok(second.notes[0].includes("nothing changed"));
});

test("codex installer chains an existing notify instead of overwriting", () => {
  writeFileSync(
    process.env.SQWACK_CODEX_CONFIG!,
    `model = "gpt-5"\nnotify = ["/opt/original-notifier", "turn-ended"]\n\n[plugins."x"]\nenabled = true\n`,
  );
  installCodex();
  const config = readFileSync(process.env.SQWACK_CODEX_CONFIG!, "utf8");
  assert.ok(config.includes('model = "gpt-5"'), "unrelated config untouched");
  assert.ok(config.includes("sqwack-codex-notify-chain"), "notify now points at chain wrapper");
  assert.ok(!config.split("\n").some((l) => l.trim().startsWith("notify") && l.includes("/opt/original-notifier")), "old notify line replaced");
  const chain = readFileSync(join(dir, "data", "bin", "sqwack-codex-notify-chain"), "utf8");
  assert.ok(chain.includes('"/opt/original-notifier" "turn-ended"'), "original notifier still invoked");
  assert.ok(chain.includes("sqwack-codex-notify"), "sqwack forwarder invoked");

  const before = readFileSync(process.env.SQWACK_CODEX_CONFIG!, "utf8");
  installCodex();
  assert.equal(readFileSync(process.env.SQWACK_CODEX_CONFIG!, "utf8"), before, "second install is a no-op");
});

test("codex installer merges lifecycle hooks into existing hooks.json without clobbering", () => {
  writeFileSync(
    process.env.SQWACK_CODEX_HOOKS!,
    JSON.stringify({ hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/my/guard.py" }] }] } }),
  );
  installCodex();
  const root = JSON.parse(readFileSync(process.env.SQWACK_CODEX_HOOKS!, "utf8"));
  assert.ok(JSON.stringify(root.hooks.PreToolUse).includes("/my/guard.py"), "existing hook preserved");
  for (const event of ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"]) {
    assert.ok(JSON.stringify(root.hooks[event]).includes("sqwack-codex-hook"), `${event} hook added`);
  }
  const before = readFileSync(process.env.SQWACK_CODEX_HOOKS!, "utf8");
  installCodex();
  assert.equal(readFileSync(process.env.SQWACK_CODEX_HOOKS!, "utf8"), before, "second install is a no-op");
});

test("codex installer prepends notify before TOML tables when none exists", () => {
  writeFileSync(process.env.SQWACK_CODEX_CONFIG!, `[plugins."x"]\nenabled = true\n`);
  installCodex();
  const config = readFileSync(process.env.SQWACK_CODEX_CONFIG!, "utf8");
  const notifyIndex = config.indexOf("notify = ");
  const tableIndex = config.indexOf("[plugins");
  assert.ok(notifyIndex >= 0 && notifyIndex < tableIndex, "notify is a top-level key before any table");
});
