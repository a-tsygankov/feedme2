import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "../src/db/client.ts";
import { refreshTokens } from "../src/db/schema.ts";
import { eq } from "drizzle-orm";
import { hashToken } from "../src/auth/tokens.ts";
import { HousesRepo } from "../src/repos/houses.ts";
import { RefreshTokensRepo } from "../src/repos/refresh-tokens.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
let n = 0;

async function newHouse(): Promise<string> {
  return (await new HousesRepo(db(env.DB)).create(`Repo House ${++n} ${Date.now()}`, null, 0)).id;
}

describe("RefreshTokensRepo.consume", () => {
  beforeAll(applyAllMigrations);

  it("consumes a live token once, then reports grace inside 60 s and replayed after", async () => {
    const repo = new RefreshTokensRepo(db(env.DB));
    const houseId = await newHouse();
    const t0 = 1_000_000;
    const { token, id } = await repo.issue(houseId, t0);

    expect(await repo.consume(token, t0 + 1000)).toEqual({ kind: "ok", houseId, id });
    // A lost response or a second tab: same token again, soon after.
    expect(await repo.consume(token, t0 + 1000 + 5_000)).toEqual({ kind: "grace", houseId, id });
    // The grace window is anchored at the first consume, not extended by retries.
    expect(await repo.consume(token, t0 + 1000 + 59_000)).toEqual({ kind: "grace", houseId, id });
    expect(await repo.consume(token, t0 + 1000 + 120_000)).toEqual({ kind: "replayed", houseId });
  });

  it("never lets two concurrent consumes both win", async () => {
    const repo = new RefreshTokensRepo(db(env.DB));
    const houseId = await newHouse();
    const { token } = await repo.issue(houseId, 0);
    const results = await Promise.all([repo.consume(token, 10), repo.consume(token, 10), repo.consume(token, 10)]);
    expect(results.filter((r) => r.kind === "ok")).toHaveLength(1);
  });

  it("returns unknown for a token we never issued", async () => {
    expect(await new RefreshTokensRepo(db(env.DB)).consume("nope", 0)).toEqual({ kind: "unknown" });
  });

  it("returns expired for a lapsed live token and deletes its row", async () => {
    const d = db(env.DB);
    const repo = new RefreshTokensRepo(d);
    const houseId = await newHouse();
    const { token } = await repo.issue(houseId, 0);
    const far = 31 * DAY;
    expect(await repo.consume(token, far)).toEqual({ kind: "expired" });
    const rows = await d.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, await hashToken(token)));
    expect(rows).toHaveLength(0);
    expect(await repo.consume(token, far)).toEqual({ kind: "unknown" });
  });

  it("revokeOne removes only the presented token of that house", async () => {
    const repo = new RefreshTokensRepo(db(env.DB));
    const a = await newHouse();
    const b = await newHouse();
    const ta = await repo.issue(a, 0);
    const ta2 = await repo.issue(a, 0);
    const tb = await repo.issue(b, 0);
    await repo.revokeOne(b, ta.token); // wrong house: no effect
    expect((await repo.consume(ta.token, 1)).kind).toBe("ok");
    await repo.revokeOne(a, ta2.token);
    expect(await repo.consume(ta2.token, 1)).toEqual({ kind: "unknown" });
    expect((await repo.consume(tb.token, 1)).kind).toBe("ok");
  });
});

describe("RefreshTokensRepo.pruneExpired", () => {
  beforeAll(applyAllMigrations);

  it("keeps a tombstone for 24 h after consumption, then removes it; live tokens stay", async () => {
    const d = db(env.DB);
    const repo = new RefreshTokensRepo(d);
    const houseId = await newHouse();
    const consumedAt = 5_000_000;
    const { token } = await repo.issue(houseId, 0);
    const live = await repo.issue(houseId, consumedAt);
    expect((await repo.consume(token, consumedAt)).kind).toBe("ok");
    const has = async (t: string) =>
      (await d.select().from(refreshTokens).where(eq(refreshTokens.tokenHash, await hashToken(t)))).length === 1;

    await repo.pruneExpired(consumedAt + DAY - 1);
    expect(await has(token)).toBe(true);
    expect(await has(live.token)).toBe(true);
    await repo.pruneExpired(consumedAt + DAY + 1);
    expect(await has(token)).toBe(false);
    expect(await has(live.token)).toBe(true);
  });
});
