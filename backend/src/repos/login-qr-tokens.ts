import { and, eq, gt, inArray, isNull, lt } from "drizzle-orm";
import { LOGIN_QR_TTL_SEC } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { loginQrTokens } from "../db/schema.ts";
import { hashToken, mintRefreshToken } from "../auth/tokens.ts";

/** Used and expired rows stay this long past expiry, so a failed scan can still be looked into. */
export const LOGIN_QR_KEEP_MS = 60 * 60_000;
const PRUNE_CHUNK = 500;
const PRUNE_MAX_ROUNDS = 200;

/**
 * One-time QR login tokens (spec §3.1, §3.3). Only the SHA-256 is stored: a read of the table (a backup, a
 * debug query) must not hand out live sign-ins.
 */
export class LoginQrTokensRepo {
  constructor(private readonly db: Db) {}

  /**
   * A new token replaces every older one of the device, in one batch: the device shows one QR at a time, so a
   * QR left on screen (or photographed) dies as soon as the device asks for the next one. Returns the plaintext,
   * which only the create response ever carries.
   */
  async create(deviceId: string, houseId: string, nowMs: number): Promise<string> {
    const token = mintRefreshToken();
    const tokenHash = await hashToken(token);
    await this.db.batch([
      this.db.delete(loginQrTokens).where(eq(loginQrTokens.deviceId, deviceId)),
      this.db.insert(loginQrTokens).values({ tokenHash, deviceId, houseId, createdAt: nowMs, expiresAt: nowMs + LOGIN_QR_TTL_SEC * 1000, consumedAt: null }),
    ]);
    return token;
  }

  /**
   * The claim is ONE conditional UPDATE ... RETURNING: two phones scanning the same QR at once (or a reload of
   * /qr) are serialised by SQLite and the loser matches zero rows. A read-then-write would let both sign in.
   * The device id is part of the match so a token is only good together with the device that showed it.
   */
  async consume(deviceId: string, token: string, nowMs: number): Promise<{ houseId: string } | null> {
    const [won] = await this.db
      .update(loginQrTokens)
      .set({ consumedAt: nowMs })
      .where(
        and(
          eq(loginQrTokens.tokenHash, await hashToken(token)),
          eq(loginQrTokens.deviceId, deviceId),
          isNull(loginQrTokens.consumedAt),
          gt(loginQrTokens.expiresAt, nowMs),
        ),
      )
      .returning({ houseId: loginQrTokens.houseId });
    return won ?? null;
  }

  /** Chunked like PairingsRepo.pruneExpired: one unbounded DELETE after an outage would not fit D1's per-statement budget. */
  async pruneExpired(nowMs: number): Promise<number> {
    const cutoff = nowMs - LOGIN_QR_KEEP_MS;
    let total = 0;
    for (let round = 0; round < PRUNE_MAX_ROUNDS; round++) {
      const res = await this.db.delete(loginQrTokens).where(
        inArray(loginQrTokens.tokenHash, this.db.select({ h: loginQrTokens.tokenHash }).from(loginQrTokens).where(lt(loginQrTokens.expiresAt, cutoff)).limit(PRUNE_CHUNK)),
      );
      const changes = res.meta.changes ?? 0;
      total += changes;
      if (changes < PRUNE_CHUNK) break;
    }
    return total;
  }
}
