import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { refreshTokens } from "../db/schema.ts";
import { REFRESH_TTL_MS, hashToken, mintRefreshToken } from "../auth/tokens.ts";

export type ConsumeResult = { houseId: string; id: string } | "unknown" | "expired" | "replayed";

/**
 * Rotation with replay detection: consuming a token deletes it and
 * records its id as `rotatedFrom` on the successor. A token that is
 * presented again after rotation is gone from the table but its id is
 * still referenced by a live successor — that is a replay, and the
 * whole chain is revoked (spec §3.2, review-focus item 4).
 */
export class RefreshTokensRepo {
  constructor(private readonly db: Db) {}

  async issue(houseId: string, nowMs: number, rotatedFrom?: string): Promise<{ token: string; id: string }> {
    const token = mintRefreshToken();
    const id = crypto.randomUUID();
    await this.db.insert(refreshTokens).values({
      id,
      houseId,
      tokenHash: await hashToken(token),
      createdAt: nowMs,
      expiresAt: nowMs + REFRESH_TTL_MS,
      rotatedFrom: rotatedFrom ?? null,
    });
    return { token, id };
  }

  async consume(token: string, nowMs: number): Promise<ConsumeResult> {
    const tokenHash = await hashToken(token);
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!row) return "unknown";
    if (row.expiresAt <= nowMs) {
      await this.db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
      return "expired";
    }
    await this.db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
    return { houseId: row.houseId, id: row.id };
  }

  /** True when `id` is the ancestor of a token still in the table. */
  async wasRotated(id: string): Promise<boolean> {
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.rotatedFrom, id) });
    return row !== undefined;
  }

  async revokeAll(houseId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.houseId, houseId));
  }

  async pruneExpired(nowMs: number): Promise<number> {
    const r = await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, nowMs));
    return r.meta.changes;
  }
}
