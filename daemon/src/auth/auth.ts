import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config.ts";
import type { Store } from "../persistence/db.ts";

export const hash = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Admin token: filesystem-permission-protected secret for same-user callers
 * (CLI commands, adapter hooks). Never leaves the machine.
 */
export function adminToken(): string {
  const path = join(DATA_DIR, "admin-token");
  if (existsSync(path)) return readFileSync(path, "utf8").trim();
  const token = randomBytes(32).toString("hex");
  writeFileSync(path, token + "\n", { mode: 0o600 });
  return token;
}

interface PairingCode {
  code: string;
  expiresAt: number;
}

export class Auth {
  private pending: PairingCode | undefined;
  private failures: number[] = []; // pairing attempt timestamps for rate limiting
  private adminHash: string;
  private store: Store;

  constructor(store: Store) {
    this.store = store;
    this.adminHash = hash(adminToken());
  }

  /** Start pairing: returns a short single-use code valid for 5 minutes. */
  startPairing(): { code: string; expiresAt: string } {
    const code = randomBytes(4).toString("hex").toUpperCase(); // 8 chars
    this.pending = { code, expiresAt: Date.now() + 5 * 60_000 };
    return { code, expiresAt: new Date(this.pending.expiresAt).toISOString() };
  }

  /** Exchange pairing code for a long-lived device token. */
  completePairing(code: string, deviceName: string): { token: string; deviceId: string } | { error: string; status: number } {
    const now = Date.now();
    this.failures = this.failures.filter((t) => now - t < 5 * 60_000);
    if (this.failures.length >= 5) return { error: "too many attempts, wait 5 minutes", status: 429 };
    const p = this.pending;
    const supplied = Buffer.from(code.toUpperCase().padEnd(16));
    const expected = Buffer.from((p?.code ?? "").padEnd(16));
    if (!p || now > p.expiresAt || !timingSafeEqual(supplied, expected)) {
      this.failures.push(now);
      return { error: "invalid or expired pairing code", status: 401 };
    }
    this.pending = undefined; // single use
    const token = randomBytes(32).toString("hex");
    const deviceId = randomUUID();
    this.store.addDevice(deviceId, deviceName || "iPad", hash(token));
    return { token, deviceId };
  }

  /** Validate a bearer token. Returns the caller identity or undefined. */
  authenticate(bearer: string | undefined): { kind: "admin" } | { kind: "device"; id: string; name: string } | undefined {
    if (!bearer) return undefined;
    const h = hash(bearer);
    if (timingSafeEqual(Buffer.from(h), Buffer.from(this.adminHash))) return { kind: "admin" };
    const device = this.store.deviceByTokenHash(h);
    if (device) {
      this.store.touchDevice(device.id);
      return { kind: "device", id: device.id, name: device.name };
    }
    return undefined;
  }
}
