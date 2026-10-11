import { and, asc, eq, isNull } from "drizzle-orm";
import type { Device, DevicePatch, HwModel } from "@feedme2/shared";
import type { Db } from "../db/client.ts";
import { devices } from "../db/schema.ts";

type Row = typeof devices.$inferSelect;

export function toApiDevice(r: Row): Device {
  return {
    id: r.id, houseId: r.houseId, name: r.name, hwModel: r.hwModel as HwModel, fwVersion: r.fwVersion,
    lastSeenAt: r.lastSeenAt, batteryPct: r.batteryPct, resetReason: r.resetReason,
    autoInstall: r.autoInstall === 1, createdAt: r.createdAt, revokedAt: r.revokedAt,
  };
}

/** How often a device call refreshes last_seen_at; the heartbeat always does. */
export const TOUCH_INTERVAL_MS = 60_000;

export class DevicesRepo {
  constructor(private readonly db: Db) {}

  getAny(id: string): Promise<Row | undefined> {
    return this.db.query.devices.findFirst({ where: eq(devices.id, id) });
  }
  /** Live device of this house (revoked excluded). */
  get(houseId: string, id: string): Promise<Row | undefined> {
    return this.db.query.devices.findFirst({ where: and(eq(devices.houseId, houseId), eq(devices.id, id), isNull(devices.revokedAt)) });
  }
  list(houseId: string): Promise<Row[]> {
    return this.db.query.devices.findMany({ where: and(eq(devices.houseId, houseId), isNull(devices.revokedAt)), orderBy: [asc(devices.createdAt), asc(devices.id)] });
  }
  /** Pairing confirmed: create, or re-attach a revoked device to (possibly another) house. */
  async upsertPaired(row: { id: string; houseId: string; name: string; hwModel: string; fwVersion: string }, nowMs: number): Promise<Row> {
    await this.db
      .insert(devices)
      .values({ ...row, autoInstall: 0, createdAt: nowMs, modifiedAt: nowMs, lastSeenAt: nowMs, revokedAt: null })
      .onConflictDoUpdate({
        target: devices.id,
        set: { houseId: row.houseId, name: row.name, hwModel: row.hwModel, fwVersion: row.fwVersion, modifiedAt: nowMs, lastSeenAt: nowMs, revokedAt: null, batteryPct: null, resetReason: null },
      });
    return (await this.getAny(row.id))!;
  }
  async touch(id: string, nowMs: number, patch: Partial<Pick<Row, "fwVersion" | "batteryPct" | "resetReason">> = {}): Promise<void> {
    await this.db.update(devices).set({ lastSeenAt: nowMs, ...patch }).where(eq(devices.id, id));
  }
  async update(houseId: string, id: string, patch: DevicePatch, nowMs: number): Promise<Row | undefined> {
    const set: Partial<typeof devices.$inferInsert> = { modifiedAt: nowMs };
    if (patch.name !== undefined) set.name = patch.name;
    if (patch.autoInstall !== undefined) set.autoInstall = patch.autoInstall ? 1 : 0;
    await this.db.update(devices).set(set).where(and(eq(devices.houseId, houseId), eq(devices.id, id), isNull(devices.revokedAt)));
    return this.get(houseId, id);
  }
  /** Idempotent: revoking twice is fine; returns false only when the device is not this house's. */
  async revoke(houseId: string, id: string, nowMs: number): Promise<boolean> {
    const row = await this.db.query.devices.findFirst({ where: and(eq(devices.houseId, houseId), eq(devices.id, id)) });
    if (!row) return false;
    if (row.revokedAt === null) await this.db.update(devices).set({ revokedAt: nowMs, modifiedAt: nowMs }).where(eq(devices.id, id));
    return true;
  }
}
