import { closeSync, existsSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentSession } from "../types.ts";

/**
 * On-demand, read-only transcript access. Conversations are read straight from
 * the provider's own files at request time and returned to the caller — they
 * are NEVER copied into Sqwack's database or logs.
 */
export interface TranscriptMessage {
  role: "user" | "assistant";
  text: string;
  timestamp?: string;
}

export interface Transcript {
  available: boolean;
  source?: string;
  messages: TranscriptMessage[];
}

const CLAUDE_PROJECTS = () => process.env.SQWACK_CLAUDE_PROJECTS ?? join(homedir(), ".claude", "projects");
const CODEX_SESSIONS = () => process.env.SQWACK_CODEX_SESSIONS ?? join(homedir(), ".codex", "sessions");
const MAX_MESSAGES = 80;
const MAX_CHARS = 4000;
const MAX_READ_BYTES = 2 * 1024 * 1024;

export function readTranscript(sessionId: string, session?: AgentSession): Transcript {
  const [provider, ...rest] = sessionId.split(":");
  const rawId = rest.join(":");
  if (!rawId) return { available: false, messages: [] };
  if (provider === "claude") return readClaudeTranscript(rawId);
  if (provider === "codex") return readCodexTranscript(rawId, session);
  return { available: false, messages: [] };
}

function clip(text: string): string {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + "\n…" : text;
}

function readChunk(path: string, start: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(length);
    return buffer.subarray(0, readSync(fd, buffer, 0, length, start)).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

function readTail(path: string): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - MAX_READ_BYTES);
  const text = readChunk(path, start, size - start);
  if (start === 0) return text;
  const firstNewline = text.indexOf("\n");
  return firstNewline === -1 ? "" : text.slice(firstNewline + 1);
}

function readFirstLine(path: string): string | undefined {
  return readChunk(path, 0, Math.min(statSync(path).size, 64 * 1024)).split("\n")[0] || undefined;
}

function readClaudeTranscript(sessionUuid: string): Transcript {
  // Transcripts live at ~/.claude/projects/<project-slug>/<session-uuid>.jsonl
  if (!/^[\w-]+$/.test(sessionUuid)) return { available: false, messages: [] };
  let file: string | undefined;
  try {
    for (const dir of readdirSync(CLAUDE_PROJECTS())) {
      const candidate = join(CLAUDE_PROJECTS(), dir, `${sessionUuid}.jsonl`);
      if (existsSync(candidate)) {
        file = candidate;
        break;
      }
    }
  } catch {
    return { available: false, messages: [] };
  }
  if (!file) return { available: false, messages: [] };

  const messages: TranscriptMessage[] = [];
  for (const line of readTail(file).split("\n")) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    if (entry.isMeta) continue;
    const message = entry.message as { role?: string; content?: unknown } | undefined;
    if (!message) continue;
    const text = extractText(message.content);
    if (!text) continue;
    messages.push({
      role: entry.type === "user" ? "user" : "assistant",
      text: clip(text),
      timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined,
    });
  }
  return { available: messages.length > 0, source: "claude-code transcript (read-only)", messages: messages.slice(-MAX_MESSAGES) };
}

function readCodexTranscript(threadId: string, session?: AgentSession): Transcript {
  if (!/^[\w-]+$/.test(threadId)) return { available: false, messages: [] };
  // Rollouts live at ~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<thread-id>.jsonl
  let file = findCodexTranscript(threadId);
  if (!file && session?.cwd) file = findCodexTranscriptBySession(session);
  if (!file) return { available: false, messages: [] };

  const messages: TranscriptMessage[] = [];
  for (const line of readTail(file).split("\n")) {
    if (!line) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const payload = entry.payload as Record<string, unknown> | undefined;
    if (!payload) continue;
    // response_item message entries carry the conversation
    if (entry.type === "response_item" && payload.type === "message") {
      const role = payload.role === "user" ? "user" : payload.role === "assistant" ? "assistant" : undefined;
      if (!role) continue;
      const text = extractText(payload.content);
      // Codex embeds environment/instruction/plugin blocks as tag-wrapped user
      // messages; anything starting with a tag is harness noise, not the user.
      if (!text || (role === "user" && text.startsWith("<"))) continue;
      messages.push({ role, text: clip(text), timestamp: typeof entry.timestamp === "string" ? entry.timestamp : undefined });
    }
  }
  return { available: messages.length > 0, source: "codex session rollout (read-only)", messages: messages.slice(-MAX_MESSAGES) };
}

function recentCodexRollouts(): string[] {
  const files: string[] = [];
  try {
    const root = CODEX_SESSIONS();
    for (const year of dirs(root).sort().reverse().slice(0, 2)) {
      for (const month of dirs(join(root, year)).sort().reverse()) {
        for (const day of dirs(join(root, year, month)).sort().reverse()) {
          for (const name of readdirSync(join(root, year, month, day)).filter((e) => !e.startsWith("."))) {
            if (name.endsWith(".jsonl")) files.push(join(root, year, month, day, name));
          }
        }
      }
    }
  } catch {
    return [];
  }
  return files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs).slice(0, 40);
}

function dirs(path: string): string[] {
  return readdirSync(path).filter((e) => !e.startsWith(".") && statSync(join(path, e)).isDirectory());
}

function findCodexTranscript(threadId: string): string | undefined {
  return recentCodexRollouts().find((file) => file.includes(threadId));
}

function findCodexTranscriptBySession(session: AgentSession): string | undefined {
  const target = Date.parse(session.updatedAt);
  // ponytail: cwd+15m fallback maps Codex notify turn ids to nearby hook rollouts; add exact notify thread id if Codex exposes it.
  for (const file of recentCodexRollouts()) {
    const first = readFirstLine(file);
    if (!first) continue;
    try {
      const meta = JSON.parse(first) as { type?: string; timestamp?: string; payload?: { cwd?: string; timestamp?: string } };
      if (meta.type !== "session_meta" || !meta.payload || meta.payload.cwd !== session.cwd) continue;
      const ts = Date.parse(meta.timestamp ?? meta.payload.timestamp ?? "");
      if (Number.isFinite(ts) && Math.abs(ts - target) < 15 * 60_000) return file;
    } catch {
      continue;
    }
  }
  return undefined;
}

function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((item) => {
      const it = item as { type?: string; text?: string };
      return typeof it.text === "string" && (it.type === "text" || it.type === "input_text" || it.type === "output_text") ? it.text : "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}
