import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../env.ts";
import { verifyDeviceToken } from "../auth/device-tokens.ts";
import { db } from "../db/client.ts";
import type { devices } from "../db/schema.ts";
import { DevicesRepo, TOUCH_INTERVAL_MS } from "../repos/devices.ts";
import { clock } from "../auth/tokens.ts";
import { setRequestOrigin } from "../request-context.ts";
import { log } from "../logger.ts";

export type DeviceVars = { Variables: { houseId: string; deviceId: string; device: typeof devices.$inferSelect } };

/**
 * Bearer device token → c.var.houseId + c.var.deviceId + c.var.device. The
 * token says which device and which pairing (jti); the devices row says whether
 * it is still welcome: not revoked, in the same house, and issued by the
 * *latest* pairing. Without the jti check, forget → re-pair revived every
 * token the device ever held. Uniform 401s, like requireHouse.
 */
export function requireDevice(): MiddlewareHandler<{ Bindings: Bindings } & DeviceVars> {
  return async (c, next) => {
    const token = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("Authorization") ?? "")?.[1] ?? "";
    const claims = token ? await verifyDeviceToken(token, c.env.AUTH_SECRET) : null;
    if (!claims) return c.json({ error: "unauthorized" }, 401);
    const repo = new DevicesRepo(db(c.env.DB));
    const row = await repo.getAny(claims.deviceId);
    if (!row || row.revokedAt !== null || row.houseId !== claims.houseId || row.tokenId !== claims.tokenId) return c.json({ error: "unauthorized" }, 401);
    // Only now is the request the house's: logs written before this point stay anonymous.
    setRequestOrigin({ houseId: row.houseId, deviceId: row.id });
    c.set("houseId", row.houseId);
    c.set("deviceId", row.id);
    c.set("device", row);
    const now = clock.now();
    // The heartbeat handler writes last_seen_at itself, with the fields it reports.
    if (!c.req.path.endsWith("/heartbeat") && (row.lastSeenAt === null || now - row.lastSeenAt >= TOUCH_INTERVAL_MS)) {
      // Presence is best effort: a failed touch must not turn an authenticated call into a 500.
      try {
        await repo.touch(row.id, now);
      } catch (err) {
        log.warn("device touch failed", { deviceId: row.id, error: err instanceof Error ? err.message.slice(0, 200) : String(err) });
      }
    }
    await next();
  };
}
