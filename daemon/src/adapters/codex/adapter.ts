import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import type { IntegrationCapability, SqwackEvent } from "../../types.ts";

/**
 * Normalizes Codex CLI `notify` payloads (JSON passed as the final argument to
 * the configured notify program, forwarded verbatim to /v1/hooks/codex).
 *
 * Codex notify currently emits `agent-turn-complete`; richer lifecycle state
 * (started/working/approval) is not available through this channel, so this
 * adapter reports `derived` confidence and only claims what it can see.
 */
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

  return {
    id: randomUUID(),
    schemaVersion: 1,
    machineId,
    timestamp: new Date().toISOString(),
    source: { provider: "codex", integration: "codex-cli", surface: "cli" },
    type: mapped.type,
    sessionId,
    project: cwd ? { name: basename(cwd), cwd } : undefined,
    message: mapped.message,
    severity: mapped.severity,
    metadata: { codexNotifyType: type },
  };
}

export function codexCapability(installed: boolean): IntegrationCapability {
  return {
    integration: "codex-cli",
    installed,
    surfaces: ["cli"],
    events: ["agent.finished", "agent.working", "agent.needs_input"],
    confidence: "derived",
  };
}
