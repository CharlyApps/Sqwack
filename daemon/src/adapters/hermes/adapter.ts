import { randomUUID } from "node:crypto";
import type { IntegrationCapability, SqwackEvent } from "../../types.ts";

export function normalizeHermesHook(raw: Record<string, unknown>, machineId: string): SqwackEvent | undefined {
  const event = String(raw.event_type ?? "");
  const mapped: Record<string, { type: SqwackEvent["type"]; message: string; severity?: SqwackEvent["severity"] }> = {
    "agent:start": { type: "agent.started", message: "Gateway turn started" },
    "agent:step": { type: "agent.working", message: "Gateway agent working" },
    "agent:end": { type: "agent.finished", message: "Gateway turn finished", severity: "success" },
  };
  const lifecycle = mapped[event];
  if (!lifecycle) return undefined;

  const platform = typeof raw.platform === "string" ? raw.platform.slice(0, 40) : undefined;
  const profile = typeof raw.profile === "string" ? raw.profile.slice(0, 80) : "default";
  const sessionId = typeof raw.session_id === "string" ? raw.session_id.slice(0, 200) : undefined;
  const toolNames = Array.isArray(raw.tool_names)
    ? raw.tool_names.filter((value): value is string => typeof value === "string").slice(0, 20).map((value) => value.slice(0, 80))
    : [];
  const message = event === "agent:step" && toolNames.length
    ? `Using ${toolNames.join(", ")}`.slice(0, 140)
    : platform ? `${platform[0].toUpperCase()}${platform.slice(1)} · ${lifecycle.message}` : lifecycle.message;

  return {
    id: randomUUID(),
    schemaVersion: 1,
    machineId,
    timestamp: new Date().toISOString(),
    source: { provider: "hermes", integration: "hermes-gateway", surface: "cloud" },
    type: lifecycle.type,
    sessionId,
    project: { name: profile },
    title: platform ? `${platform} · ${profile}` : profile,
    message,
    severity: lifecycle.severity,
    metadata: {
      hermesEvent: event,
      profile,
      ...(platform ? { platform } : {}),
      ...(typeof raw.iteration === "number" ? { iteration: raw.iteration } : {}),
      ...(toolNames.length ? { toolNames } : {}),
      ...(typeof raw.model === "string" ? { model: raw.model.slice(0, 100) } : {}),
      ...(typeof raw.provider === "string" ? { modelProvider: raw.provider.slice(0, 60) } : {}),
    },
  };
}

export function hermesCapability(installed: boolean): IntegrationCapability {
  return {
    integration: "hermes-gateway",
    installed,
    surfaces: ["gateway", "slack"],
    events: ["agent.started", "agent.working", "agent.finished"],
    confidence: "native",
  };
}
