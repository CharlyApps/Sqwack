import type { SqwackEvent } from "../types.ts";

const PROVIDERS = new Set(["codex", "claude", "deepseek", "hermes", "system", "generic"]);
const SURFACES = new Set(["cli", "desktop", "ide", "cloud", "manual"]);
const TYPES = new Set([
  "agent.started", "agent.working", "agent.needs_input", "agent.finished",
  "agent.failed", "agent.idle",
  "process.started", "process.stopped", "process.failed",
  "system.heartbeat",
]);
const SEVERITIES = new Set(["info", "success", "warning", "error"]);

// ponytail: hand-rolled validation instead of a schema library — one small schema, one place.
export function validateEvent(raw: unknown): { event: SqwackEvent } | { error: string } {
  if (typeof raw !== "object" || raw === null) return { error: "event must be an object" };
  const e = raw as Record<string, unknown>;

  const str = (k: string) => typeof e[k] === "string" && (e[k] as string).length > 0;
  if (!str("id")) return { error: "id: required string" };
  if (e.schemaVersion !== 1) return { error: "schemaVersion: must be 1" };
  if (!str("machineId")) return { error: "machineId: required string" };
  if (!str("timestamp") || Number.isNaN(Date.parse(e.timestamp as string)))
    return { error: "timestamp: required ISO-8601 string" };
  if (typeof e.type !== "string" || !TYPES.has(e.type)) return { error: `type: unknown '${e.type}'` };

  const source = e.source as Record<string, unknown> | undefined;
  if (typeof source !== "object" || source === null) return { error: "source: required object" };
  if (typeof source.provider !== "string" || !PROVIDERS.has(source.provider))
    return { error: `source.provider: unknown '${source.provider}'` };
  if (typeof source.integration !== "string" || source.integration.length === 0)
    return { error: "source.integration: required string" };
  if (source.surface !== undefined && (typeof source.surface !== "string" || !SURFACES.has(source.surface)))
    return { error: `source.surface: unknown '${source.surface}'` };

  for (const k of ["sessionId", "title", "message"]) {
    if (e[k] !== undefined && typeof e[k] !== "string") return { error: `${k}: must be a string` };
  }
  if (e.severity !== undefined && (typeof e.severity !== "string" || !SEVERITIES.has(e.severity)))
    return { error: `severity: unknown '${e.severity}'` };
  if (e.project !== undefined) {
    if (typeof e.project !== "object" || e.project === null) return { error: "project: must be an object" };
    for (const k of ["id", "name", "cwd"]) {
      const v = (e.project as Record<string, unknown>)[k];
      if (v !== undefined && typeof v !== "string") return { error: `project.${k}: must be a string` };
    }
  }
  if (e.metadata !== undefined && (typeof e.metadata !== "object" || e.metadata === null))
    return { error: "metadata: must be an object" };

  return { event: raw as SqwackEvent };
}
