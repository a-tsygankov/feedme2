import { Hono } from "hono";
import type { DeviceState } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db, type Db } from "../db/client.ts";
import { clock } from "../auth/tokens.ts";
import { requireDevice, type DeviceVars } from "../middleware/device.ts";
import { CatsRepo, toApiCat } from "../repos/cats.ts";
import { DevicesRepo } from "../repos/devices.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { tzOffsetMin } from "../time.ts";

type Env = { Bindings: Bindings } & DeviceVars;

async function weakEtag(stable: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable)));
  return `W/"${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/**
 * The one device read (spec §3.3, §5.3): everything the Idle/Amount
 * screens need in one round trip. The ETag covers the parts that change
 * when a person does something (settings, cats, defaults, device name)
 * and deliberately excludes `now` and the tz offset, so a device that
 * polls on its timer gets 304s until something it displays changed.
 */
export async function buildDeviceState(d: Db, houseId: string, deviceId: string, nowMs: number): Promise<{ body: DeviceState; etag: string }> {
  const houseRow = (await new HousesRepo(d).findById(houseId))!;
  const house = toApiHouse(houseRow);
  const device = (await new DevicesRepo(d).getAny(deviceId))!;
  const cats = (await new CatsRepo(d).list(houseId)).map(toApiCat).map((c) => ({
    id: c.id, name: c.name, color: c.color, avatarPose: c.avatarPose, hungryAfterSec: c.hungryAfterSec, sortOrder: c.sortOrder,
    defaultAmountMg: c.defaultAmountMg, defaultEnteredUnit: c.defaultEnteredUnit, defaultEnteredValue: c.defaultEnteredValue, lastFedAt: c.lastFedAt,
  }));
  const stable = { house: { id: house.id, name: house.name, settings: house.settings }, device: { id: device.id, name: device.name }, cats };
  const etag = await weakEtag(stable);
  const body: DeviceState = {
    house: { ...stable.house, tzOffsetMin: tzOffsetMin(house.settings.timezone, nowMs) },
    device: stable.device,
    cats,
    now: nowMs,
    syncIntervalSec: house.settings.syncIntervalSec,
    sleepTimeoutSec: house.settings.sleepTimeoutSec,
  };
  return { body, etag };
}

export const deviceRouter = new Hono<Env>()
  .use("*", requireDevice())
  .get("/state", async (c) => {
    const { body, etag } = await buildDeviceState(db(c.env.DB), c.var.houseId, c.var.deviceId, clock.now());
    c.header("ETag", etag);
    c.header("Cache-Control", "no-store");
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.json(body);
  });
