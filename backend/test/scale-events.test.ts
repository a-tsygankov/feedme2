import { env } from "cloudflare:test";
import { DeviceScaleEventsResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { pairDevice } from "./helpers/device.ts";

const newEvent = (over: Record<string, unknown> = {}) => ({
    id: crypto.randomUUID(),
    sequence: 1,
    observedAt: Date.now() - 100,
    calibrationRevision: 1,
    kind: "stable_weight",
    grossMg: 150_000,
    ...over,
});
const post = (d: Awaited<ReturnType<typeof pairDevice>>, body: unknown) =>
    d.fetchDevice("/api/device/scale-events", { method: "POST", body: JSON.stringify(body) });

describe("POST /api/device/scale-events", () => {
    beforeAll(applyAllMigrations);

    it("persists scale observations separately from manual feedings and dedupes retries", async () => {
        const d = await pairDevice();
        const e = newEvent();
        const first = await post(d, [e]);
        expect(first.status).toBe(201);
        expect(DeviceScaleEventsResponseSchema.parse(await first.json()).accepted).toEqual([e.id]);
        const second = await post(d, [e]);
        expect(second.status).toBe(201);
        expect(DeviceScaleEventsResponseSchema.parse(await second.json()).accepted).toEqual([]);
        const row = await env.DB.prepare("SELECT house_id, device_id, sequence, kind, gross_mg, observed_at, received_at FROM scale_events WHERE id = ?")
            .bind(e.id).first<{ house_id: string; device_id: string; sequence: number; kind: string; gross_mg: number; observed_at: number; received_at: number }>();
        expect(row).toMatchObject({ house_id: d.house.houseId, device_id: d.deviceId, sequence: 1, kind: "stable_weight", gross_mg: 150_000, observed_at: e.observedAt });
        expect(row!.received_at).toBeGreaterThan(0);
        const feedingCount = await env.DB.prepare("SELECT count(*) AS n FROM feedings WHERE house_id = ?").bind(d.house.houseId).first<{ n: number }>();
        expect(feedingCount!.n).toBe(0);
    });

    it("deduplicates repeated identical entries inside a batch", async () => {
        const d = await pairDevice();
        const e = newEvent();
        const r = await post(d, [e, e]);
        expect(r.status).toBe(201);
        expect(DeviceScaleEventsResponseSchema.parse(await r.json()).accepted).toEqual([e.id]);
    });

    it("rejects a changed payload with the same id", async () => {
        const d = await pairDevice();
        const e = newEvent();
        expect((await post(d, [e])).status).toBe(201);
        const changed = await post(d, [{ ...e, grossMg: 151_000 }]);
        expect(changed.status).toBe(409);
        expect(await changed.json()).toEqual({ error: "event_conflict" });
    });

    it("rejects a reused sequence with a different event id", async () => {
        const d = await pairDevice();
        expect((await post(d, [newEvent()])).status).toBe(201);
        expect((await post(d, [newEvent()])).status).toBe(409);
    });

    it("rejects conflicting entries within one batch before any write", async () => {
        const d = await pairDevice();
        const first = newEvent();
        const other = newEvent({ sequence: 1 });
        expect((await post(d, [first, other])).status).toBe(409);
        const n = await env.DB.prepare("SELECT count(*) AS n FROM scale_events WHERE device_id = ?").bind(d.deviceId).first<{ n: number }>();
        expect(n!.n).toBe(0);
    });

    it("rejects an existing conflict atomically, not accepting unrelated first event", async () => {
        const d = await pairDevice();
        const existing = newEvent({ sequence: 2 });
        expect((await post(d, [existing])).status).toBe(201);
        const fresh = newEvent({ sequence: 3 });
        const r = await post(d, [fresh, { ...existing, grossMg: 1 }]);
        expect(r.status).toBe(409);
        expect((await env.DB.prepare("SELECT id FROM scale_events WHERE id = ?").bind(fresh.id).first())).toBeNull();
    });

    it("rejects another house's event id without exposing the foreign payload", async () => {
        const a = await pairDevice();
        const b = await pairDevice();
        const e = newEvent();
        expect((await post(a, [e])).status).toBe(201);
        const r = await post(b, [{ ...e, sequence: 77 }]);
        expect(r.status).toBe(409);
        expect(await r.json()).toEqual({ error: "event_conflict" });
    });

    it("allows sequence reuse after re-pairing because the pairing epoch changed", async () => {
        const d = await pairDevice();
        expect((await post(d, [newEvent()])).status).toBe(201);
        const next = await pairDevice(d.house, "Kitchen", d.deviceId);
        expect((await post(next, [newEvent()])).status).toBe(201);
        expect((await post(d, [newEvent({ sequence: 2 })])).status).toBe(401);
    });

    it("supports all event kinds and rejects unknown fields, invalid mass and missing data", async () => {
        const d = await pairDevice();
        const valid = [
            newEvent({ sequence: 1, kind: "bowl_removed", grossMg: undefined }),
            newEvent({ sequence: 2, kind: "bowl_returned", grossMg: 200_000 }),
            newEvent({ sequence: 3, kind: "sensor_fault", grossMg: undefined, code: "adc_timeout" }),
        ];
        expect((await post(d, valid)).status).toBe(201);
        for (const bad of [
            newEvent({ grossMg: 1_000_001 }),
            newEvent({ kind: "stable_weight", grossMg: undefined }),
            newEvent({ kind: "unknown" }),
            newEvent({ houseId: d.house.houseId }),
            newEvent({ sequence: -1 }),
        ]) {
            expect((await post(d, [bad])).status).toBe(400);
        }
    });

    it("requires a live device token and enforces the payload cap", async () => {
        const d = await pairDevice();
        expect((await d.house.fetchAuthed("/api/device/scale-events", { method: "POST", body: JSON.stringify([newEvent()]) })).status).toBe(401);
        expect((await post(d, [{ id: "x".repeat(40_000) }])).status).toBe(413);
        await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" });
        expect((await post(d, [newEvent()])).status).toBe(401);
    });

    it("rejects empty and oversized batches", async () => {
        const d = await pairDevice();
        expect((await post(d, [])).status).toBe(400);
        const many = Array.from({ length: 51 }, (_, i) => newEvent({ sequence: i }));
        expect((await post(d, many)).status).toBe(400);
    });
});
