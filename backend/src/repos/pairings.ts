import { and, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { pairAttempts, pendingPairings } from "../db/schema.ts";

export const PAIR_TTL_MS = 10 * 60_000;
export const PAIR_POLL_SEC = 3;
/** After /confirm the row only has to live long enough for the device to collect its token. */
export const PAIR_DELIVERY_GRACE_MS = 2 * 60_000;
/** The token may be served again this long after its first delivery (a response lost on the way to the device). */
export const PAIR_REDELIVER_MS = 60_000;
/** Failed /confirm attempts a house may make per window before it is told to wait. */
export const CONFIRM_MAX_FAILURES = 10;
export const CONFIRM_WINDOW_MS = 10 * 60_000;
const PRUNE_CHUNK = 500;
const PRUNE_MAX_ROUNDS = 200;
const START_ATTEMPTS = 5;

function randomCode(): string {
  // 100000–999999 so the code never starts with 0 (people drop leading zeros).
  const n = 100_000 + (crypto.getRandomValues(new Uint32Array(1))[0]! % 900_000);
  return String(n);
}

/** Indirected so a test can force a collision; production always draws from the CSPRNG. */
export const codeSource = { next: randomCode };

export type ClaimedPairing = { deviceId: string; hwModel: string; fwVersion: string };

export class PairingsRepo {
  constructor(private readonly db: Db) {}

  findByDevice(deviceId: string) {
    return this.db.query.pendingPairings.findFirst({ where: eq(pendingPairings.deviceId, deviceId) });
  }
  findByCode(code: string) {
    return this.db.query.pendingPairings.findFirst({ where: eq(pendingPairings.pairCode, code) });
  }

  /** One handshake per device: a new start replaces the old row (and its code, token and poll secret). */
  async start(deviceId: string, hwModel: string, fwVersion: string, pollSecretHash: string, nowMs: number): Promise<{ pairCode: string; expiresAt: number }> {
    const expiresAt = nowMs + PAIR_TTL_MS;
    let pairCode = codeSource.next();
    for (let attempt = 0; attempt < START_ATTEMPTS; attempt++) {
      try {
        await this.db
          .insert(pendingPairings)
          .values({ deviceId, pairCode, hwModel, fwVersion, requestedAt: nowMs, expiresAt, pollSecretHash, houseId: null, confirmedAt: null, deviceToken: null, deliveredAt: null })
          .onConflictDoUpdate({
            target: pendingPairings.deviceId,
            set: { pairCode, hwModel, fwVersion, requestedAt: nowMs, expiresAt, pollSecretHash, houseId: null, confirmedAt: null, deviceToken: null, deliveredAt: null },
          });
        return { pairCode, expiresAt };
      } catch (err) {
        // UNIQUE on pair_code: another device holds this code. An expired holder is only waiting for the
        // hourly cron, and the 6-digit space is small enough that it must not block a start: take its code.
        if (attempt === START_ATTEMPTS - 1 || !isUniqueViolation(err, "pair_code")) throw err;
        const reclaimed = await this.db.delete(pendingPairings).where(and(eq(pendingPairings.pairCode, pairCode), lt(pendingPairings.expiresAt, nowMs)));
        if ((reclaimed.meta.changes ?? 0) === 0) pairCode = codeSource.next();
      }
    }
    throw new Error("unreachable");
  }

  /**
   * Takes the code in one statement: of any number of concurrent confirms, exactly one sees the row
   * unconfirmed and live. Without this, two houses could both pass a read-then-write check and the
   * pending row, the devices row and the token would each name a different house.
   * The device id is part of the match so a code recycled to another device between the caller's read and
   * this write is not claimed by mistake. expires_at moves to the delivery grace.
   */
  async claim(pairCode: string, deviceId: string, houseId: string, deviceToken: string, nowMs: number): Promise<ClaimedPairing | undefined> {
    const rows = await this.db
      .update(pendingPairings)
      .set({ houseId, deviceToken, confirmedAt: nowMs, expiresAt: nowMs + PAIR_DELIVERY_GRACE_MS })
      .where(and(eq(pendingPairings.pairCode, pairCode), eq(pendingPairings.deviceId, deviceId), isNull(pendingPairings.confirmedAt), gt(pendingPairings.expiresAt, nowMs)))
      .returning({ deviceId: pendingPairings.deviceId, hwModel: pendingPairings.hwModel, fwVersion: pendingPairings.fwVersion });
    return rows[0];
  }

  /** Gives a claim back (the device turned out to be live in another house): the code works again for its owner. */
  async release(deviceId: string, claimedAt: number, originalExpiresAt: number): Promise<void> {
    await this.db
      .update(pendingPairings)
      // deliveredAt too: a /check that slipped in between the claim and the
      // failed upsert must not shorten the next confirm's delivery window.
      .set({ houseId: null, deviceToken: null, confirmedAt: null, deliveredAt: null, expiresAt: originalExpiresAt })
      .where(and(eq(pendingPairings.deviceId, deviceId), eq(pendingPairings.confirmedAt, claimedAt)));
  }

  async markDelivered(deviceId: string, nowMs: number): Promise<void> {
    await this.db.update(pendingPairings).set({ deliveredAt: nowMs }).where(and(eq(pendingPairings.deviceId, deviceId), isNull(pendingPairings.deliveredAt)));
  }
  /** The plaintext token must not outlive its delivery window. */
  async wipeToken(deviceId: string): Promise<void> {
    await this.db.update(pendingPairings).set({ deviceToken: null }).where(eq(pendingPairings.deviceId, deviceId));
  }

  /** Seconds the house must wait before another /confirm, or null when it may try. */
  async confirmBlockedForSec(houseId: string, nowMs: number): Promise<number | null> {
    const row = await this.db.query.pairAttempts.findFirst({ where: eq(pairAttempts.houseId, houseId) });
    if (!row || row.windowStart < nowMs - CONFIRM_WINDOW_MS || row.failures < CONFIRM_MAX_FAILURES) return null;
    return Math.max(1, Math.ceil((row.windowStart + CONFIRM_WINDOW_MS - nowMs) / 1000));
  }
  /** One UPSERT: a stale window restarts at 1, a live one counts up. */
  async recordConfirmFailure(houseId: string, nowMs: number): Promise<void> {
    const cutoff = nowMs - CONFIRM_WINDOW_MS;
    await this.db
      .insert(pairAttempts)
      .values({ houseId, windowStart: nowMs, failures: 1 })
      .onConflictDoUpdate({
        target: pairAttempts.houseId,
        set: {
          failures: sql`CASE WHEN ${pairAttempts.windowStart} < ${cutoff} THEN 1 ELSE ${pairAttempts.failures} + 1 END`,
          windowStart: sql`CASE WHEN ${pairAttempts.windowStart} < ${cutoff} THEN ${nowMs} ELSE ${pairAttempts.windowStart} END`,
        },
      });
  }

  /**
   * Rows past expiry can still carry a plaintext token; the cron removes them. Chunked like the log prune:
   * one unbounded DELETE after an outage (or a /start flood) would not fit D1's per-statement time budget.
   */
  async pruneExpired(nowMs: number): Promise<number> {
    let total = 0;
    for (let round = 0; round < PRUNE_MAX_ROUNDS; round++) {
      const res = await this.db.delete(pendingPairings).where(
        inArray(pendingPairings.deviceId, this.db.select({ id: pendingPairings.deviceId }).from(pendingPairings).where(lt(pendingPairings.expiresAt, nowMs)).limit(PRUNE_CHUNK)),
      );
      const changes = res.meta.changes ?? 0;
      total += changes;
      if (changes < PRUNE_CHUNK) break;
    }
    return total;
  }
}
