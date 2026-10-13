import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { LOGIN_QR_TTL_SEC, LoginQrBodySchema, type LoginTokenCreateResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db } from "../db/client.ts";
import { issueTokens } from "../auth/issue.ts";
import { clock } from "../auth/tokens.ts";
import { publicBodyLimit } from "../middleware/body-limit.ts";
import { requireDevice, type DeviceVars } from "../middleware/device.ts";
import { DevicesRepo } from "../repos/devices.ts";
import { HousesRepo } from "../repos/houses.ts";
import { LoginQrTokensRepo } from "../repos/login-qr-tokens.ts";
import { validationHook } from "../validation.ts";
import { log } from "../logger.ts";

const UNAUTHORIZED = { error: "unauthorized" } as const;

/**
 * QR login (spec §3.3, §5.2), mounted at /api/auth next to authRouter: a paired device mints a 60-second,
 * one-time token and shows it as a QR; the phone that opens it is signed into the device's house.
 * The token travels only in request/response bodies, never a query string, so the request logger (which
 * prints the path) never sees it.
 */
export const loginQrRouter = new Hono<{ Bindings: Bindings } & DeviceVars>()
  .post("/login-token-create", requireDevice(), async (c) => {
    // House and device come from requireDevice (verified token + live devices row), never from the request.
    const token = await new LoginQrTokensRepo(db(c.env.DB)).create(c.var.deviceId, c.var.houseId, clock.now());
    log.info("qr login token created", { deviceId: c.var.deviceId });
    const body: LoginTokenCreateResponse = { token, expiresInSec: LOGIN_QR_TTL_SEC };
    return c.json(body);
  })

  .post("/login-qr", publicBodyLimit, zValidator("json", LoginQrBodySchema, validationHook), async (c) => {
    const { deviceId, token } = c.req.valid("json");
    const d = db(c.env.DB);
    const now = clock.now();
    // Every failure is the same 401 (unknown, expired, used, other device, device gone) so the endpoint is no
    // oracle for which tokens or devices exist.
    const claimed = await new LoginQrTokensRepo(d).consume(deviceId, token, now);
    if (!claimed) return c.json(UNAUTHORIZED, 401);
    // The device may have been forgotten (or re-paired elsewhere) within the 60 s: the token then signs no one in.
    const device = await new DevicesRepo(d).getAny(deviceId);
    if (!device || device.revokedAt !== null || device.houseId !== claimed.houseId) return c.json(UNAUTHORIZED, 401);
    const house = await new HousesRepo(d).findById(claimed.houseId);
    if (!house) return c.json(UNAUTHORIZED, 401);
    log.info("qr login", { houseId: house.id, deviceId });
    return c.json(await issueTokens(c.env, house, now));
  });
