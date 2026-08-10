import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DATA_DIR, loadConfig } from "../config.ts";
import { claudeCapability } from "./claude/adapter.ts";
import { codexCapability } from "./codex/adapter.ts";
import type { IntegrationCapability } from "../types.ts";

const BIN_DIR = () => join(DATA_DIR, "bin");
const CLAUDE_SETTINGS = () => process.env.SQWACK_CLAUDE_SETTINGS ?? join(homedir(), ".claude", "settings.json");
const CODEX_CONFIG = () => process.env.SQWACK_CODEX_CONFIG ?? join(homedir(), ".codex", "config.toml");
const CLAUDE_HOOKS = ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "SessionEnd"];

function writeHookScript(name: string, body: string): string {
  mkdirSync(BIN_DIR(), { recursive: true, mode: 0o700 });
  const path = join(BIN_DIR(), name);
  writeFileSync(path, body, { mode: 0o700 });
  chmodSync(path, 0o700);
  return path;
}

export function installClaude(): { changed: string[]; notes: string[] } {
  const config = loadConfig();
  const port = config.network.port;
  // Hook scripts always exit 0 so a dead daemon can never block Claude.
  const script = writeHookScript(
    "sqwack-claude-hook",
    `#!/bin/sh
# Installed by sqwackd. Forwards Claude Code hook payloads to the local Sqwack daemon.
curl -s -m 3 -X POST \\
  -H "Authorization: Bearer $(cat "${DATA_DIR}/admin-token")" \\
  -H "Content-Type: application/json" \\
  --data-binary @- "http://127.0.0.1:${port}/v1/hooks/claude" > /dev/null 2>&1
exit 0
`,
  );

  const settingsPath = CLAUDE_SETTINGS();
  mkdirSync(join(settingsPath, ".."), { recursive: true });
  let settings: Record<string, unknown> = {};
  const changed: string[] = [script];
  if (existsSync(settingsPath)) {
    settings = JSON.parse(readFileSync(settingsPath, "utf8"));
    copyFileSync(settingsPath, settingsPath + ".sqwack-backup");
  }
  // Only touch the hooks key; never rewrite unrelated Claude configuration.
  const hooks = (settings.hooks ??= {}) as Record<string, unknown[]>;
  let modified = false;
  for (const event of CLAUDE_HOOKS) {
    const entries = (hooks[event] ??= []);
    const hasOurs = JSON.stringify(entries).includes("sqwack-claude-hook");
    if (!hasOurs) {
      entries.push({ hooks: [{ type: "command", command: script, timeout: 5 }] });
      modified = true;
    }
  }
  if (modified) {
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
    changed.push(settingsPath);
  }
  return {
    changed,
    notes: modified
      ? [`Added sqwack hooks for: ${CLAUDE_HOOKS.join(", ")}`, `Backup saved at ${settingsPath}.sqwack-backup`]
      : ["Claude hooks already installed — nothing changed"],
  };
}

export function installCodex(): { changed: string[]; notes: string[] } {
  const config = loadConfig();
  const port = config.network.port;
  const script = writeHookScript(
    "sqwack-codex-notify",
    `#!/bin/sh
# Installed by sqwackd. Forwards Codex notify payloads to the local Sqwack daemon.
# Codex passes the notification JSON as the final argument.
curl -s -m 3 -X POST \\
  -H "Authorization: Bearer $(cat "${DATA_DIR}/admin-token")" \\
  -H "Content-Type: application/json" \\
  --data-binary "\${1:-{}}" "http://127.0.0.1:${port}/v1/hooks/codex" > /dev/null 2>&1
exit 0
`,
  );

  const configPath = CODEX_CONFIG();
  mkdirSync(join(configPath, ".."), { recursive: true });
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (existing.includes("sqwack-codex-notify")) {
    return { changed: [script], notes: ["Codex notify already installed — nothing changed"] };
  }
  if (/^\s*notify\s*=/m.test(existing)) {
    return {
      changed: [script],
      notes: [
        `~/.codex/config.toml already defines 'notify' — not overwriting it.`,
        `To forward Codex events to Sqwack, point it at: ${script}`,
      ],
    };
  }
  if (existing) copyFileSync(configPath, configPath + ".sqwack-backup");
  // TOML top-level keys must appear before any [table] header, so prepend.
  writeFileSync(configPath, `notify = ["${script}"]\n${existing}`);
  return {
    changed: [script, configPath],
    notes: [`Set notify in ${configPath}`, existing ? `Backup saved at ${configPath}.sqwack-backup` : "Created new config.toml"],
  };
}

export function integrationsStatus(): IntegrationCapability[] {
  const claudeInstalled =
    existsSync(CLAUDE_SETTINGS()) && readFileSync(CLAUDE_SETTINGS(), "utf8").includes("sqwack-claude-hook");
  const codexInstalled =
    existsSync(CODEX_CONFIG()) && readFileSync(CODEX_CONFIG(), "utf8").includes("sqwack-codex-notify");
  return [
    claudeCapability(claudeInstalled),
    codexCapability(codexInstalled),
    // Desktop surfaces have no supported native event mechanism today: reported
    // honestly as unsupported rather than faked (see docs/integrations.md).
    { integration: "claude-desktop", installed: false, surfaces: ["desktop"], events: [], confidence: "best_effort" },
    { integration: "codex-desktop", installed: false, surfaces: ["desktop"], events: [], confidence: "best_effort" },
  ];
}
