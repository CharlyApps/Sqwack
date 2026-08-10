import type { AgentSession, AgentState, SqwackEvent, SqwackStatus } from "../types.ts";

const EVENT_STATE: Partial<Record<SqwackEvent["type"], AgentState>> = {
  "agent.started": "working",
  "agent.working": "working",
  "agent.needs_input": "needs_input",
  "agent.finished": "done",
  "agent.failed": "failed",
  "agent.idle": "idle",
};

// Events without a sessionId (single-session CLI adapters) collapse onto a
// deterministic per-provider/per-project session.
export function sessionKey(event: SqwackEvent): string | undefined {
  if (!(event.type in EVENT_STATE)) return undefined;
  if (event.sessionId) return `${event.source.provider}:${event.sessionId}`;
  const scope = event.project?.cwd ?? event.project?.name ?? "default";
  return `${event.source.provider}:${event.source.integration}:${scope}`;
}

/**
 * Pure session reducer. Returns the updated session, or null when the event
 * does not affect sessions or is stale/out-of-order.
 */
export function reduceEvent(
  existing: AgentSession | undefined,
  event: SqwackEvent,
): AgentSession | null {
  const state = EVENT_STATE[event.type];
  const id = sessionKey(event);
  if (!state || !id) return null;

  const ts = Date.parse(event.timestamp);
  // Out-of-order guard: never let an older event overwrite newer state.
  if (existing && ts < Date.parse(existing.updatedAt)) return null;

  const session: AgentSession = {
    id,
    machineId: event.machineId,
    provider: event.source.provider === "system" ? "generic" : event.source.provider,
    projectId: event.project?.id ?? existing?.projectId,
    projectName: event.project?.name ?? existing?.projectName,
    cwd: event.project?.cwd ?? existing?.cwd,
    title: event.title ?? existing?.title,
    state,
    summary: event.message ?? (state === existing?.state ? existing?.summary : undefined),
    startedAt: existing?.startedAt ?? event.timestamp,
    updatedAt: event.timestamp,
    finishedAt: state === "done" || state === "failed" ? event.timestamp : undefined,
    waitingSince: state === "needs_input" ? (existing?.state === "needs_input" ? existing.waitingSince : event.timestamp) : undefined,
    source: event.source.integration,
    metadata: event.metadata ?? existing?.metadata,
  };
  // A brand-new burst of activity on a finished session is a reopen: reset start.
  if (existing && (existing.state === "done" || existing.state === "failed") && state === "working" && event.type === "agent.started") {
    session.startedAt = event.timestamp;
  }
  return session;
}

/** Aggregate machine/global status. Rule order comes from the spec. */
export function computeStatus(sessions: AgentSession[]): SqwackStatus {
  const active = sessions.filter((s) => !isAcknowledged(s));
  if (active.some((s) => s.state === "needs_input")) return "attention";
  if (active.some((s) => s.state === "failed")) return "failure";
  if (sessions.some((s) => s.state === "working")) return "working";
  return "quiet";
}

function isAcknowledged(s: AgentSession): boolean {
  return typeof s.metadata?.acknowledgedAt === "string";
}

/** Sessions that need the user, most urgent first. */
export function attentionSessions(sessions: AgentSession[]): AgentSession[] {
  return sessions
    .filter((s) => (s.state === "needs_input" || s.state === "failed") && !isAcknowledged(s))
    .sort((a, b) => (a.state === b.state ? a.updatedAt.localeCompare(b.updatedAt) : a.state === "needs_input" ? -1 : 1));
}

/** Mark long-silent working sessions idle. Returns the sessions that changed. */
export function sweepStale(sessions: AgentSession[], now: number, maxSilenceMs = 30 * 60_000): AgentSession[] {
  const changed: AgentSession[] = [];
  for (const s of sessions) {
    if (s.state === "working" && now - Date.parse(s.updatedAt) > maxSilenceMs) {
      changed.push({ ...s, state: "idle", updatedAt: new Date(now).toISOString() });
    }
  }
  return changed;
}
