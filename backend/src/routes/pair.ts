import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { PairCheckBodySchema, PairConfirmBodySchema, PairStartBodySchema, type PairCheckResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { signDeviceToken } from "../auth/device-tokens.ts";
import { clock, hashToken } from "../auth/tokens.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { publicBodyLimit } from "../middleware/body-limit.ts";
import { DevicesRepo, toApiDevice } from "../repos/devices.ts";
import { HousesRepo } from "../repos/houses.ts";
import { PAIR_POLL_SEC, PAIR_REDELIVER_MS, PairingsRepo } from "../repos/pairings.ts";
import { validationHook } from "../validation.ts";
import { log } from "../logger.ts";

type Env = { Bindings: Bindings } & AuthVars;

/**
 * Pairing (spec §3.3, §5.2): the device shows a 6-digit code; a signed-in
 * person types it into the web app; the device polls until the token
 * appears. /start and /check are public (the device has no credentials
 * yet). /check serves the token only to the holder of the poll secret the
 * device chose at /start, and only for a short delivery window.
 */
export const pairRouter = new Hono<Env>()
  .post("/start", publicBodyLimit, zValidator("json", PairStartBodySchema, validationHook), async (c) => {
    const { deviceId, hwModel, fwVersion, pollSecret } = c.req.valid("json");
    const { pairCode, expiresAt } = await new PairingsRepo(db(c.env.DB)).start(deviceId, hwModel, fwVersion, await hashToken(pollSecret), clock.now());
    log.info("pair start", { deviceId, hwModel, fwVersion });
    return c.json({ pairCode, expiresAt, pollAfterSec: PAIR_POLL_SEC });
  })
  .post("/check", publicBodyLimit, zValidator("json", PairCheckBodySchema, validationHook), async (c) => {
    const { deviceId, pollSecret } = c.req.valid("json");
    const d = db(c.env.DB);
    const repo = new PairingsRepo(d);
    const row = await repo.findByDevice(deviceId);
    const now = clock.now();
    let body: PairCheckResponse;
    if (!row) body = { status: "unknown" };
    // The device id is not a secret (it is in logs and on the sticker), so without this anyone could poll
    // /check for a device that is being paired and collect its token. A stranger learns nothing but "pending".
    // The hashes are compared directly: the compared value is a SHA-256 of a 128-bit secret, so a timing
    // difference tells an attacker nothing they could turn into a preimage.
    else if (row.pollSecretHash !== (await hashToken(pollSecret))) body = { status: "pending" };
    // Expiry before everything else: a confirmed row past its grace is expired, token or not.
    else if (row.expiresAt <= now) {
      if (row.deviceToken !== null) await repo.wipeToken(deviceId);
      body = { status: "expired" };
    } else if (row.confirmedAt !== null) {
      const windowClosed = row.deliveredAt !== null && now - row.deliveredAt > PAIR_REDELIVER_MS;
      if (!row.deviceToken || !row.houseId || windowClosed) {
        // Delivered long enough ago: the plaintext token is not kept for a later reader.
        if (row.deviceToken !== null) await repo.wipeToken(deviceId);
        body = { status: "expired" };
      } else {
        const house = await new HousesRepo(d).findById(row.houseId);
        const device = await new DevicesRepo(d).getAny(deviceId);
        body = { status: "confirmed", deviceToken: row.deviceToken, houseId: row.houseId, houseName: house?.name ?? "", deviceName: device?.name ?? "" };
        if (row.deliveredAt === null) await repo.markDelivered(deviceId, now);
      }
    } else body = { status: "pending" };
    return c.json(body);
  })
  .post("/confirm", requireHouse(), zValidator("json", PairConfirmBodySchema, validationHook), async (c) => {
    const { pairCode, name } = c.req.valid("json");
    const houseId = c.var.houseId;
    const d = db(c.env.DB);
    const pairings = new PairingsRepo(d);
    const now = clock.now();
    // A signed-in account could otherwise walk the 6-digit space to confirm someone else's pending device.
    const wait = await pairings.confirmBlockedForSec(houseId, now);
    if (wait !== null) {
      c.header("Retry-After", String(wait));
      return c.json({ error: "too_many_attempts", retryAfterSec: wait }, 429);
    }
    const failed = async (status: 404 | 409, error: "pair_code_unknown" | "pair_code_used" | "device_in_use") => {
      await pairings.recordConfirmFailure(houseId, now);
      return c.json({ error }, status);
    };
    const row = await pairings.findByCode(pairCode);
    if (!row || row.expiresAt <= now) return failed(404, "pair_code_unknown");
    if (row.confirmedAt !== null) return failed(409, "pair_code_used");
    // The token needs the device id, which only the code knows, so it is signed before the claim. Its id is
    // fresh per pairing: it is what makes every token from an earlier pairing of this device stop working.
    const tokenId = crypto.randomUUID();
    const token = await signDeviceToken(houseId, row.deviceId, tokenId, c.env.AUTH_SECRET, now);
    const claimed = await pairings.claim(pairCode, row.deviceId, houseId, token, now);
    if (!claimed) {
      // Lost the race (or the code expired / was replaced since the read): answer from the current state.
      const now2 = await pairings.findByCode(pairCode);
      if (!now2 || now2.deviceId !== row.deviceId || (now2.confirmedAt === null && now2.expiresAt <= now)) return failed(404, "pair_code_unknown");
      return failed(409, "pair_code_used");
    }
    const release = () => pairings.release(claimed.deviceId, now, row.expiresAt);
    let device;
    try {
      device = await new DevicesRepo(d).upsertPaired(
        { id: claimed.deviceId, houseId, name: name ?? `Device ${claimed.deviceId.slice(-4)}`, hwModel: claimed.hwModel, fwVersion: claimed.fwVersion, tokenId },
        now,
      );
    } catch (err) {
      await release();
      throw err;
    }
    // A device still live in another house cannot be stolen by knowing its pair code; the other house must
    // forget it first. The claim is given back so the code still works once that has happened.
    if (!device) {
      await release();
      return failed(409, "device_in_use");
    }
    log.info("pair confirmed", { deviceId: claimed.deviceId });
    return c.json({ device: toApiDevice(device) }, 201);
  });
