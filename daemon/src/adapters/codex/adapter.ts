import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { IntegrationCapability, SqwackEvent } from "../../types.ts";

/**
 * Codex adapter. Three payload shapes arrive on /v1/hooks/codex, newest first:
 *
 * 1. Lifecycle hooks (hooks.json, `hook_event_name` field) — richest: gives
 *    WORKING / NEEDS YOU (PermissionRequest) / DONE / IDLE. `native` confidence.
 * 2. `codex exec --json` JSONL events (`type: thread.*|turn.*|item.*|error`)
 *    forwarded by the sqwack-codex-exec wrapper — makes non-interactive runs
 *    observable including turn.failed.
 * 3. Legacy `notify` payloads (`type: agent-turn-complete`) — fallback, kept
 *    because it needs no hook trust and works on every Codex surface.
 *
 * Shape detection lives in normalizeCodex; each shape keeps its own normalizer.
 */
export function normalizeCodex(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  if (typeof raw.hook_event_name === "string") return normalizeCodexHook(raw, machineId);
  const type = String(raw.type ?? "");
  if (/^(thread|turn|item)\./.test(type) || type === "error") return normalizeCodexExec(raw, machineId);
  return normalizeCodexNotify(raw, machineId);
}

function baseEvent(
  machineId: string,
  integration: string,
  mapped: { type: SqwackEvent["type"]; message?: string; severity?: SqwackEvent["severity"] },
  sessionId: string | undefined,
  cwd: string | undefined,
  metadata: Record<string, unknown>,
): SqwackEvent {
  return {
    id: randomUUID(),
    schemaVersion: 1,
    machineId,
    timestamp: new Date().toISOString(),
    source: { provider: "codex", integration, surface: "cli" },
    type: mapped.type,
    sessionId,
    project: cwd ? { name: basename(cwd), cwd } : undefined,
    message: mapped.message,
    severity: mapped.severity,
    metadata,
  };
}

/** Lifecycle hook payloads (stdin of a hooks.json command hook). */
export function normalizeCodexHook(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  const hookName = String(raw.hook_event_name);
  const mapping: Record<string, { type: SqwackEvent["type"]; message?: string; severity?: SqwackEvent["severity"] }> = {
    SessionStart: { type: "agent.started", message: "Session started" },
    UserPromptSubmit: { type: "agent.working", message: "Working on a prompt" },
    PreToolUse: { type: "agent.working" },
    PermissionRequest: { type: "agent.needs_input", severity: "warning" },
    Stop: { type: "agent.finished", message: "Finished a turn", severity: "success" },
    SessionEnd: { type: "agent.idle", message: "Session ended" },
  };
  const mapped = mapping[hookName];
  if (!mapped) return undefined;

  let message = mapped.message;
  if (hookName === "PermissionRequest") {
    const tool = typeof raw.tool_name === "string" ? raw.tool_name : undefined;
    message = tool ? `Waiting for approval: ${tool}` : "Waiting for approval";
  }
  return baseEvent(
    machineId,
    "codex-hooks",
    { ...mapped, message },
    typeof raw.session_id === "string" ? raw.session_id : undefined,
    typeof raw.cwd === "string" ? raw.cwd : undefined,
    { codexHook: hookName },
  );
}

/** `codex exec --json` JSONL events forwarded by the sqwack-codex-exec wrapper. */
export function normalizeCodexExec(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  const type = String(raw.type ?? "");
  const threadId = typeof raw.thread_id === "string" ? raw.thread_id : undefined;

  let mapped: { type: SqwackEvent["type"]; message?: string; severity?: SqwackEvent["severity"] } | undefined;
  if (type === "thread.started") mapped = { type: "agent.started", message: "Exec run started" };
  else if (type === "turn.started") mapped = { type: "agent.working" };
  else if (type === "turn.completed") mapped = { type: "agent.finished", message: "Turn completed", severity: "success" };
  else if (type === "turn.failed" || type === "error") {
    const msg = typeof raw.message === "string" ? raw.message
      : typeof (raw.error as Record<string, unknown> | undefined)?.message === "string" ? String((raw.error as Record<string, unknown>).message)
      : "Turn failed";
    mapped = { type: "agent.failed", message: msg.slice(0, 140), severity: "error" };
  } else if (type === "item.completed") {
    const item = raw.item as Record<string, unknown> | undefined;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      mapped = { type: "agent.working", message: item.text.slice(0, 140) };
    }
  }
  if (!mapped) return undefined; // item.started etc.: not interesting yet

  // exec events after thread.started omit thread_id; the wrapper passes it
  // along as _sqwack_thread_id so the whole run collapses onto one session.
  const sessionId = threadId ?? (typeof raw._sqwack_thread_id === "string" ? (raw._sqwack_thread_id as string) : undefined);
  const cwd = typeof raw.cwd === "string" ? raw.cwd : typeof raw._sqwack_cwd === "string" ? (raw._sqwack_cwd as string) : undefined;
  return baseEvent(machineId, "codex-exec", mapped, sessionId, cwd, { codexExecEvent: type });
}

/** Legacy notify payloads — fallback channel, no hook trust required. */
export function normalizeCodexNotify(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  const type = String(raw.type ?? "");
  const cwd = typeof raw.cwd === "string" ? raw.cwd : typeof raw["turn-cwd"] === "string" ? (raw["turn-cwd"] as string) : undefined;
  const sessionId =
    typeof raw["conversation-id"] === "string" ? (raw["conversation-id"] as string)
    : typeof raw["thread-id"] === "string" ? (raw["thread-id"] as string)
    : typeof raw["turn-id"] === "string" ? (raw["turn-id"] as string)
    : undefined;

  let mapped: { type: SqwackEvent["type"]; message?: string; severity?: SqwackEvent["severity"] } | undefined;
  if (type === "agent-turn-complete") {
    const last = raw["last-assistant-message"];
    mapped = {
      type: "agent.finished",
      // ponytail: first 140 chars of the last message is the summary; add smarter summarization if it reads badly.
      message: typeof last === "string" && last.length > 0 ? last.slice(0, 140) : "Turn completed",
      severity: "success",
    };
  } else if (type === "agent-turn-start" || type === "session-start") {
    mapped = { type: "agent.working", message: "Working" };
  } else if (type.includes("approval")) {
    mapped = { type: "agent.needs_input", message: "Waiting for approval", severity: "warning" };
  }
  if (!mapped) return undefined;
  return baseEvent(machineId, "codex-cli", mapped, sessionId, cwd, { codexNotifyType: type });
}

export function codexCapability(notifyInstalled: boolean, hooksInstalled: boolean): IntegrationCapability {
  return {
    integration: hooksInstalled ? "codex-hooks" : "codex-cli",
    installed: notifyInstalled || hooksInstalled,
    surfaces: ["cli", "desktop"],
    events: hooksInstalled
      ? ["agent.started", "agent.working", "agent.needs_input", "agent.finished", "agent.failed", "agent.idle"]
      : ["agent.finished", "agent.working", "agent.needs_input"],
    confidence: hooksInstalled ? "native" : "derived",
  };
}
