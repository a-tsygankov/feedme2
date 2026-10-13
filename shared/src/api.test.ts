import { describe, expect, it } from "vitest";
import {
  CatCreateSchema, DebugLogsQuerySchema, FeedingCreateSchema, FeedingPatchSchema, FeedingsPageSchema,
  HousePatchSchema, HouseSettingsSchema, LoginBodySchema, LogsUploadBodySchema, SetupBodySchema, CAT_COLORS,
  UuidSchema, decodeFeedingsCursor, encodeFeedingsCursor,
} from "./api.ts";

const uuid = "123e4567-e89b-42d3-a456-426614174000";

describe("api contracts", () => {
  it("setup needs a 2–32 char name and a 4–12 digit pin", () => {
    expect(SetupBodySchema.safeParse({ houseName: "Mochi House", pin: "1234" }).success).toBe(true);
    expect(SetupBodySchema.safeParse({ houseName: "M", pin: "1234" }).success).toBe(false);
    expect(SetupBodySchema.safeParse({ houseName: "Mochi", pin: "12ab" }).success).toBe(false);
    expect(SetupBodySchema.safeParse({ houseName: "Mochi", pin: "123" }).success).toBe(false);
  });

  it("cat create defaults colour and pose and validates the colour", () => {
    const r = CatCreateSchema.parse({ id: uuid, name: "Mochi" });
    expect(CAT_COLORS).toContain(r.color);
    expect(r.avatarPose).toBe("C2");
    expect(CatCreateSchema.safeParse({ id: uuid, name: "Mochi", color: "red" }).success).toBe(false);
    expect(CatCreateSchema.safeParse({ id: "nope", name: "Mochi" }).success).toBe(false);
  });

  it("feeding create requires positive mg and a sane entered value", () => {
    const ok = { id: uuid, catId: uuid, fedAt: 1, amountMg: 51974, enteredUnit: "can", enteredValue: "1/3" };
    expect(FeedingCreateSchema.safeParse(ok).success).toBe(true);
    expect(FeedingCreateSchema.safeParse({ ...ok, amountMg: 0 }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...ok, amountMg: 12.5 }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...ok, enteredValue: "" }).success).toBe(false);
  });

  it("house patch accepts partial settings within bounds", () => {
    expect(HousePatchSchema.safeParse({ foodUnit: "oz" }).success).toBe(true);
    expect(HousePatchSchema.safeParse({ gramStep: 7 }).success).toBe(false);
    expect(HousePatchSchema.safeParse({ sleepTimeoutSec: 30 }).success).toBe(false);
    expect(HousePatchSchema.safeParse({ hungryAfterSecDefault: 3600 }).success).toBe(true);
  });

  it("log upload is capped at 50 entries and 1 KB of data each", () => {
    const entry = { ts: 1, level: "info", msg: "x" };
    expect(LogsUploadBodySchema.safeParse(Array(50).fill(entry)).success).toBe(true);
    expect(LogsUploadBodySchema.safeParse(Array(51).fill(entry)).success).toBe(false);
    const big = { ...entry, data: { blob: "y".repeat(1100) } };
    expect(LogsUploadBodySchema.safeParse([big]).success).toBe(false);
  });
});

