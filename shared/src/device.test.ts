import { describe, expect, it } from "vitest";
import sample from "../../fixtures/device-state.sample.json";
import {
  DeviceFeedingCreateSchema, DeviceIdSchema, DeviceResponseSchema, DeviceStateSchema, HeartbeatBodySchema, LOGIN_QR_TTL_SEC,
  LoginQrBodySchema, LoginTokenCreateResponseSchema, PairCheckResponseSchema, PairCheckBodySchema, PairCodeSchema, PairConfirmBodySchema,
  PairStartBodySchema,
} from "./device.ts";

const DEV = "0123456789abcdef0123456789abcdef";
const SECRET = "0123456789abcdef".repeat(2);

describe("device contracts", () => {
  it("a single-device response wraps the device", () => {
    const device = { id: DEV, houseId: "h", name: "Kitchen", hwModel: "crowpanel-1.28", fwVersion: "0.2.3", lastSeenAt: null, batteryPct: 0, resetReason: null, autoInstall: false, createdAt: 1, revokedAt: null };
    expect(DeviceResponseSchema.parse({ device }).device.batteryPct).toBe(0);
    expect(DeviceResponseSchema.safeParse(device).success).toBe(false);
  });
  it("device ids are 32 lowercase hex", () => {
    expect(DeviceIdSchema.safeParse(DEV).success).toBe(true);
    expect(DeviceIdSchema.safeParse(DEV.toUpperCase()).success).toBe(false);
    expect(DeviceIdSchema.safeParse(DEV.slice(1)).success).toBe(false);
  });
  it("pair codes are six digits", () => {
    expect(PairCodeSchema.safeParse("004512").success).toBe(true);
    expect(PairCodeSchema.safeParse("45 12").success).toBe(false);
    expect(PairCodeSchema.safeParse("1234567").success).toBe(false);
  });
  it("pair/start requires a known hardware model and a semver fw", () => {
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "crowpanel-1.28", fwVersion: "0.2.0", pollSecret: SECRET }).success).toBe(true);
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "xiao-esp32s3-sense-scale", fwVersion: "0.1.39", pollSecret: SECRET }).success).toBe(true);
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "toaster", fwVersion: "0.2.0", pollSecret: SECRET }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "simulator", fwVersion: "v1", pollSecret: SECRET }).success).toBe(false);
  });
  // Attack: /check is public and the device id is not secret (it is printed in logs), so without a
  // per-handshake secret anyone could poll /check and collect the freshly minted device token.
  it("pair/start and pair/check require a 32-64 char lowercase hex poll secret", () => {
    const start = { deviceId: DEV, hwModel: "simulator", fwVersion: "0.2.0" };
    expect(PairStartBodySchema.safeParse(start).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ ...start, pollSecret: "a".repeat(31) }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ ...start, pollSecret: "a".repeat(65) }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ ...start, pollSecret: "A".repeat(32) }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ ...start, pollSecret: "g".repeat(32) }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ ...start, pollSecret: "a".repeat(64) }).success).toBe(true);
    expect(PairCheckBodySchema.safeParse({ deviceId: DEV }).success).toBe(false);
    expect(PairCheckBodySchema.safeParse({ deviceId: DEV, pollSecret: SECRET }).success).toBe(true);
    expect(PairCheckBodySchema.safeParse({ deviceId: DEV, pollSecret: "xyz" }).success).toBe(false);
  });
  it("pair/check is a discriminated union", () => {
    expect(PairCheckResponseSchema.parse({ status: "pending" })).toEqual({ status: "pending" });
    expect(PairCheckResponseSchema.safeParse({ status: "confirmed" }).success).toBe(false);
    expect(PairCheckResponseSchema.safeParse({ status: "confirmed", deviceToken: "t", houseId: DEV, houseName: "H", deviceName: "Kitchen" }).success).toBe(true);
  });
  it("pair/confirm takes a code and an optional name", () => {
    expect(PairConfirmBodySchema.parse({ pairCode: "123456" })).toEqual({ pairCode: "123456" });
    expect(PairConfirmBodySchema.safeParse({ pairCode: "123456", name: "" }).success).toBe(false);
  });
  it("the sample state fixture is a valid DeviceState", () => {
    const s = DeviceStateSchema.parse(sample);
    expect(s.cats.length).toBe(2);
    expect(s.house.tzOffsetMin).toBe(-240);
    expect(s.syncIntervalSec).toBe(s.house.settings.syncIntervalSec);
  });
  it("device feedings accept fedAt 0 (an unset RTC; the route clamps it) but not negatives", () => {
    const base = { id: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11", catId: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a12", amountMg: 40000, enteredUnit: "g", enteredValue: "40" };
    expect(DeviceFeedingCreateSchema.safeParse({ ...base, fedAt: 0 }).success).toBe(true);
    expect(DeviceFeedingCreateSchema.safeParse({ ...base, fedAt: -1 }).success).toBe(false);
    expect(DeviceFeedingCreateSchema.safeParse({ ...base, fedAt: 4_102_444_800_001 }).success).toBe(false);
    expect(DeviceFeedingCreateSchema.safeParse({ ...base, fedAt: 1.5 }).success).toBe(false);
  });
  it("device feedings carry no note and heartbeat bounds battery", () => {
    expect(DeviceFeedingCreateSchema.safeParse({ id: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11", catId: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a12", fedAt: 1_700_000_000_000, amountMg: 40000, enteredUnit: "g", enteredValue: "40", note: "x" }).success).toBe(false);
    expect(HeartbeatBodySchema.safeParse({ fwVersion: "0.2.0", batteryPct: 101, uptimeSec: 1, resetReason: "POWERON", freeHeap: 1000 }).success).toBe(false);
    expect(HeartbeatBodySchema.safeParse({ fwVersion: "0.2.0", uptimeSec: 1, resetReason: "POWERON", freeHeap: 1000 }).success).toBe(true);
  });

  describe("qr login", () => {
    // Same encoding as backend mintRefreshToken(): 32 random bytes, base64url, padding stripped.
    const mint = () =>
      btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_01234";

    it("the token lives 60 seconds", () => {
      expect(LOGIN_QR_TTL_SEC).toBe(60);
    });
    it("accepts a device id and a 43-char base64url token", () => {
      expect(TOKEN).toHaveLength(43);
      expect(LoginQrBodySchema.safeParse({ deviceId: "a".repeat(32), token: TOKEN }).success).toBe(true);
      for (let i = 0; i < 20; i++) expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: mint() }).success).toBe(true);
    });
    it("rejects a short token, base64 (not url) chars, an uppercase device id and an extra key", () => {
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: TOKEN.slice(1) }).success).toBe(false);
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: TOKEN + "A" }).success).toBe(false);
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: "+" + TOKEN.slice(1) }).success).toBe(false);
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: "/" + TOKEN.slice(1) }).success).toBe(false);
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV.toUpperCase(), token: TOKEN }).success).toBe(false);
      expect(LoginQrBodySchema.safeParse({ deviceId: DEV, token: TOKEN, houseId: "h" }).success).toBe(false);
    });
    it("the create response carries the token and a positive whole lifetime", () => {
      expect(LoginTokenCreateResponseSchema.parse({ token: TOKEN, expiresInSec: 60 }).expiresInSec).toBe(60);
      expect(LoginTokenCreateResponseSchema.safeParse({ token: TOKEN, expiresInSec: 0 }).success).toBe(false);
      expect(LoginTokenCreateResponseSchema.safeParse({ token: TOKEN, expiresInSec: 1.5 }).success).toBe(false);
      expect(LoginTokenCreateResponseSchema.safeParse({ token: "short", expiresInSec: 60 }).success).toBe(false);
    });
  });
});
