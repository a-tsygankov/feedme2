import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { zValidator } from "@hono/zod-validator";
import { DeviceScaleEventsBodySchema, type ScaleEvent } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { clock } from "../auth/tokens.ts";
import { requireDevice, type DeviceVars } from "../middleware/device.ts";
import { validationHook } from "../validation.ts";

type Env = { Bindings: Bindings } & DeviceVars;

type StoredEvent = {
    id: string;
    house_id: string;
    device_id: string;
    pairing_token_id: string;
    sequence: number;
    kind: string;
    observed_at: number;
    calibration_revision: number;
    gross_mg: number | null;
    fault_code: string | null;
};

function gross(e: ScaleEvent): number | null {
    return e.kind === "stable_weight" || e.kind === "bowl_returned" ? e.grossMg : null;
}

function fault(e: ScaleEvent): string | null {
    return e.kind === "sensor_fault" ? e.code : null;
}

function equivalent(a: ScaleEvent, b: ScaleEvent): boolean {
    return a.id === b.id && a.sequence === b.sequence && a.kind === b.kind
        && a.observedAt === b.observedAt && a.calibrationRevision === b.calibrationRevision
        && gross(a) === gross(b) && fault(a) === fault(b);
}

function matchesStored(e: ScaleEvent, r: StoredEvent, houseId: string, deviceId: string, pairingId: string): boolean {
    return r.id === e.id && r.house_id === houseId && r.device_id === deviceId
        && r.pairing_token_id === pairingId && r.sequence === e.sequence && r.kind === e.kind
        && r.observed_at === e.observedAt && r.calibration_revision === e.calibrationRevision
        && r.gross_mg === gross(e) && r.fault_code === fault(e);
}

/**
 * Persist scale events independently of manual feedings. Idempotency is
 * enforced by both global UUID and (device, pairing epoch, sequence).
 * Device identity and tenancy always come from requireDevice, never JSON.
 */
export const scaleEventsRouter = new Hono<Env>()
    .use("*", requireDevice())
    .post(
        "/scale-events",
        bodyLimit({ maxSize: 32 * 1024, onError: (c: Context) => c.json({ error: "payload_too_large" }, 413) }),
        zValidator("json", DeviceScaleEventsBodySchema, validationHook),
        async (c) => {
            const events = c.req.valid("json");
            const byId = new Map<string, ScaleEvent>();
            const bySeq = new Map<number, ScaleEvent>();
            for (const e of events) {
                const idMatch = byId.get(e.id);
                const seqMatch = bySeq.get(e.sequence);
                if ((idMatch && !equivalent(idMatch, e)) || (seqMatch && !equivalent(seqMatch, e))) {
                    return c.json({ error: "event_conflict" }, 409);
                }
                byId.set(e.id, e);
                bySeq.set(e.sequence, e);
            }
            const unique = [...byId.values()];
            const houseId = c.var.houseId;
            const deviceId = c.var.deviceId;
            const pairingId = c.var.device.tokenId;
            const ids = unique.map((e) => e.id);
            const sequences = unique.map((e) => e.sequence);
            const idPlaceholders = ids.map(() => "?").join(", ");
            const seqPlaceholders = sequences.map(() => "?").join(", ");
            const select = `SELECT id, house_id, device_id, pairing_token_id, sequence, kind, observed_at, calibration_revision, gross_mg, fault_code
                FROM scale_events WHERE id IN (${idPlaceholders})
                OR (device_id = ? AND pairing_token_id = ? AND sequence IN (${seqPlaceholders}))`;
            const values = [...ids, deviceId, pairingId, ...sequences];
            const d1 = c.env.DB;
            const existing = (await d1.prepare(select).bind(...values).all<StoredEvent>()).results;
            const storedById = new Map(existing.map((r) => [r.id, r]));
            const inputBySequence = new Map(unique.map((e) => [e.sequence, e]));
            for (const r of existing) {
                const incoming = byId.get(r.id) ?? (r.device_id === deviceId && r.pairing_token_id === pairingId ? inputBySequence.get(r.sequence) : undefined);
                if (!incoming || !matchesStored(incoming, r, houseId, deviceId, pairingId)) {
                    return c.json({ error: "event_conflict" }, 409);
                }
            }
            const pending = unique.filter((e) => !storedById.has(e.id));
            const now = clock.now();
            if (pending.length === 0) return c.json({ accepted: [], now }, 201);
            const inserts = pending.map((e) =>
                d1.prepare(`INSERT INTO scale_events
                    (id, house_id, device_id, pairing_token_id, sequence, kind, observed_at, received_at, calibration_revision, gross_mg, fault_code)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`)
                    .bind(e.id, houseId, deviceId, pairingId, e.sequence, e.kind, e.observedAt, now, e.calibrationRevision, gross(e), fault(e)),
            );
            // D1 batch is a transaction: a failed statement does not leave half a batch.
            const inserted = await d1.batch<{ id: string }>(inserts);
            const accepted = inserted.flatMap((r) => r.results.map((row) => row.id));

            // A concurrent writer could win ON CONFLICT between our pre-read and
            // insert. Never silently ACK a different payload in that case.
            if (accepted.length !== pending.length) {
                const after = (await d1.prepare(select).bind(...values).all<StoredEvent>()).results;
                const afterById = new Map(after.map((r) => [r.id, r]));
                if (unique.some((e) => !afterById.has(e.id) || !matchesStored(e, afterById.get(e.id)!, houseId, deviceId, pairingId))) {
                    return c.json({ error: "event_conflict" }, 409);
                }
            }
            return c.json({ accepted, now }, 201);
        },
    );
