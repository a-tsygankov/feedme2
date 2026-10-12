import { SELF, env } from "cloudflare:test";
import { DeviceSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { signup } from "./helpers/api.ts";
import { newDeviceId, newPollSecret, pairCheck, pairStart } from "./helpers/device.ts";
import { clock } from "../src/auth/tokens.ts";
import { verifyDeviceToken } from "../src/auth/device-tokens.ts";
import { db } from "../src/db/client.ts";
import { PAIR_DELIVERY_GRACE_MS, PAIR_TTL_MS, PairingsRepo, codeSource } from "../src/repos/pairings.ts";

type House = Awaited<ReturnType<typeof signup>>;
const post = (path: string, body: unknown) =>
  SELF.fetch(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const confirm = (h: House, pairCode: string, name?: string) =>
  h.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode, ...(name === undefined ? {} : { name }) }) });
const pendingRow = (deviceId: string) =>
  env.DB.prepare("SELECT * FROM pending_pairings WHERE device_id = ?").bind(deviceId).first<{
    house_id: string | null; confirmed_at: number | null; device_token: string | null; delivered_at: number | null; expires_at: number; poll_secret_hash: string;
  }>();
const deviceRow = (id: string) =>
  env.DB.prepare("SELECT house_id, name, auto_install, token_id, revoked_at FROM devices WHERE id = ?").bind(id).first<{ house_id: string; name: string; auto_install: number; token_id: string; revoked_at: number | null }>();

