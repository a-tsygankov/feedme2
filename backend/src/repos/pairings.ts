import { eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { pendingPairings } from "../db/schema.ts";

export const PAIR_TTL_MS = 10 * 60_000;
export const PAIR_POLL_SEC = 3;

function randomCode(): string {
  // 100000–999999 so the code never starts with 0 (people drop leading zeros).
  const n = 100_000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900_000);
  return String(n);
}

export class PairingsRepo {
  constructor(private readonly db: Db) {}

  findByDevice(deviceId: string) {
    return this.db.query.pendingPairings.findFirst({ where: eq(pendingPairings.deviceId, deviceId) });
  }
  findByCode(code: string) {
    return this.db.query.pendingPairings.findFirst({ where: eq(pendingPairings.pairCode, code) });
  }

  /** One handshake per device: a new start replaces the old row (and its code). */
  async start(deviceId: string, hwModel: string, fwVersion: string, nowMs: number): Promise<{ pairCode: string; expiresAt: number }> {
    const expiresAt = nowMs + PAIR_TTL_MS;
    for (let attempt = 0; attempt < 5; attempt++) {
      const pairCode = randomCode();
      try {
        await this.db
          .insert(pendingPairings)
          .values({ deviceId, pairCode, hwModel, fwVersion, requestedAt: nowMs, expiresAt, houseId: null, confirmedAt: null, deviceToken: null, deliveredAt: null, cancelledAt: null })
          .onConflictDoUpdate({
            target: pendingPairings.deviceId,
            set: { pairCode, hwModel, fwVersion, requestedAt: nowMs, expiresAt, houseId: null, confirmedAt: null, deviceToken: null, deliveredAt: null, cancelledAt: null },
          });
        return { pairCode, expiresAt };
      } catch (err) {
        // UNIQUE on pair_code: another device holds this code right now.
        if (attempt === 4 || !(err instanceof Error && /UNIQUE/i.test(err.message))) throw err;
      }
    }
    throw new Error("unreachable");
  }

  async confirm(deviceId: string, houseId: string, deviceToken: string, nowMs: number): Promise<void> {
    await this.db.update(pendingPairings).set({ houseId, deviceToken, confirmedAt: nowMs }).where(eq(pendingPairings.deviceId, deviceId));
  }
  async markDelivered(deviceId: string, nowMs: number): Promise<void> {
    await this.db.update(pendingPairings).set({ deliveredAt: nowMs }).where(eq(pendingPairings.deviceId, deviceId));
  }
  /** Rows past expiry carry a plaintext token for at most PAIR_TTL_MS; the cron removes them. */
  async pruneExpired(nowMs: number): Promise<number> {
    const r = await this.db.delete(pendingPairings).where(lt(pendingPairings.expiresAt, nowMs));
    return r.meta.changes;
  }
}
