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
const CODEX_HOOKS = () => process.env.SQWACK_CODEX_HOOKS ?? join(homedir(), ".codex", "hooks.json");
const CLAUDE_HOOKS = ["SessionStart", "UserPromptSubmit", "Notification", "Stop", "SessionEnd"];
const CODEX_HOOK_EVENTS = ["SessionStart", "UserPromptSubmit", "PermissionRequest", "Stop", "SessionEnd"];

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

/**
 * Codex lifecycle hooks (hooks.json): the richest channel — WORKING, NEEDS YOU
 * (PermissionRequest), DONE, IDLE. Merged additively into ~/.codex/hooks.json.
 * Codex requires the user to trust new command hooks once (run /hooks in Codex).
 */
function installCodexHooks(port: number): { changed: string[]; notes: string[] } {
  // The hook must never emit stdout: for PermissionRequest, empty output means
  // "no decision" so Codex's normal approval prompt continues untouched.
  const script = writeHookScript(
    "sqwack-codex-hook",
    `#!/bin/sh
# Installed by sqwackd. Forwards Codex lifecycle hook payloads (stdin JSON) to
# the local Sqwack daemon. Emits nothing so approval decisions are never affected.
curl -s -m 3 -X POST \\
  -H "Authorization: Bearer $(cat "${DATA_DIR}/admin-token")" \\
  -H "Content-Type: application/json" \\
  --data-binary @- "http://127.0.0.1:${port}/v1/hooks/codex" > /dev/null 2>&1
exit 0
`,
  );

  const hooksPath = CODEX_HOOKS();
  let root: Record<string, unknown> = {};
  const changed: string[] = [script];
  if (existsSync(hooksPath)) {
    try {
      root = JSON.parse(readFileSync(hooksPath, "utf8"));
    } catch {
      return { changed, notes: [`${hooksPath} exists but is not valid JSON — not touching it. Add a command hook for ${script} manually.`] };
    }
    copyFileSync(hooksPath, hooksPath + ".sqwack-backup");
  }
  const hooks = (root.hooks ??= {}) as Record<string, unknown[]>;
  let modified = false;
  for (const event of CODEX_HOOK_EVENTS) {
    const entries = (hooks[event] ??= []);
    if (!JSON.stringify(entries).includes("sqwack-codex-hook")) {
      entries.push({ hooks: [{ type: "command", command: script, timeout: 5 }] });
      modified = true;
    }
  }
  if (modified) {
    writeFileSync(hooksPath, JSON.stringify(root, null, 2) + "\n");
    changed.push(hooksPath);
    return {
      changed,
      notes: [
        `Added lifecycle hooks (${CODEX_HOOK_EVENTS.join(", ")}) to ${hooksPath}`,
        "ACTION NEEDED: Codex requires trusting new hooks once — run /hooks inside Codex and trust the sqwack entries.",
      ],
    };
  }
  return { changed, notes: ["Codex lifecycle hooks already installed — nothing changed"] };
}

/** Wrapper that makes non-interactive `codex exec` runs observable. */
function installCodexExecWrapper(port: number): string {
  return writeHookScript(
    "sqwack-codex-exec",
    `#!/usr/bin/env node
// Installed by sqwackd. Drop-in for 'codex exec': runs 'codex exec --json',
// passes the JSONL stream through untouched, and forwards each event to Sqwack
// (annotated with thread id + cwd so the whole run maps onto one session).
// Usage: sqwack-codex-exec [codex exec args...]
import { spawn, execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const codexBin = process.env.CODEX_BIN ?? (() => {
  try { return execSync("command -v codex", { encoding: "utf8", shell: "/bin/sh" }).trim(); } catch { return ""; }
})();
if (!codexBin) {
  console.error("sqwack-codex-exec: 'codex' not found on PATH (set CODEX_BIN)");
  process.exit(127);
}
const token = readFileSync("${DATA_DIR}/admin-token", "utf8").trim();
const child = spawn(codexBin, ["exec", "--json", ...process.argv.slice(2)], { stdio: ["inherit", "pipe", "inherit"] });
let threadId;
createInterface({ input: child.stdout }).on("line", (line) => {
  console.log(line); // pass-through, untouched
  try {
    const event = JSON.parse(line);
    if (typeof event.thread_id === "string") threadId = event.thread_id;
    fetch("http://127.0.0.1:${port}/v1/hooks/codex", {
      method: "POST",
      headers: { Authorization: \`Bearer \${token}\`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, _sqwack_thread_id: threadId, _sqwack_cwd: process.cwd() }),
      signal: AbortSignal.timeout(2000),
    }).catch(() => {}); // a dead daemon must never break the exec run
  } catch { /* non-JSON line: pass through only */ }
});
child.on("close", (code) => process.exit(code ?? 0));
`,
  );
}

