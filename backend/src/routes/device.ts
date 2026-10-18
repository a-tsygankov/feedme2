import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { DeviceFeedingsBodySchema, DeviceLogsBodySchema, HeartbeatBodySchema, compareVersions, type DeviceState } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { db, type Db } from "../db/client.ts";
import { clock } from "../auth/tokens.ts";
import { requireDevice, type DeviceVars } from "../middleware/device.ts";
import { CatsRepo, toApiCat } from "../repos/cats.ts";
import { DevicesRepo } from "../repos/devices.ts";
import { LogsRepo } from "../repos/logs.ts";
import { assertCatsInHouse, clampFedAt, FeedingsRepo } from "../repos/feedings.ts";
import { HousesRepo, toApiHouse } from "../repos/houses.ts";
import { tzOffsetMin } from "../time.ts";
import { log } from "../logger.ts";
import { validationHook } from "../validation.ts";

type Env = { Bindings: Bindings } & DeviceVars;

/** A hostile or broken device must not make the worker buffer and parse megabytes before validation says no. */
const tooLarge = (c: Context) => c.json({ error: "payload_too_large" }, 413);

async function weakEtag(stable: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(stable)));
  return `W/"${[...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("")}"`;
}

/**
 * The one device read (spec §3.3, §5.3): everything the Idle/Amount
 * screens need in one round trip. The ETag covers the parts that change
 * when a person does something (settings, cats, defaults, device name)
 * and the house's UTC offset (it changes twice a year at DST, and a 304
 * would leave the device's clock an hour off until something else changed),
 * but deliberately excludes `now`, so a device that polls on its timer
 * gets 304s until something it displays changed.
 */
export async function buildDeviceState(d: Db, houseId: string, device: { id: string; name: string }, nowMs: number): Promise<{ body: DeviceState; etag: string }> {
  const houseRow = (await new HousesRepo(d).findById(houseId))!;
  const house = toApiHouse(houseRow);
  const cats = (await new CatsRepo(d).list(houseId)).map(toApiCat).map((c) => ({
    id: c.id, name: c.name, color: c.color, avatarPose: c.avatarPose, hungryAfterSec: c.hungryAfterSec, sortOrder: c.sortOrder,
    defaultAmountMg: c.defaultAmountMg, defaultEnteredUnit: c.defaultEnteredUnit, defaultEnteredValue: c.defaultEnteredValue, lastFedAt: c.lastFedAt,
  }));
  const stable = {
    house: { id: house.id, name: house.name, tzOffsetMin: tzOffsetMin(house.settings.timezone, nowMs), settings: house.settings },
    device: { id: device.id, name: device.name },
    cats,
  };
  const etag = await weakEtag(stable);
  const body: DeviceState = {
    house: stable.house,
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
  .get("/firmware/check", async (c) => {
    // Authenticated, model-scoped, read-only advisory. Never return an
    // unverified image URL or imply that the device may install firmware.
    c.header("Cache-Control", "no-store");
    if (c.var.device.hwModel !== "xiao-esp32s3-sense-scale") {
      return c.json({ latest: null, updateAvailable: false, installSupported: false });
    }
    const current = c.req.query("current");
    if (!current || !/^\\d+\\.\\d+\\.\\d+$/.test(current) || current.length > 32) {
      return c.json({ error: "invalid_firmware_version" }, 400);
    }
    const row = await c.env.DB.prepare(
      "SELECT version FROM firmware_releases WHERE hw_model = ? AND active = 1 ORDER BY created_at DESC LIMIT 1",
    ).bind(c.var.device.hwModel).first<{ version: string }>();
    const latest = row?.version ?? null;
    const semver = /^\\d+\\.\\d+\\.\\d+$/;
    const updateAvailable = latest !== null && semver.test(latest) && semver.test(current) &&
      compareVersions(latest, current) > 0;
    return c.json({ latest, updateAvailable, installSupported: false });
  })
  .get("/state", async (c) => {
    const { body, etag } = await buildDeviceState(db(c.env.DB), c.var.houseId, c.var.device, clock.now());
    c.header("ETag", etag);
    c.header("Cache-Control", "no-store");
    if (c.req.header("if-none-match") === etag) return c.body(null, 304);
    return c.json(body);
  })
  .post("/feedings", bodyLimit({ maxSize: 64 * 1024, onError: tooLarge }), zValidator("json", DeviceFeedingsBodySchema, validationHook), async (c) => {
    const d = db(c.env.DB);
    const now = clock.now();
    const items = c.req.valid("json");
    // Same order as the web route: a foreign cat is reported as nonexistent (404)
    // before anything is written.
    const missing = await assertCatsInHouse(new CatsRepo(d), c.var.houseId, items.map((i) => i.catId));
    if (missing.length > 0) return c.json({ error: "cat_not_found", catIds: missing }, 404);
    const repo = new FeedingsRepo(d);
    // The id is a global primary key: another house's id would be dropped by
    // ON CONFLICT DO NOTHING and look "already synced" to the device.
    const foreign = await repo.idsOwnedByOtherHouses(c.var.houseId, [...new Set(items.map((i) => i.id))]);
    if (foreign.length > 0) return c.json({ error: "id_conflict", ids: foreign }, 409);
    const clamped: string[] = [];
    // The device's original times, for the log: the stored row only keeps the corrected one.
    const clampedFrom: Array<{ id: string; fedAt: number }> = [];
    const fixed = items.map((i) => {
      const r = clampFedAt(i.fedAt, now);
      if (r.clamped) {
        clamped.push(i.id);
        clampedFrom.push({ id: i.id, fedAt: i.fedAt });
      }
      return { ...i, fedAt: r.fedAt };
    });
    const accepted = await repo.createMany(c.var.houseId, fixed, { source: "device", deviceId: c.var.deviceId }, now);
    if (clamped.length > 0) log.warn("device feeding clock clamped", { deviceId: c.var.deviceId, now, clamped: clampedFrom.slice(0, 20) });
    return c.json({ accepted, clamped, now }, 201);
  })
  .post("/heartbeat", bodyLimit({ maxSize: 4 * 1024, onError: tooLarge }), zValidator("json", HeartbeatBodySchema, validationHook), async (c) => {
    const b = c.req.valid("json");
    const now = clock.now();
    await new DevicesRepo(db(c.env.DB)).touch(c.var.deviceId, now, {
      fwVersion: b.fwVersion,
      resetReason: b.resetReason,
      ...(b.batteryPct !== undefined ? { batteryPct: b.batteryPct } : {}),
    });
    log.info("heartbeat", { deviceId: c.var.deviceId, fwVersion: b.fwVersion, uptimeSec: b.uptimeSec, freeHeap: b.freeHeap, resetReason: b.resetReason });
    return c.json({ now });
  })
  .post(
    "/logs",
    bodyLimit({ maxSize: 128 * 1024, onError: tooLarge }),
    zValidator("json", DeviceLogsBodySchema, validationHook),
    async (c) => {
      // The schema strips source/deviceId from the body: a device cannot forge
      // worker or web rows, and the device id comes from the verified token.
      // clientId too: it names a web client, and a device must not be able to appear as one.
      const entries = c.req.valid("json").map((e) => ({ ...e, source: "device" as const, clientId: undefined }));
      await new LogsRepo(db(c.env.DB)).insertMany(c.var.houseId, entries, { deviceId: c.var.deviceId }, clock.now());
      return c.body(null, 202);
    },
  );
