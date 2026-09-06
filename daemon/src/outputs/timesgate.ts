import sharp from "sharp";
import type { Engine } from "../core.ts";
import { saveConfig } from "../config.ts";
import { log } from "../log.ts";
import type { Snapshot, SqwackStatus } from "../types.ts";

type Panel = { screen: number; signature: string; svg: string };

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const bar = (y: number, percent: number, color: string) => `
  <rect x="12" y="${y}" width="104" height="7" rx="3" fill="#25252B"/>
  <rect x="12" y="${y}" width="${Math.round(104 * percent / 100)}" height="7" rx="3" fill="${color}"/>`;

function frame(title: string, color: string, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
  <rect width="128" height="128" fill="#000"/>
  <text x="64" y="23" text-anchor="middle" fill="${color}" font-family="Menlo,monospace" font-size="15" font-weight="700">${title}</text>
  ${body}
</svg>`;
}

function usagePanel(snapshot: Snapshot, provider: "codex" | "claude", screen: number, color: string): Panel {
  const usage = snapshot.usage.find((item) => item.provider === provider);
  const remaining = (label: string) => {
    const window = usage?.windows.find((item) => item.label.toLowerCase() === label);
    return window ? clamp(100 - window.usedPercent) : undefined;
  };
  const five = remaining("5h");
  const week = remaining("week");
  const value = (percent: number | undefined) => percent === undefined ? "—" : `${percent}%`;
  const body = `
  <text x="12" y="49" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">5H LEFT</text>
  <text x="116" y="49" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${value(five)}</text>
  ${bar(58, five ?? 0, color)}
  <text x="12" y="88" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">WK LEFT</text>
  <text x="116" y="88" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${value(week)}</text>
  ${bar(97, week ?? 0, color)}`;
  return { screen, signature: `${provider}:${five}:${week}`, svg: frame(provider.toUpperCase(), color, body) };
}

function statusPanel(snapshot: Snapshot): Panel {
  const labels: Record<SqwackStatus, [string, string]> = {
    quiet: ["QUIET", "#60A5FA"],
    working: ["WORKING", "#34D399"],
    attention: ["NEEDS YOU", "#F59E0B"],
    failure: ["FAILED", "#EF4444"],
  };
  const [label, color] = labels[snapshot.status];
  const active = snapshot.sessions.filter((session) => session.state === "working" || session.state === "needs_input").length;
  const body = `
  <circle cx="64" cy="64" r="25" fill="none" stroke="${color}" stroke-width="5"/>
  <circle cx="64" cy="64" r="14" fill="${color}" opacity=".18"/>
  <text x="64" y="103" text-anchor="middle" fill="#FFF" font-family="Menlo,monospace" font-size="${label.length > 7 ? 12 : 14}" font-weight="700">${label}</text>
  <text x="64" y="119" text-anchor="middle" fill="#71717A" font-family="Menlo,monospace" font-size="9">${active} ACTIVE</text>`;
  return { screen: 2, signature: `status:${snapshot.status}:${active}`, svg: frame("SQWACK", color, body) };
}

function systemPanel(snapshot: Snapshot): Panel {
  const stats = snapshot.system?.stats;
  const cpu = stats ? clamp(Math.round(stats.cpuPercent / 5) * 5) : 0;
  const ram = stats ? clamp(Math.round((stats.ramUsedBytes / stats.ramTotalBytes) * 20) * 5) : 0;
  const body = `
  <text x="12" y="49" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">CPU</text>
  <text x="116" y="49" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${stats ? `${cpu}%` : "—"}</text>
  ${bar(58, cpu, "#38BDF8")}
  <text x="12" y="88" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">RAM</text>
  <text x="116" y="88" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${stats ? `${ram}%` : "—"}</text>
  ${bar(97, ram, "#A78BFA")}`;
  return { screen: 3, signature: `system:${stats ? cpu : "?"}:${stats ? ram : "?"}`, svg: frame("SYSTEM", "#E4E4E7", body) };
}

function machinePanel(snapshot: Snapshot): Panel {
  const stats = snapshot.system?.stats;
  const disk = stats?.diskTotalBytes ? clamp(Math.round((stats.diskUsedBytes / stats.diskTotalBytes) * 20) * 5) : undefined;
  const uptimeHours = stats ? Math.floor(stats.uptimeSeconds / 3600) : undefined;
  const uptimeLabel = uptimeHours === undefined ? "—"
    : uptimeHours >= 24 ? `${Math.floor(uptimeHours / 24)}D ${uptimeHours % 24}H`
      : `${uptimeHours}H`;
  const dayProgress = uptimeHours === undefined ? 0 : (uptimeHours % 24) / 24 * 100;
  const body = `
  <text x="12" y="49" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">DISK</text>
  <text x="116" y="49" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${disk === undefined ? "—" : `${disk}%`}</text>
  ${bar(58, disk ?? 0, "#A78BFA")}
  <text x="12" y="88" fill="#A1A1AA" font-family="Menlo,monospace" font-size="11">UPTIME</text>
  <text x="116" y="88" text-anchor="end" fill="#FFF" font-family="Menlo,monospace" font-size="14" font-weight="700">${uptimeLabel}</text>
  ${bar(97, dayProgress, "#22D3EE")}`;
  return { screen: 4, signature: `machine:${disk ?? "?"}:${uptimeHours ?? "?"}`, svg: frame("MACHINE", "#22D3EE", body) };
}

export function renderTimesGatePanels(snapshot: Snapshot): Panel[] {
  return [
    usagePanel(snapshot, "codex", 0, "#34D399"),
    usagePanel(snapshot, "claude", 1, "#F59E0B"),
    statusPanel(snapshot),
    systemPanel(snapshot),
    machinePanel(snapshot),
  ];
}

class TimesGate {
  private picId = 0;
  private signatures = new Map<number, string>();
  private url: string;
  private localToken: number;

  constructor(url: string, localToken: number) {
    this.url = url;
    this.localToken = localToken;
  }

  private async send(command: Record<string, unknown>): Promise<void> {
    const response = await fetch(this.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...command, LocalToken: this.localToken }),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as { error_code?: number | string };
    if (body.error_code !== 0) throw new Error(String(body.error_code ?? "invalid response"));
  }

  async reset(): Promise<void> {
    await this.send({ Command: "Draw/ResetHttpGifId" });
    this.picId = 0;
    this.signatures.clear();
  }

  async sync(snapshot: Snapshot): Promise<void> {
    for (const panel of renderTimesGatePanels(snapshot)) {
      if (this.signatures.get(panel.screen) === panel.signature) continue;
      const jpeg = await sharp(Buffer.from(panel.svg)).jpeg({ quality: 95, chromaSubsampling: "4:4:4" }).toBuffer();
      const lcd = [0, 0, 0, 0, 0];
      lcd[panel.screen] = 1;
      await this.send({
        Command: "Draw/SendHttpGif",
        LcdArray: lcd,
        PicNum: 1,
        PicWidth: 128,
        PicOffset: 0,
        PicID: ++this.picId,
        PicSpeed: 1000,
        PicData: jpeg.toString("base64"),
      });
      this.signatures.set(panel.screen, panel.signature);
    }
  }
}

export function startTimesGate(engine: Engine) {
  const config = engine.config.timesGate;
  const unavailable = {
    configured: false,
    enabled: false,
    async setEnabled(): Promise<void> {},
    close() {},
  };
  if (!config) return unavailable;
  if (!/^[a-z0-9.-]+$/i.test(config.host) || !Number.isInteger(config.localToken)) {
    log.warn("Times Gate config ignored: host/localToken is invalid");
    return unavailable;
  }

  const gate = new TimesGate(`http://${config.host}/post`, config.localToken);
  let enabled = config.enabled !== false;
  let stopped = false;
  let failed = false;
  let initialized = false;
  let queue = Promise.resolve();
  const sync = () => {
    queue = queue
      .then(async () => {
        if (stopped || !enabled) return;
        if (!initialized) {
          await gate.reset();
          initialized = true;
        }
        await gate.sync(engine.snapshot());
      })
      .then(() => {
        if (failed) log.info("Times Gate reconnected");
        failed = false;
      })
      .catch((error) => {
        if (!failed) log.warn("Times Gate update failed", String(error));
        failed = true;
      });
    return queue;
  };
  const unsubscribe = engine.onBroadcast((message) => {
    if (["usage.updated", "system.updated", "status.updated", "session.updated"].includes(message.type)) sync();
  });
  const usageTimer = setInterval(() => {
    if (enabled) engine.refreshUsage().then(sync).catch(() => {});
  }, 5 * 60_000);
  if (enabled) {
    sync();
    void Promise.allSettled([engine.refreshUsage(), engine.refreshSystem()]).then(sync);
    log.info(`Times Gate output enabled at ${config.host}`);
  }

  return {
    configured: true,
    get enabled() { return enabled; },
    async setEnabled(value: boolean): Promise<void> {
      if (value === enabled) return;
      enabled = value;
      engine.config = { ...engine.config, timesGate: { ...config, enabled } };
      saveConfig(engine.config);
      initialized = false;
      if (enabled) await sync();
      log.info(`Times Gate output ${enabled ? "enabled" : "disabled"}`);
    },
    close(): void {
      stopped = true;
      clearInterval(usageTimer);
      unsubscribe();
    },
  };
}