describe("api contracts: hardening", () => {
  const feeding = { id: uuid, catId: uuid, fedAt: 1, amountMg: 51974, enteredUnit: "can", enteredValue: "1/3" };

  it("rejects an uppercase uuid (D1 text keys are case-sensitive)", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, id: uuid.toUpperCase() }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse(feeding).success).toBe(true);
  });

  it("rejects an absurd fedAt", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, fedAt: 2 ** 60 }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...feeding, fedAt: 4_102_444_800_000 }).success).toBe(true);
    expect(FeedingCreateSchema.safeParse({ ...feeding, fedAt: 4_102_444_800_001 }).success).toBe(false);
  });

  it("rejects fedAt 0 (the DB CHECK fed_at > 0 must never be the one to say no)", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, fedAt: 0 }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...feeding, fedAt: -1 }).success).toBe(false);
    expect(FeedingPatchSchema.safeParse({ fedAt: 0 }).success).toBe(false);
    expect(FeedingPatchSchema.safeParse({ fedAt: 1 }).success).toBe(true);
  });

  it("rejects an absurd amountMg", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, amountMg: 1e300 }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...feeding, amountMg: 5_000_000 }).success).toBe(true);
    expect(FeedingCreateSchema.safeParse({ ...feeding, amountMg: 5_000_001 }).success).toBe(false);
  });

  it("timezone must be a real IANA zone", () => {
    expect(HouseSettingsSchema.shape.timezone.safeParse("Not/AZone").success).toBe(false);
    expect(HouseSettingsSchema.shape.timezone.safeParse("Europe/Berlin").success).toBe(true);
    expect(HousePatchSchema.safeParse({ timezone: "Not/AZone" }).success).toBe(false);
  });

  it("enteredValue must parse as a positive amount", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, enteredValue: "banana" }).success).toBe(false);
    expect(FeedingCreateSchema.safeParse({ ...feeding, enteredValue: "1/3" }).success).toBe(true);
    expect(FeedingCreateSchema.safeParse({ ...feeding, enteredValue: "0" }).success).toBe(false);
  });

  it("feeding create accepts a null note", () => {
    expect(FeedingCreateSchema.safeParse({ ...feeding, note: null }).success).toBe(true);
    expect(FeedingCreateSchema.safeParse({ ...feeding, note: "dry" }).success).toBe(true);
  });

  it("feeding patch: not empty, and amount fields travel together", () => {
    expect(FeedingPatchSchema.safeParse({}).success).toBe(false);
    expect(FeedingPatchSchema.safeParse({ amountMg: 1000 }).success).toBe(false);
    expect(FeedingPatchSchema.safeParse({ amountMg: 1000, enteredUnit: "g" }).success).toBe(false);
    expect(FeedingPatchSchema.safeParse({ amountMg: 1000, enteredUnit: "g", enteredValue: "1" }).success).toBe(true);
    expect(FeedingPatchSchema.safeParse({ note: null }).success).toBe(true);
    expect(FeedingPatchSchema.safeParse({ note: "x", bogus: 1 }).success).toBe(false);
  });

  it("house patch rejects unknown keys and the empty patch", () => {
    expect(HousePatchSchema.safeParse({ houseId: "x" }).success).toBe(false);
    expect(HousePatchSchema.safeParse({}).success).toBe(false);
  });

  it("settings bounds hold at their edges", () => {
    const ok = (p: object) => HousePatchSchema.safeParse(p).success;
    expect(ok({ canSizeMg: 9_999 })).toBe(false);
    expect(ok({ canSizeMg: 10_000 })).toBe(true);
    expect(ok({ canSizeMg: 1_000_000 })).toBe(true);
    expect(ok({ canSizeMg: 1_000_001 })).toBe(false);
    expect(ok({ hungryAfterSecDefault: 3599 })).toBe(false);
    expect(ok({ hungryAfterSecDefault: 86_401 })).toBe(false);
    expect(ok({ ozStepHundredths: 75 })).toBe(false);
    expect(ok({ canFractionStep: "1/5" })).toBe(false);
  });

  it("login is lenient: houses made under older setup rules must still get in", () => {
    expect(LoginBodySchema.safeParse({ houseName: "x", pin: "1" }).success).toBe(true);
    expect(LoginBodySchema.safeParse({ houseName: "", pin: "1" }).success).toBe(false);
    expect(LoginBodySchema.safeParse({ houseName: "x", pin: "" }).success).toBe(false);
  });

  it("logs upload takes no source (server stamps it) and measures data in UTF-8 bytes", () => {
    const entry = { ts: 1, level: "info", msg: "x" };
    expect(LogsUploadBodySchema.safeParse([entry]).success).toBe(true);
    const parsed = LogsUploadBodySchema.parse([{ ...entry, source: "device", deviceId: "d1" }]);
    expect(parsed[0]).not.toHaveProperty("source");
    expect(parsed[0]).not.toHaveProperty("deviceId");
    // {"k":"..."} wraps the string in 8 bytes of JSON syntax
    const withBytes = (n: number) => ({ ...entry, data: { k: "a".repeat(n - 8) } });
    expect(JSON.stringify(withBytes(1024).data).length).toBe(1024);
    expect(LogsUploadBodySchema.safeParse([withBytes(1024)]).success).toBe(true);
    expect(LogsUploadBodySchema.safeParse([withBytes(1025)]).success).toBe(false);
    // 510 two-byte chars are 518 UTF-16 units (under the limit) but 1028 UTF-8 bytes (over it)
    const multibyte = { ...entry, data: { k: "é".repeat(510) } };
    expect(LogsUploadBodySchema.safeParse([multibyte]).success).toBe(false);
  });

  it("debug logs query keeps device, coerces and bounds limit", () => {
    expect(DebugLogsQuerySchema.parse({ device: "d1" }).device).toBe("d1");
    expect(DebugLogsQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(DebugLogsQuerySchema.parse({}).limit).toBe(200);
    expect(DebugLogsQuerySchema.safeParse({ limit: "0" }).success).toBe(false);
    expect(DebugLogsQuerySchema.safeParse({ limit: "501" }).success).toBe(false);
  });

  it("feedings cursor is fedAt:id and round-trips", () => {
    const c = encodeFeedingsCursor(1_700_000_000_000, uuid);
    expect(c).toBe(`1700000000000:${uuid}`);
    expect(decodeFeedingsCursor(c)).toEqual({ fedAt: 1_700_000_000_000, id: uuid });
    expect(() => decodeFeedingsCursor("abc")).toThrow();
  });

  it("feedings page cursor is null or fedAt:id", () => {
    expect(FeedingsPageSchema.safeParse({ items: [], nextCursor: null }).success).toBe(true);
    expect(FeedingsPageSchema.safeParse({ items: [], nextCursor: `1700000000000:${uuid}` }).success).toBe(true);
    expect(FeedingsPageSchema.safeParse({ items: [], nextCursor: 1700000000000 }).success).toBe(false);
  });

  it("DebugLogsQuerySchema accepts minLevel and keeps level", () => {
    expect(DebugLogsQuerySchema.parse({ minLevel: "warn" })).toMatchObject({ minLevel: "warn", limit: 200 });
    expect(DebugLogsQuerySchema.safeParse({ minLevel: "loud" }).success).toBe(false);
  });
});

describe("UuidSchema", () => {
  it("takes only the lowercase canonical form, for query params as well as bodies", () => {
    expect(UuidSchema.safeParse(uuid).success).toBe(true);
    expect(UuidSchema.safeParse(uuid.toUpperCase()).success).toBe(false);
    expect(UuidSchema.safeParse("nope").success).toBe(false);
  });
});