export function installCodex(): { changed: string[]; notes: string[] } {
  const config = loadConfig();
  const port = config.network.port;
  const notify = installCodexNotify(port);
  const hooks = installCodexHooks(port);
  const execWrapper = installCodexExecWrapper(port);
  return {
    changed: [...new Set([...notify.changed, ...hooks.changed, execWrapper])],
    notes: [
      ...hooks.notes,
      ...notify.notes,
      `Non-interactive runs: use '${execWrapper}' in place of 'codex exec' to make them observable.`,
    ],
  };
}

/** Legacy notify channel — fallback that needs no hook trust. */
function installCodexNotify(port: number): { changed: string[]; notes: string[] } {
  const script = writeHookScript(
    "sqwack-codex-notify",
    `#!/bin/sh
# Installed by sqwackd. Forwards Codex notify payloads to the local Sqwack daemon.
# Codex passes the notification JSON as the final argument. Some notify
# chainers prepend their own arguments, so take the LAST argument.
for LAST in "\$@"; do :; done
PAYLOAD="\${LAST:-}"
[ -z "\$PAYLOAD" ] && PAYLOAD="{}"
# Invocation log (timestamp + size only, never content) for sqwackd doctor.
echo "\$(date -u +%Y-%m-%dT%H:%M:%SZ) invoked argc=\$# bytes=\${#PAYLOAD}" >> "${DATA_DIR}/logs/codex-notify.log" 2>/dev/null
curl -s -m 3 -X POST \\
  -H "Authorization: Bearer $(cat "${DATA_DIR}/admin-token")" \\
  -H "Content-Type: application/json" \\
  --data-binary "\$PAYLOAD" "http://127.0.0.1:${port}/v1/hooks/codex" > /dev/null 2>&1
exit 0
`,
  );

  const configPath = CODEX_CONFIG();
  mkdirSync(join(configPath, ".."), { recursive: true });
  const existing = existsSync(configPath) ? readFileSync(configPath, "utf8") : "";
  if (existing.includes("sqwack-codex-notify")) {
    return { changed: [script], notes: ["Codex notify already installed — nothing changed"] };
  }

  const notifyLine = existing.match(/^\s*notify\s*=\s*(\[.*\])\s*$/m);
  if (notifyLine) {
    // A notify program is already configured. Preserve it: install a chain
    // wrapper that forwards to Sqwack AND then execs the original notifier.
    let original: string[];
    try {
      original = JSON.parse(notifyLine[1]); // TOML string arrays parse as JSON
    } catch {
      return {
        changed: [script],
        notes: [
          `~/.codex/config.toml has a 'notify' entry this installer cannot parse — not touching it.`,
          `To forward Codex events to Sqwack yourself, chain in: ${script}`,
        ],
      };
    }
    const chain = writeHookScript(
      "sqwack-codex-notify-chain",
      `#!/bin/sh
# Installed by sqwackd. Forwards Codex notify payloads to Sqwack, then invokes
# the notifier that was previously configured so its behavior is preserved.
"${script}" "\$@"
exec ${original.map((a) => `"${a.replaceAll('"', '\\"')}"`).join(" ")} "\$@"
`,
    );
    copyFileSync(configPath, configPath + ".sqwack-backup");
    writeFileSync(configPath, existing.replace(notifyLine[0], `notify = ["${chain}"]`));
    return {
      changed: [script, chain, configPath],
      notes: [
        `Existing notify preserved: it now runs via ${chain}`,
        `Backup saved at ${configPath}.sqwack-backup`,
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
  const codexNotifyInstalled =
    existsSync(CODEX_CONFIG()) && readFileSync(CODEX_CONFIG(), "utf8").includes("sqwack-codex-notify");
  const codexHooksInstalled =
    existsSync(CODEX_HOOKS()) && readFileSync(CODEX_HOOKS(), "utf8").includes("sqwack-codex-hook");
  return [
    claudeCapability(claudeInstalled),
    codexCapability(codexNotifyInstalled, codexHooksInstalled),
    // The Claude *chat* desktop app has no supported event mechanism (see
    // docs/integrations.md). Claude Code and Codex hooks cover CLI, desktop
    // app, and IDE surfaces via their shared user-level configuration.
  ];
}
