import { randomUUID } from "node:crypto";
import type { SqwackEvent } from "./types.ts";

/**
 * Demo event generator: cycles realistic events against a running daemon over
 * the real /v1/events API so the whole ingestion path is exercised.
 */
export function demoSteps(machineId: string): { delayMs: number; label: string; event: SqwackEvent }[] {
  const base = (provider: "codex" | "claude", type: SqwackEvent["type"], extra: Partial<SqwackEvent>): SqwackEvent => ({
    id: randomUUID(),
    schemaVersion: 1,
    machineId,
    timestamp: new Date().toISOString(),
    source: { provider, integration: `${provider}-demo`, surface: "cli" },
    type,
    ...extra,
  });
  const codex = { sessionId: "demo-codex-1", project: { name: "Tabor API", cwd: "/demo/tabor-api" } };
  const claude = { sessionId: "demo-claude-1", project: { name: "T&E Platform", cwd: "/demo/te-platform" } };

  return [
    { delayMs: 0, label: "Codex working", event: base("codex", "agent.started", { ...codex, message: "Refactoring auth" }) },
    { delayMs: 2000, label: "Claude working", event: base("claude", "agent.started", { ...claude, message: "Running migration" }) },
    { delayMs: 4000, label: "Claude needs input", event: base("claude", "agent.needs_input", { ...claude, message: "Waiting for permission", severity: "warning" }) },
    { delayMs: 6000, label: "Claude resumes", event: base("claude", "agent.working", { ...claude, message: "Migration continuing" }) },
    { delayMs: 8000, label: "Codex done", event: base("codex", "agent.finished", { ...codex, message: "Auth refactor complete", severity: "success" }) },
    { delayMs: 10000, label: "Claude fails", event: base("claude", "agent.failed", { ...claude, message: "Migration failed: tests red", severity: "error" }) },
    { delayMs: 13000, label: "Claude retries", event: base("claude", "agent.started", { ...claude, message: "Retrying migration" }) },
    { delayMs: 16000, label: "Claude done", event: base("claude", "agent.finished", { ...claude, message: "Migration complete", severity: "success" }) },
  ];
}

export async function runDemo(endpoint: string, token: string, machineId: string, loop: boolean): Promise<void> {
  // Fresh session ids per cycle so each loop reads as new activity.
  do {
    const cycle = randomUUID().slice(0, 8);
    const steps = demoSteps(machineId).map((s) => ({
      ...s,
      event: { ...s.event, sessionId: s.event.sessionId ? `${s.event.sessionId}-${cycle}` : undefined },
    }));
    let elapsed = 0;
    for (const step of steps) {
      await new Promise((r) => setTimeout(r, step.delayMs - elapsed));
      elapsed = step.delayMs;
      const stamped = { ...step.event, timestamp: new Date().toISOString() };
      const res = await fetch(`${endpoint}/v1/events`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(stamped),
      });
      console.log(`demo: ${step.label} -> ${res.status}`);
    }
    if (loop) await new Promise((r) => setTimeout(r, 5000));
  } while (loop);
}
