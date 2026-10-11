import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { PairCheckBodySchema, PairConfirmBodySchema, PairStartBodySchema, type PairCheckResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { signDeviceToken } from "../auth/device-tokens.ts";
import { clock } from "../auth/tokens.ts";
import { requireHouse, type AuthVars } from "../middleware/auth.ts";
import { DevicesRepo, toApiDevice } from "../repos/devices.ts";
import { HousesRepo } from "../repos/houses.ts";
import { PAIR_POLL_SEC, PairingsRepo } from "../repos/pairings.ts";
import { validationHook } from "../validation.ts";
import { log } from "../logger.ts";

type Env = { Bindings: Bindings } & AuthVars;

/**
 * Pairing (spec §3.3, §5.2): the device shows a 6-digit code; a signed-in
 * person types it into the web app; the device polls until the token
 * appears. /start and /check are public (the device has no credentials
 * yet) and leak nothing but the device's own pairing status.
 */
export const pairRouter = new Hono<Env>()
  .post("/start", zValidator("json", PairStartBodySchema, validationHook), async (c) => {
    const { deviceId, hwModel, fwVersion } = c.req.valid("json");
    const { pairCode, expiresAt } = await new PairingsRepo(db(c.env.DB)).start(deviceId, hwModel, fwVersion, clock.now());
    log.info("pair start", { deviceId, hwModel, fwVersion });
    return c.json({ pairCode, expiresAt, pollAfterSec: PAIR_POLL_SEC });
  })
  .post("/check", zValidator("json", PairCheckBodySchema, validationHook), async (c) => {
    const { deviceId } = c.req.valid("json");
    const d = db(c.env.DB);
    const repo = new PairingsRepo(d);
    const row = await repo.findByDevice(deviceId);
    const now = clock.now();
    let body: PairCheckResponse;
    if (!row) body = { status: "unknown" };
    else if (row.confirmedAt !== null && row.deviceToken && row.houseId) {
      const house = await new HousesRepo(d).findById(row.houseId);
      const device = await new DevicesRepo(d).getAny(deviceId);
      body = { status: "confirmed", deviceToken: row.deviceToken, houseId: row.houseId, houseName: house?.name ?? "", deviceName: device?.name ?? "" };
      if (row.deliveredAt === null) await repo.markDelivered(deviceId, now);
    } else if (row.expiresAt <= now) body = { status: "expired" };
    else body = { status: "pending" };
    return c.json(body);
  })
  .post("/confirm", requireHouse(), zValidator("json", PairConfirmBodySchema, validationHook), async (c) => {
    const { pairCode, name } = c.req.valid("json");
    const houseId = c.var.houseId;
    const d = db(c.env.DB);
    const pairings = new PairingsRepo(d);
    const now = clock.now();
    const row = await pairings.findByCode(pairCode);
    if (!row || row.expiresAt <= now) return c.json({ error: "pair_code_unknown" }, 404);
    if (row.confirmedAt !== null) return c.json({ error: "pair_code_used" }, 409);
    const devices = new DevicesRepo(d);
    const existing = await devices.getAny(row.deviceId);
    // A device still live in another house cannot be stolen by knowing its
    // pair code; the other house must forget it first (Review Focus 5).
    if (existing && existing.revokedAt === null && existing.houseId !== houseId) return c.json({ error: "device_in_use" }, 409);
    const deviceName = name ?? existing?.name ?? `Device ${row.deviceId.slice(-4)}`;
    const token = await signDeviceToken(houseId, row.deviceId, c.env.AUTH_SECRET, now);
    const device = await devices.upsertPaired({ id: row.deviceId, houseId, name: deviceName, hwModel: row.hwModel, fwVersion: row.fwVersion }, now);
    await pairings.confirm(row.deviceId, houseId, token, now);
    log.info("pair confirmed", { deviceId: row.deviceId });
    return c.json({ device: toApiDevice(device) }, 201);
  });
