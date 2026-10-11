import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../env.ts";
import { verifyDeviceToken } from "../auth/device-tokens.ts";
import { db } from "../db/client.ts";
import { DevicesRepo, TOUCH_INTERVAL_MS } from "../repos/devices.ts";
import { clock } from "../auth/tokens.ts";

export type DeviceVars = { Variables: { houseId: string; deviceId: string } };

/**
 * Bearer device token → c.var.houseId + c.var.deviceId. The token says
 * which device; the devices row says whether it is still welcome
 * (revoked_at) and in which house (a re-paired device's old token names
 * the old house and must die). Uniform 401s, like requireHouse.
 */
export function requireDevice(): MiddlewareHandler<{ Bindings: Bindings } & DeviceVars> {
  return async (c, next) => {
    const token = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("Authorization") ?? "")?.[1] ?? "";
    const claims = token ? await verifyDeviceToken(token, c.env.AUTH_SECRET) : null;
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    const repo = new DevicesRepo(db(c.env.DB));
    const row = await repo.getAny(claims.deviceId);
    if (!row || row.revokedAt !== null || row.houseId !== claims.houseId) return c.json({ error: "unauthorized" }, 401);
    c.set("houseId", row.houseId);
    c.set("deviceId", row.id);
    const now = clock.now();
    if (row.lastSeenAt === null || now - row.lastSeenAt >= TOUCH_INTERVAL_MS) await repo.touch(row.id, now);
    await next();
  };
}
