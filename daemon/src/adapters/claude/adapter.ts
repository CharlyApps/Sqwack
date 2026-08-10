import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { IntegrationCapability, SqwackEvent } from "../../types.ts";

/**
 * Normalizes Claude Code lifecycle hook payloads (delivered on stdin to the
 * installed hook script, forwarded verbatim to /v1/hooks/claude).
 *
 * Claude's `Stop` means "finished a response/turn", NOT "the user's whole task
 * is done" — we surface it as agent.finished with turn-scoped wording and keep
 * the raw hook name in metadata so smarter semantics can be layered later.
 */
export function normalizeClaudeHook(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  const hookName = String(raw.hook_event_name ?? "");
  const cwd = typeof raw.cwd === "string" ? raw.cwd : undefined;
  const sessionId = typeof raw.session_id === "string" ? raw.session_id : undefined;

  const mapping: Record<string, { type: SqwackEvent["type"]; message?: string; severity?: SqwackEvent["severity"] }> = {
    SessionStart: { type: "agent.started", message: "Session started" },
    UserPromptSubmit: { type: "agent.working", message: "Working on a prompt" },
    PreCompact: { type: "agent.working" },
    Notification: { type: "agent.needs_input", severity: "warning" },
    Stop: { type: "agent.finished", message: "Finished a turn", severity: "success" },
    SessionEnd: { type: "agent.idle", message: "Session ended" },
  };
  const m = mapping[hookName];
  if (!m) return undefined; // unknown/uninteresting hook: ignore honestly

  // Notification hooks carry a human message ("Claude needs your permission…").
  let message = m.message;
  if (hookName === "Notification" && typeof raw.message === "string") message = raw.message;

  return {
    id: randomUUID(),
    schemaVersion: 1,
    machineId,
    timestamp: new Date().toISOString(),
    source: { provider: "claude", integration: "claude-code", surface: "cli" },
    type: m.type,
    sessionId,
    project: cwd ? { name: basename(cwd), cwd } : undefined,
    message,
    severity: m.severity,
    metadata: { claudeHook: hookName },
  };
}

export function claudeCapability(installed: boolean): IntegrationCapability {
  return {
    integration: "claude-code",
    installed,
    // settings.json hooks fire from every Claude Code surface (CLI, desktop app, IDE).
    surfaces: ["cli", "desktop", "ide"],
    events: ["agent.started", "agent.working", "agent.needs_input", "agent.finished", "agent.idle"],
    confidence: "native",
  };
}
