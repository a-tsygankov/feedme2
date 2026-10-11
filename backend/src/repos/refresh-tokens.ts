import { and, eq, gt, isNull, lt, ne, or } from "drizzle-orm";
import type { Db } from "../db/client.ts";
import { refreshTokens } from "../db/schema.ts";
import { REFRESH_TTL_MS, hashToken, mintRefreshToken } from "../auth/tokens.ts";

/**
 * - ok:       first use of a live token; the caller issues the child.
 * - grace:    a token consumed < GRACE_MS ago, presented again (a lost
 *             response, a second tab). Issue a fresh child (rotated_from =
 *             the presented token's id, like ok), revoke nothing.
 * - replayed: a token consumed longer ago. Likely stolen: the caller
 *             revokes the house's whole chain.
 * - expired:  a live token past its 30 days (row deleted).
 * - unknown:  never issued, revoked, or pruned.
 */
export type ConsumeResult =
  | { kind: "ok"; houseId: string; id: string }
  | { kind: "grace"; houseId: string; id: string }
  | { kind: "replayed"; houseId: string }
  | { kind: "expired" }
  | { kind: "unknown" };

const TOMBSTONE = "tombstone";
/** How long a consumed token's hash is kept so a replay can be attributed. */
const TOMBSTONE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * A rotation response can be lost (flaky mobile link) or two tabs can
 * refresh at once; both present the same token twice within seconds.
 * Treating that as theft would sign the family out, so a re-presentation
 * this soon after consumption just gets a fresh child. Trade-off: a stolen
 * token presented within 60 s of the legitimate rotation also gets a child;
 * bounded by the window, accepted for the sake of lost-response recovery.
 */
export const GRACE_MS = 60_000;

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

  /**
   * Live token → consumed: the row stays as a tombstone (rotated_from =
   * 'tombstone', expires_at = consumed time + 24 h) so a later replay can
   * be attributed to a house.
   *
   * The transition is ONE conditional UPDATE ... RETURNING, so two
   * concurrent requests with the same token cannot both win ("ok"): SQLite
   * serialises the statements and the loser matches zero rows. A
   * read-then-write here would let both be "ok". The losers are not
   * rejected though: inside GRACE_MS each gets its own "grace" child, by
   * design (lost response / second tab), so one parent can end up with
   * several live children. Only the losing path reads afterwards.
   */
  async consume(token: string, nowMs: number): Promise<ConsumeResult> {
    const tokenHash = await hashToken(token);
    const [won] = await this.db
      .update(refreshTokens)
      .set({ rotatedFrom: TOMBSTONE, expiresAt: nowMs + TOMBSTONE_TTL_MS })
      .where(
        and(
          eq(refreshTokens.tokenHash, tokenHash),
          or(isNull(refreshTokens.rotatedFrom), ne(refreshTokens.rotatedFrom, TOMBSTONE)),
          gt(refreshTokens.expiresAt, nowMs),
        ),
      )
      .returning({ id: refreshTokens.id, houseId: refreshTokens.houseId });
    if (won) return { kind: "ok", houseId: won.houseId, id: won.id };

    const row = await this.db.query.refreshTokens.findFirst({ where: eq(refreshTokens.tokenHash, tokenHash) });
    if (!row) return { kind: "unknown" };
    if (row.rotatedFrom === TOMBSTONE) {
      const consumedAt = row.expiresAt - TOMBSTONE_TTL_MS;
      return nowMs - consumedAt <= GRACE_MS ? { kind: "grace", houseId: row.houseId, id: row.id } : { kind: "replayed", houseId: row.houseId };
    }
    // A live row that lapsed: nothing to attribute, drop it.
    await this.db.delete(refreshTokens).where(eq(refreshTokens.id, row.id));
    return { kind: "expired" };
  }

  /**
   * Removes the presented token, and only if it belongs to `houseId`, plus
   * the children minted from it (rotated_from = its id). A client that
   * signs out with a token it read before apiFetch refreshed it presents the
   * already-consumed parent; without the children delete, the child that
   * refresh minted (which the client never saw stored) would stay live as an
   * orphaned session. Other phones' chains are separate roots and stay.
   */
  async revokeOne(houseId: string, token: string): Promise<void> {
    const tokenHash = await hashToken(token);
    const row = await this.db.query.refreshTokens.findFirst({
      where: and(eq(refreshTokens.tokenHash, tokenHash), eq(refreshTokens.houseId, houseId)),
    });
    if (!row) return;
    await this.db.batch([
      this.db.delete(refreshTokens).where(eq(refreshTokens.id, row.id)),
      this.db.delete(refreshTokens).where(and(eq(refreshTokens.rotatedFrom, row.id), eq(refreshTokens.houseId, houseId))),
    ]);
  }

  async revokeAll(houseId: string): Promise<void> {
    await this.db.delete(refreshTokens).where(eq(refreshTokens.houseId, houseId));
  }

  async pruneExpired(nowMs: number): Promise<number> {
    const r = await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, nowMs));
    return r.meta.changes;
  }
}
