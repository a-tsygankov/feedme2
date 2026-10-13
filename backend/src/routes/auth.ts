import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { HouseNameSchema, LoginBodySchema, PinChangeBodySchema, RefreshBodySchema, SetupBodySchema } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { isUniqueViolation } from "../db/errors.ts";
import { verifyPin } from "../auth/pin.ts";
import { clock, signAccessToken } from "../auth/tokens.ts";
import { issueTokens, type HouseRow } from "../auth/issue.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { RefreshTokensRepo } from "../repos/refresh-tokens.ts";
import { validationHook } from "../validation.ts";
import { log } from "../logger.ts";

type Env = { Bindings: Bindings } & AuthVars;

const UNAUTHORIZED = { error: "unauthorized" } as const;

// Burn the same PBKDF2 work for an unknown or pinless house as for a real
// one, so response time does not reveal which house names exist. Valid
// hex of the right length (16-byte salt, 32-byte hash); never matches.
const DUMMY_SALT = "00112233445566778899aabbccddeeff";
const DUMMY_HASH = "0".repeat(64);

/**
 * test-login mints a session with no PIN, so it must fail closed: only
 * the two environments that are explicitly non-production enable it. An
 * unset, misspelt or future ENVIRONMENT value (e.g. a new `[env.staging]`
 * block that forgot to set it) leaves it off.
 */
export function testAuthEnabled(env: Bindings): boolean {
  return env.ENVIRONMENT === "development" || env.ENVIRONMENT === "test";
}

export const authRouter = new Hono<Env>()
  .post("/setup", zValidator("json", SetupBodySchema, validationHook), async (c) => {
    const { houseName, pin } = c.req.valid("json");
    const now = clock.now();
    // A weak AUTH_SECRET makes signing throw. Find out now, before the
    // insert, so a misconfigured deploy cannot leave behind a house whose
    // owner never received tokens (and whose name is then taken).
    await signAccessToken("probe", c.env.AUTH_SECRET, now);
    const houses = new HousesRepo(db(c.env.DB));
    let house: HouseRow;
    try {
      house = await houses.create(houseName, pin, now);
    } catch (err) {
      if (isUniqueViolation(err)) return c.json({ error: "name taken" }, 409);
      throw err;
    }
    log.info("house created", { houseId: house.id });
    return c.json(await issueTokens(c.env, house, now), 201);
  })

  .post("/login", zValidator("json", LoginBodySchema, validationHook), async (c) => {
    const { houseName, pin } = c.req.valid("json");
    const house = await new HousesRepo(db(c.env.DB)).findByName(houseName);
    const hasPin = !!house && house.pinHash !== "";
    // Always run the hash (spec §3.2: uniform cost and uniform body for
    // unknown house, pinless house and wrong pin).
    const matched = await verifyPin(pin, hasPin ? house.pinSalt : DUMMY_SALT, hasPin ? house.pinHash : DUMMY_HASH);
    if (!house || !hasPin || !matched) return c.json(UNAUTHORIZED, 401);
    return c.json(await issueTokens(c.env, house, clock.now()));
  })

  .post("/refresh", zValidator("json", RefreshBodySchema, validationHook), async (c) => {
    const { refreshToken } = c.req.valid("json");
    const repo = new RefreshTokensRepo(db(c.env.DB));
    const now = clock.now();
    const result = await repo.consume(refreshToken, now);
    if (result.kind === "unknown" || result.kind === "expired") return c.json(UNAUTHORIZED, 401);
    if (result.kind === "replayed") {
      // A token spent long ago is back: assume it leaked and sign the
      // whole house out. (Within the grace window it is a retry instead.)
      log.warn("refresh token replayed; revoking house sessions", { houseId: result.houseId });
      await repo.revokeAll(result.houseId);
      return c.json(UNAUTHORIZED, 401);
    }
    const house = await new HousesRepo(db(c.env.DB)).findById(result.houseId);
    if (!house) return c.json(UNAUTHORIZED, 401);
    // grace: a fresh child for the same house, nothing revoked, so a lost
    // response or a second tab recovers instead of being signed out. Both
    // kinds chain the child to the presented token.
    if (result.kind === "grace") log.info("refresh grace", { houseId: result.houseId });
    return c.json(await issueTokens(c.env, house, now, result.id));
  })

  .post("/logout", requireHouse(), zValidator("json", RefreshBodySchema, validationHook), async (c) => {
    // Only this device's session: other phones of the house stay signed in.
    await new RefreshTokensRepo(db(c.env.DB)).revokeOne(c.var.houseId, c.req.valid("json").refreshToken);
    return c.body(null, 204);
  })

  .get("/me", requireHouse(), async (c) => {
    const house = await new HousesRepo(db(c.env.DB)).findById(c.var.houseId);
    if (!house) return c.json(UNAUTHORIZED, 401);
    return c.json({ house: toApiHouse(house) });
  })

  .patch("/pin", requireHouse(), zValidator("json", PinChangeBodySchema, validationHook), async (c) => {
    const { currentPin, newPin } = c.req.valid("json");
    const d = db(c.env.DB);
    const repo = new HousesRepo(d);
    const house = await repo.findById(c.var.houseId);
    if (!house) return c.json(UNAUTHORIZED, 401);
    // A pinless house exists only through the dev/e2e test-login, so there is
    // no current PIN to prove: the first PIN can be set without one (the body
    // schema still wants a well-formed currentPin, which is ignored here).
    // 403, not 401: the webapp reads any 401 as an expired session and
    // signs out, which a mistyped current PIN must not do.
    const pinless = house.pinHash === "";
    if (!pinless && !(await verifyPin(currentPin, house.pinSalt, house.pinHash))) return c.json({ error: "wrong_pin" }, 403);
    const now = clock.now();
    await repo.setPin(house.id, newPin, now);
    // Other devices must sign in again with the new pin; so must this one,
    // which is why it gets a fresh session back instead of a dead refresh token.
    await new RefreshTokensRepo(d).revokeAll(house.id);
    const updated = await repo.findById(house.id);
    return c.json(await issueTokens(c.env, updated ?? house, now));
  })

  // Development/e2e only: a house with no pin, found-or-created by name.
  .post("/test-login", zValidator("json", z.object({ houseName: HouseNameSchema }), validationHook), async (c) => {
    if (!testAuthEnabled(c.env)) return c.json({ error: "not found" }, 404);
    const { houseName } = c.req.valid("json");
    const repo = new HousesRepo(db(c.env.DB));
    const now = clock.now();
    const existing = await repo.findByName(houseName);
    // Never a PIN bypass: a house that has a pin cannot be entered this way.
    if (existing && existing.pinHash !== "") return c.json({ error: "not found" }, 404);
    const house = existing ?? (await repo.create(houseName, null, now));
    return c.json(await issueTokens(c.env, house, now));
  });
