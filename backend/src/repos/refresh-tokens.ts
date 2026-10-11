import { and, eq, lt } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { refreshTokens } from "../db/schema.ts";
import { REFRESH_TTL_MS, hashToken, mintRefreshToken } from "../auth/tokens.ts";

export type ConsumeResult = { houseId: string; id: string } | "unknown" | "expired";

const TOMBSTONE = "tombstone";
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;

export class RefreshTokensRepo {
  constructor(private readonly db: Db) {}

  async issue(houseId: string, nowMs: number, rotatedFrom?: string): Promise<{ token: string; id: string }> {
    const token = mintRefreshToken();
    const id = crypto.randomUUID();
    await this.db.insert(refreshTokens).values({
      id, houseId, tokenHash: await hashToken(token), createdAt: nowMs, expiresAt: nowMs + REFRESH_TTL_MS, rotatedFrom: rotatedFrom ?? null,
    });
    return { token, id };
  }

  /** Live token → consumed (turned into a tombstone). */
  async consume(token: string, nowMs: number): Promise<ConsumeResult> {
    const tokenHash = await hashToken(token);
    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!row || row.rotatedFrom === TOMBSTONE) return "unknown";
    if (row.expiresAt <= nowMs) {
      await this.db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
      return "expired";
    }
    // Keep the hash as a tombstone so a replay can be attributed.
    await this.db
      .update(refreshTokens)
      .set({ rotatedFrom: TOMBSTONE, expiresAt: nowMs + TOMBSTONE_TTL_MS })
      .where(eq(refreshTokens.id, row.id));
    return { houseId: row.houseId, id: row.id };
  }

  async ownerOfTombstone(token: string): Promise<string | null> {
    const tokenHash = await hashToken(token);
    const row = await this.db.query.refreshTokens.findFirst({
      where: and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.rotatedFrom, TOMBSTONE)),
    });
    return row?.houseId ?? null;
  }

  async revokeAll(houseId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.houseId, houseId));
  }

  async pruneExpired(nowMs: number): Promise<number> {
    const r = await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, nowMs));
    return r.meta.changes;
  }
}