describe("/api/pair", () => {
  beforeAll(applyAllMigrations);

  it("start → pending → confirm → confirmed with a token the device can use", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const start = await pairStart(deviceId);
    expect(start.pairCode).toMatch(/^\d{6}$/);
    expect(start.pollAfterSec).toBe(3);
    expect(await pairCheck(deviceId, start.pollSecret)).toEqual({ status: "pending" });
    const res = await confirm(s, start.pairCode, "Kitchen");
    expect(res.status).toBe(201);
    const device = DeviceSchema.parse(((await res.json()) as { device: unknown }).device);
    expect(device).toMatchObject({ id: deviceId, houseId: s.houseId, name: "Kitchen", hwModel: "device-sim", fwVersion: "0.2.0", revokedAt: null });
    const check = await pairCheck(deviceId, start.pollSecret);
    expect(check.status).toBe("confirmed");
    if (check.status !== "confirmed") return;
    expect(check.houseId).toBe(s.houseId);
    expect(check.deviceName).toBe("Kitchen");
    const state = await SELF.fetch("http://feedme2/api/device/state", { headers: { authorization: `Bearer ${check.deviceToken}` } });
    expect(state.status).toBe(200);
  });

  it("a second start replaces the code; the old code no longer confirms", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const a = await pairStart(deviceId);
    const b = await pairStart(deviceId);
    expect(b.pairCode).not.toBe(a.pairCode);
    expect((await confirm(s, a.pairCode)).status).toBe(404);
    expect((await confirm(s, b.pairCode)).status).toBe(201);
  });

  it("a used code answers 409 and an expired one 404; check reports expired", async () => {
    const s = await signup();
    const deviceId = newDeviceId();
    const start = await pairStart(deviceId);
    expect((await confirm(s, start.pairCode)).status).toBe(201);
    const again = await confirm(s, start.pairCode);
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "pair_code_used" });
    const other = newDeviceId();
    const st2 = await pairStart(other);
    const spy = vi.spyOn(clock, "now").mockReturnValue(Date.now() + PAIR_TTL_MS + 1000);
    try {
      expect((await confirm(s, st2.pairCode)).status).toBe(404);
      expect(await pairCheck(other, st2.pollSecret)).toEqual({ status: "expired" });
    } finally {
      spy.mockRestore();
    }
    expect(await pairCheck(newDeviceId(), newPollSecret())).toEqual({ status: "unknown" });
  });

  it("re-pairing a device that is live in another house is refused until it is forgotten", async () => {
    const a = await signup();
    const b = await signup();
    const deviceId = newDeviceId();
    const s1 = await pairStart(deviceId);
    expect((await confirm(a, s1.pairCode)).status).toBe(201);
    const s2 = await pairStart(deviceId, newPollSecret(), "0.2.1");
    const refused = await confirm(b, s2.pairCode);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "device_in_use" });
    // The refused confirm gives the claim back: the code is not burned and nothing leaked to the device.
    const released = await pendingRow(deviceId);
    expect(released).toMatchObject({ house_id: null, confirmed_at: null, device_token: null });
    expect(released!.expires_at).toBe(s2.expiresAt);
    expect((await deviceRow(deviceId))!.house_id).toBe(a.houseId);
    expect((await a.fetchAuthed(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(204);
    expect((await confirm(b, s2.pairCode)).status).toBe(201);
    expect(await deviceRow(deviceId)).toMatchObject({ house_id: b.houseId, revoked_at: null });
    const fw = await env.DB.prepare("SELECT fw_version FROM devices WHERE id = ?").bind(deviceId).first<{ fw_version: string }>();
    expect(fw!.fw_version).toBe("0.2.1");
  });

  it("refuses oversized bodies on the public routes before parsing them", async () => {
    const big = "x".repeat(2000);
    for (const path of ["/api/pair/start", "/api/pair/check"]) {
      const r = await post(path, { deviceId: newDeviceId(), pollSecret: newPollSecret(), junk: big });
      expect(r.status).toBe(413);
      expect(await r.json()).toEqual({ error: "payload_too_large" });
    }
  });

  it("validates bodies with the standard 400 shape", async () => {
    const r = await post("/api/pair/start", { deviceId: "nope", hwModel: "device-sim", fwVersion: "0.2.0", pollSecret: newPollSecret() });
    expect(r.status).toBe(400);
    expect(await r.json()).toMatchObject({ error: "invalid_request" });
    expect((await post("/api/pair/start", { deviceId: newDeviceId(), hwModel: "device-sim", fwVersion: "0.2.0" })).status).toBe(400);
    expect((await post("/api/pair/check", { deviceId: newDeviceId() })).status).toBe(400);
  });

  describe("poll secret and single delivery", () => {
    // Attack: the device id is not secret, so anyone could poll /check for it and collect the freshly minted token.
    it("a wrong poll secret is told pending and never gets the token; the right one does", async () => {
      const s = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      expect((await confirm(s, start.pairCode)).status).toBe(201);
      expect(await pairCheck(deviceId, newPollSecret())).toEqual({ status: "pending" });
      expect((await pendingRow(deviceId))!.delivered_at).toBeNull();
      expect((await pairCheck(deviceId, start.pollSecret)).status).toBe("confirmed");
    });
    it("stores only a hash of the poll secret", async () => {
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      const row = (await pendingRow(deviceId))!;
      expect(row.poll_secret_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.poll_secret_hash).not.toContain(start.pollSecret);
    });
    it("a restart rolls the secret: the previous one stops working", async () => {
      const deviceId = newDeviceId();
      const old = await pairStart(deviceId);
      const fresh = await pairStart(deviceId);
      const s = await signup();
      expect((await confirm(s, fresh.pairCode)).status).toBe(201);
      expect(await pairCheck(deviceId, old.pollSecret)).toEqual({ status: "pending" });
      expect((await pairCheck(deviceId, fresh.pollSecret)).status).toBe("confirmed");
    });
    it("confirm keeps the row only for the delivery grace, not the rest of the 10 minutes", async () => {
      const s = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      const t = Date.now();
      expect((await confirm(s, start.pairCode)).status).toBe(201);
      const row = (await pendingRow(deviceId))!;
      expect(row.expires_at).toBeGreaterThanOrEqual(t + PAIR_DELIVERY_GRACE_MS);
      expect(row.expires_at).toBeLessThan(t + PAIR_DELIVERY_GRACE_MS + 5000);
    });
    it("redelivers within 60 s of the first delivery, then answers expired and wipes the token", async () => {
      const s = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      expect((await confirm(s, start.pairCode)).status).toBe(201);
      const first = await pairCheck(deviceId, start.pollSecret);
      expect(first.status).toBe("confirmed");
      const delivered = (await pendingRow(deviceId))!.delivered_at!;
      const spy = vi.spyOn(clock, "now");
      try {
        spy.mockReturnValue(delivered + 59_000);
        const retry = await pairCheck(deviceId, start.pollSecret);
        expect(retry.status === "confirmed" && first.status === "confirmed" && retry.deviceToken === first.deviceToken).toBe(true);
        spy.mockReturnValue(delivered + 61_000);
        expect(await pairCheck(deviceId, start.pollSecret)).toEqual({ status: "expired" });
        expect((await pendingRow(deviceId))!.device_token).toBeNull();
        spy.mockReturnValue(delivered + 62_000);
        expect(await pairCheck(deviceId, start.pollSecret)).toEqual({ status: "expired" });
      } finally {
        spy.mockRestore();
      }
    });
    it("a confirmed row past its expiry answers expired (expiry is evaluated first) and wipes the token", async () => {
      const s = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      expect((await confirm(s, start.pairCode)).status).toBe(201);
      expect((await pendingRow(deviceId))!.device_token).not.toBeNull();
      const spy = vi.spyOn(clock, "now").mockReturnValue(Date.now() + PAIR_DELIVERY_GRACE_MS + 1000);
      try {
        expect(await pairCheck(deviceId, start.pollSecret)).toEqual({ status: "expired" });
      } finally {
        spy.mockRestore();
      }
      expect((await pendingRow(deviceId))!.device_token).toBeNull();
    });
  });

  describe("atomic confirm", () => {
    // Attack: two houses confirming the same code at once both passed the unconfirmed check, so the pending row
    // (and the token the device collected) could name one house while the devices row named the other.
    it("two houses racing for one code: exactly one 201, one 409 pair_code_used, and every record agrees", async () => {
      const a = await signup();
      const b = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      const [ra, rb] = await Promise.all([confirm(a, start.pairCode), confirm(b, start.pairCode)]);
      expect([ra.status, rb.status].sort()).toEqual([201, 409]);
      const [winner, loser, lres] = ra.status === 201 ? [a, b, rb] : [b, a, ra];
      expect(await lres.json()).toEqual({ error: "pair_code_used" });
      expect((await deviceRow(deviceId))!.house_id).toBe(winner.houseId);
      expect((await pendingRow(deviceId))!.house_id).toBe(winner.houseId);
      const check = await pairCheck(deviceId, start.pollSecret);
      expect(check.status).toBe("confirmed");
      if (check.status !== "confirmed") return;
      expect(check.houseId).toBe(winner.houseId);
      expect((await verifyDeviceToken(check.deviceToken, env.AUTH_SECRET))!.houseId).toBe(winner.houseId);
      expect((await loser.fetchAuthed("/api/devices")).status).toBe(200);
    });
    // The two requests above may not interleave inside the test runtime, so the lost race is also forced:
    // the loser's first read still sees the row unconfirmed, as it would between the winner's read and write.
    it("a confirm whose read went stale loses the claim and answers pair_code_used without touching the winner", async () => {
      const a = await signup();
      const b = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      const repo = new PairingsRepo(db(env.DB));
      const stale = (await repo.findByCode(start.pairCode))!;
      expect((await confirm(a, start.pairCode)).status).toBe(201);
      const spy = vi.spyOn(PairingsRepo.prototype, "findByCode").mockResolvedValueOnce(stale);
      try {
        const lost = await confirm(b, start.pairCode);
        expect(lost.status).toBe(409);
        expect(await lost.json()).toEqual({ error: "pair_code_used" });
      } finally {
        spy.mockRestore();
      }
      expect((await deviceRow(deviceId))!.house_id).toBe(a.houseId);
      expect((await pendingRow(deviceId))!.house_id).toBe(a.houseId);
      const check = await pairCheck(deviceId, start.pollSecret);
      expect(check.status === "confirmed" && check.houseId === a.houseId).toBe(true);
    });
    it("claim is a single statement: of two concurrent claims on one code exactly one gets the row", async () => {
      const a = await signup();
      const b = await signup();
      const deviceId = newDeviceId();
      const start = await pairStart(deviceId);
      const repo = new PairingsRepo(db(env.DB));
      const now = Date.now();
      const [ra, rb] = await Promise.all([repo.claim(start.pairCode, deviceId, a.houseId, "tok-a", now), repo.claim(start.pairCode, deviceId, b.houseId, "tok-b", now)]);
      expect([ra, rb].filter((r) => r !== undefined)).toHaveLength(1);
      const row = (await pendingRow(deviceId))!;
      expect(row.house_id).toBe(ra ? a.houseId : b.houseId);
      expect(row.device_token).toBe(ra ? "tok-a" : "tok-b");
    });
    it("a code for an unknown device is 404, a confirmed one 409", async () => {
      const s = await signup();
      const r = await confirm(s, "100000");
      expect(r.status).toBe(404);
      expect(await r.json()).toEqual({ error: "pair_code_unknown" });
    });
  });

  describe("device row on confirm", () => {
    // Attack surface: a device handed to a new house kept the previous house's name and its auto-install consent.
    it("a re-pair resets auto-install and never carries the previous house's name", async () => {
      const a = await signup();
      const b = await signup();
      const deviceId = newDeviceId();
      const s1 = await pairStart(deviceId);
      expect((await confirm(a, s1.pairCode, "Kitchen")).status).toBe(201);
      expect((await a.fetchAuthed(`/api/devices/${deviceId}`, { method: "PATCH", body: JSON.stringify({ autoInstall: true }) })).status).toBe(200);
      expect((await deviceRow(deviceId))!.auto_install).toBe(1);
      expect((await a.fetchAuthed(`/api/devices/${deviceId}`, { method: "DELETE" })).status).toBe(204);
      const s2 = await pairStart(deviceId);
      expect((await confirm(b, s2.pairCode)).status).toBe(201);
      const row = (await deviceRow(deviceId))!;
      expect(row.auto_install).toBe(0);
      expect(row.name).toBe(`Device ${deviceId.slice(-4)}`);
      const s3 = await pairStart(deviceId);
      await b.fetchAuthed(`/api/devices/${deviceId}`, { method: "DELETE" });
      expect((await confirm(a, s3.pairCode, "Porch")).status).toBe(201);
      expect((await deviceRow(deviceId))!.name).toBe("Porch");
    });
    it("a re-confirm in the same house also resets auto-install", async () => {
      const a = await signup();
      const deviceId = newDeviceId();
      expect((await confirm(a, (await pairStart(deviceId)).pairCode, "Kitchen")).status).toBe(201);
      await a.fetchAuthed(`/api/devices/${deviceId}`, { method: "PATCH", body: JSON.stringify({ autoInstall: true }) });
      expect((await confirm(a, (await pairStart(deviceId)).pairCode, "Kitchen")).status).toBe(201);
      expect((await deviceRow(deviceId))!.auto_install).toBe(0);
    });
  });

  describe("failed-confirm budget", () => {
    // Attack: a signed-in account guessing 6-digit codes (900k space) to confirm someone else's pending device.
    it("10 wrong codes in a window lock the house out (429 with retryAfterSec) until the window passes", async () => {
      const s = await signup();
      for (let i = 0; i < 10; i++) expect((await confirm(s, String(900_000 + i))).status).toBe(404);
      const blocked = await confirm(s, "900099");
      expect(blocked.status).toBe(429);
      const body = (await blocked.json()) as { error: string; retryAfterSec: number };
      expect(body.error).toBe("too_many_attempts");
      expect(body.retryAfterSec).toBeGreaterThan(0);
      expect(body.retryAfterSec).toBeLessThanOrEqual(600);
      // Even a correct code is refused while blocked: otherwise the budget would not slow a guesser down.
      const deviceId = newDeviceId();
      const spy = vi.spyOn(clock, "now");
      try {
        const start = await pairStart(deviceId);
        expect((await confirm(s, start.pairCode)).status).toBe(429);
        spy.mockReturnValue(Date.now() + 11 * 60_000);
        const later = await pairStart(deviceId);
        expect((await confirm(s, later.pairCode)).status).toBe(201);
      } finally {
        spy.mockRestore();
      }
    });
    it("other houses are not affected, and a used code counts as a failure", async () => {
      const s = await signup();
      const other = await signup();
      for (let i = 0; i < 10; i++) await confirm(s, String(800_000 + i));
      expect((await confirm(s, "800100")).status).toBe(429);
      const start = await pairStart(newDeviceId());
      expect((await confirm(other, start.pairCode)).status).toBe(201);
      expect((await confirm(other, start.pairCode)).status).toBe(409);
      const row = await env.DB.prepare("SELECT failures FROM pair_attempts WHERE house_id = ?").bind(other.houseId).first<{ failures: number }>();
      expect(row!.failures).toBe(1);
    });
  });

  describe("pair code collisions and pruning", () => {
    // Attack surface: a 6-digit code space is small; an expired row squatting on a code must not block /start.
    it("start reclaims a code held by an expired row and retries with it", async () => {
      const squatter = newDeviceId();
      const held = (await pairStart(squatter)).pairCode;
      const farFuture = Date.now() + PAIR_TTL_MS + 5000;
      const spy = vi.spyOn(codeSource, "next").mockReturnValueOnce(held);
      const clockSpy = vi.spyOn(clock, "now").mockReturnValue(farFuture);
      try {
        const fresh = newDeviceId();
        const start = await pairStart(fresh);
        expect(start.pairCode).toBe(held);
        expect(spy).toHaveBeenCalled();
        expect(await pendingRow(squatter)).toBeNull();
        expect(await pendingRow(fresh)).not.toBeNull();
      } finally {
        spy.mockRestore();
        clockSpy.mockRestore();
      }
    });
    it("start picks another code when a live row holds the first one", async () => {
      const holder = newDeviceId();
      const held = (await pairStart(holder)).pairCode;
      const spy = vi.spyOn(codeSource, "next").mockReturnValueOnce(held);
      try {
        const start = await pairStart(newDeviceId());
        expect(start.pairCode).not.toBe(held);
        expect(await pendingRow(holder)).not.toBeNull();
      } finally {
        spy.mockRestore();
      }
    });
    it("pruneExpired deletes in chunks until nothing expired is left", async () => {
      const now = Date.now();
      await env.DB.prepare(
        `WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < 1300)
         INSERT INTO pending_pairings (device_id, pair_code, hw_model, fw_version, requested_at, expires_at, poll_secret_hash)
         SELECT printf('%032x', i + 4000000), printf('%06d', 200000 + i), 'device-sim', '0.2.0', ?1 - 1000000, ?1 - 1000, 'h' FROM n`,
      ).bind(now).run();
      const live = newDeviceId();
      await pairStart(live);
      const removed = await new PairingsRepo(db(env.DB)).pruneExpired(now);
      expect(removed).toBe(1300);
      expect(await pendingRow(live)).not.toBeNull();
      expect(await new PairingsRepo(db(env.DB)).pruneExpired(now)).toBe(0);
    });
  });
});
