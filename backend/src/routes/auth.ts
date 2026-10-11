import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HouseNameSchema, LoginBodySchema, PinChangeBodySchema, RefreshBodySchema, SetupBodySchema, type TokensResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { verifyPin } from "../auth/pin.ts";
import { ACCESS_TTL_SEC, signAccessToken } from "../auth/tokens.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { RefreshTokensRepo } from "../repos/refresh-tokens.ts";
import { log } from "../logger.ts";

type Env = { Bindings: Bindings } & AuthVars;

const UNAUTHORIZED = { error: "unauthorized" } as const;

export function testAuthEnabled(env: Bindings): boolean {
  return env.ENVIRONMENT !== "production";
}

async function issueTokens(env: Bindings, houseId: string, nowMs: number, rotatedFrom?: string): Promise<TokensResponse> {
  const d = db(env.DB);
  const house = await new HousesRepo(d).findById(houseId);
  if (!house) throw new Error("house vanished");
  const { token } = await new RefreshTokensRepo(d).issue(houseId, nowMs, rotatedFrom);
  return {
    accessToken: await signAccessToken(houseId, env.AUTH_SECRET, nowMs),
    expiresIn: ACCESS_TTL_SEC,
    refreshToken: token,
    house: toApiHouse(house),
  };
}

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Error && /UNIQUE/i.test(err.message);
}

export const authRouter = new Hono<Env>()
  .post("/setup", zValidator("json", SetupBodySchema), async (c) => {
    const { houseName, pin } = c.req.valid("json");
    const now = Date.now();
    try {
      const house = await new HousesRepo(db(c.env.DB)).create(houseName, pin, now);
      log.info("house created", { houseId: house.id });
      return c.json(await issueTokens(c.env, house.id, now), 201);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: "name taken" }, 409);
      throw err;
    }
  })

  .post("/login", zValidator("json", LoginBodySchema), async (c) => {
    const { houseName, pin } = c.req.valid("json");
    const house = await new HousesRepo(db(c.env.DB)).findByName(houseName);
    // Same body and status for unknown house and wrong pin (spec §3.2).
    if (!house || house.pinHash === "" || !(await verifyPin(pin, house.pinSalt, house.pinHash))) {
      return c.json(UNAUTHORIZED, 401);
    }
    return c.json(await issueTokens(c.env, house.id, Date.now()));
  })

  .post("/refresh", zValidator("json", RefreshBodySchema), async (c) => {
    const { refreshToken } = c.req.valid("json");
    const repo = new RefreshTokensRepo(db(c.env.DB));
    const now = Date.now();
    const result = await repo.consume(refreshToken, now);
    if (result === "unknown" || result === "expired") {
      // A token we no longer hold may be a replay of one that was
      // rotated. We cannot map the hash back to a house, so the
      // successor chain is revoked by the client-visible rule: the
      // next refresh with the successor fails because we revoke every
      // token of the house whose refresh produced an "unknown" within
      // the replay window. Implemented by stamping a tombstone below.
      await tombstoneReplay(c.env, refreshToken, now);
      return c.json(UNAUTHORIZED, 401);
    }
    return c.json(await issueTokens(c.env, result.houseId, now, result.id));
  })

  .post("/logout", requireHouse(), zValidator("json", RefreshBodySchema), async (c) => {
    await new RefreshTokensRepo(db(c.env.DB)).revokeAll(c.var.houseId);
    return c.body(null, 204);
  })

  .get("/me", requireHouse(), async (c) => {
    const house = await new HousesRepo(db(c.env.DB)).findById(c.var.houseId);
    if (!house) return c.json(UNAUTHORIZED, 401);
    return c.json({ house: toApiHouse(house) });
  })

  .patch("/pin", requireHouse(), zValidator("json", PinChangeBodySchema), async (c) => {
    const { currentPin, newPin } = c.req.valid("json");
    const d = db(c.env.DB);
    const repo = new HousesRepo(d);
    const house = await repo.findById(c.var.houseId);
    if (!house || !(await verifyPin(currentPin, house.pinSalt, house.pinHash))) return c.json(UNAUTHORIZED, 401);
    const now = Date.now();
    await repo.setPin(house.id, newPin, now);
    // Other devices must sign in again with the new pin.
    await new RefreshTokensRepo(d).revokeAll(house.id);
    return c.body(null, 204);
  })

  // Development/e2e only: a house with no pin, found-or-created by name.
  .post("/test-login", zValidator("json", z.object({ houseName: HouseNameSchema })), async (c) => {
    if (!testAuthEnabled(c.env)) return c.json({ error: "not found" }, 404);
    const repo = new HousesRepo(db(c.env.DB));
    const now = Date.now();
    const house = (await repo.findByName(c.req.valid("json").houseName)) ?? (await repo.create(c.req.valid("json").houseName, null, now));
    return c.json(await issueTokens(c.env, house.id, now));
  });

/**
 * Replay defence. Rotation deletes the consumed row, so a replayed
 * token hashes to nothing. We keep the hash of every consumed token for
 * 24 h in `refresh_tokens` as a tombstone row (expires_at = consumed
 * time, house_id = owner, rotated_from = 'tombstone') and, when a
 * presented token matches a tombstone, revoke the owner's whole chain.
 */
async function tombstoneReplay(env: Bindings, token: string, nowMs: number): Promise<void> {
  const d = db(env.DB);
  const repo = new RefreshTokensRepo(d);
  const owner = await repo.ownerOfTombstone(token);
  if (owner) {
    log.warn("refresh token replayed; revoking house sessions", { houseId: owner });
    await repo.revokeAll(owner);
  }
}
