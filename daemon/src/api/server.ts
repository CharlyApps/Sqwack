import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import type { Engine } from "../core.ts";
import { Auth } from "../auth/auth.ts";
import { validateEvent } from "../events/validate.ts";
import { normalizeClaudeHook } from "../adapters/claude/adapter.ts";
import { normalizeCodex } from "../adapters/codex/adapter.ts";
import { integrationsStatus } from "../adapters/install.ts";
import { killProcess } from "../processes/discovery.ts";
import { VERSION } from "../config.ts";
import { log } from "../log.ts";

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) });
  res.end(data);
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 256 * 1024) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function bearer(req: IncomingMessage): string | undefined {
  const h = req.headers.authorization;
  return h?.startsWith("Bearer ") ? h.slice(7) : undefined;
}

export function startServer(engine: Engine) {
  const auth = new Auth(engine.store);
  const killTimestamps: number[] = [];

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      // --- unauthenticated ---
      if (method === "GET" && path === "/v1/health") {
        return json(res, 200, { status: "ok", version: VERSION, machineId: engine.config.machineId });
      }
      if (method === "POST" && path === "/v1/pair") {
        const body = (await readBody(req)) as { code?: string; deviceName?: string };
        if (typeof body.code !== "string") return json(res, 400, { error: "code required" });
        const result = auth.completePairing(body.code, String(body.deviceName ?? "iPad"));
        if ("error" in result) return json(res, result.status, { error: result.error });
        log.info(`paired new device '${body.deviceName ?? "iPad"}'`);
        return json(res, 200, { token: result.token, deviceId: result.deviceId, machine: engine.snapshot().machine });
      }

      // --- everything else requires auth ---
      const caller = auth.authenticate(bearer(req));
      if (!caller) return json(res, 401, { error: "unauthorized" });

      if (method === "POST" && path === "/v1/pair/start") {
        if (caller.kind !== "admin") return json(res, 403, { error: "admin only" });
        return json(res, 200, auth.startPairing());
      }

      if (method === "GET" && path === "/v1/snapshot") {
        await engine.refreshProcesses();
        return json(res, 200, engine.snapshot());
      }

      if (method === "POST" && path === "/v1/events") {
        const result = validateEvent(await readBody(req));
        if ("error" in result) return json(res, 400, { error: result.error });
        const accepted = engine.ingest(result.event);
        return json(res, accepted ? 202 : 200, { accepted, duplicate: !accepted });
      }

      if (method === "POST" && (path === "/v1/hooks/claude" || path === "/v1/hooks/codex")) {
        if (caller.kind !== "admin") return json(res, 403, { error: "admin only" });
        const raw = (await readBody(req)) as Record<string, unknown>;
        const event =
          path === "/v1/hooks/claude"
            ? normalizeClaudeHook(raw, engine.config.machineId)
            : normalizeCodex(raw, engine.config.machineId);
        if (!event) return json(res, 200, { accepted: false, reason: "unmapped hook" });
        engine.ingest(event);
        return json(res, 202, { accepted: true });
      }

      if (method === "GET" && path === "/v1/sessions") {
        let sessions = engine.store.allSessions();
        const q = (name: string) => url.searchParams.get(name);
        if (q("state")) sessions = sessions.filter((s) => s.state === q("state"));
        if (q("provider")) sessions = sessions.filter((s) => s.provider === q("provider"));
        if (q("project")) sessions = sessions.filter((s) => s.projectName === q("project"));
        if (q("machineId") && q("machineId") !== "all")
          sessions = sessions.filter((s) => s.machineId === q("machineId"));
        return json(res, 200, { sessions });
      }

      const sessionMatch = path.match(/^\/v1\/sessions\/([^/]+)$/);
      if (method === "GET" && sessionMatch) {
        const session = engine.store.getSession(decodeURIComponent(sessionMatch[1]));
        return session ? json(res, 200, session) : json(res, 404, { error: "not found" });
      }
      const ackMatch = path.match(/^\/v1\/sessions\/([^/]+)\/ack$/);
      if (method === "POST" && ackMatch) {
        const session = engine.acknowledgeSession(decodeURIComponent(ackMatch[1]));
        return session ? json(res, 200, session) : json(res, 404, { error: "not found" });
      }

      if (method === "GET" && path === "/v1/processes") {
        return json(res, 200, { processes: await engine.refreshProcesses() });
      }
      const killMatch = path.match(/^\/v1\/processes\/([^/]+)\/kill$/);
      if (method === "POST" && killMatch) {
        const now = Date.now();
        while (killTimestamps.length && now - killTimestamps[0] > 60_000) killTimestamps.shift();
        if (killTimestamps.length >= 10) return json(res, 429, { error: "too many kill requests" });
        killTimestamps.push(now);

        const id = decodeURIComponent(killMatch[1]);
        const proc = engine.cachedProcesses().find((p) => p.id === id)
          ?? (await engine.refreshProcesses()).find((p) => p.id === id);
        if (!proc) return json(res, 404, { error: "unknown process id (refresh and retry)" });
        const result = await killProcess(proc);
        log.warn(`kill ${proc.name} (pid ${proc.pid}) by ${caller.kind}: ${JSON.stringify(result)}`);
        await engine.refreshProcesses();
        if (!result.ok) return json(res, 409, { error: result.error });
        return json(res, 200, { outcome: result.outcome });
      }

      if (method === "GET" && path === "/v1/integrations") {
        return json(res, 200, { integrations: integrationsStatus() });
      }

      if (method === "GET" && path === "/v1/devices") {
        return json(res, 200, { devices: engine.store.listDevices() });
      }

      return json(res, 404, { error: "not found" });
    } catch (err) {
      log.error("request failed", { url: req.url, error: String(err) });
      return json(res, err instanceof SyntaxError ? 400 : 500, { error: "internal error" });
    }
  });

  // --- WebSocket ---
  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/v1/ws") return socket.destroy();
    const token = bearer(req) ?? url.searchParams.get("token") ?? undefined;
    if (!auth.authenticate(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  });

  wss.on("connection", (ws: WebSocket) => {
    log.info("websocket client connected");
    // Snapshot first, always — a live broadcast must never beat the snapshot.
    ws.send(JSON.stringify({ type: "snapshot", data: engine.snapshot() }));
    engine.refreshUsage(); // fresh usage follows as usage.updated if changed
    engine.refreshProcesses().catch(() => {}); // fresh process list follows as processes.updated
  });

  const unsubscribe = engine.onBroadcast((msg) => {
    const data = JSON.stringify(msg);
    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    }
  });

  const timers = [
    setInterval(() => engine.heartbeat(), 30_000),
    setInterval(() => engine.sweep(), 60_000),
    setInterval(() => engine.refreshProcesses().catch((e) => log.debug("process refresh failed", String(e))), 20_000),
    setInterval(() => { try { engine.refreshUsage(); } catch (e) { log.debug("usage refresh failed", String(e)); } }, 120_000),
    setInterval(() => engine.store.prune(engine.config.retentionDays.events, engine.config.retentionDays.sessions), 6 * 3600_000),
  ];

  const { port, bind } = engine.config.network;
  server.listen(port, bind, () => log.info(`sqwackd listening on http://${bind}:${port}`));

  return {
    server,
    close(): void {
      unsubscribe();
      for (const t of timers) clearInterval(t);
      for (const c of wss.clients) c.close();
      wss.close();
      server.close();
    },
  };
}
