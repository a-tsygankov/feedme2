import { describe, expect, it } from "vitest";
import {
  CatCreateSchema, FeedingCreateSchema, HousePatchSchema, LogsUploadBodySchema, SetupBodySchema, CAT_COLORS,
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
    const entry = { ts: 1, level: "info", source: "web", msg: "x" };
    expect(LogsUploadBodySchema.safeParse(Array(50).fill(entry)).success).toBe(true);
    expect(LogsUploadBodySchema.safeParse(Array(51).fill(entry)).success).toBe(false);
    const big = { ...entry, data: { blob: "y".repeat(1100) } };
    expect(LogsUploadBodySchema.safeParse([big]).success).toBe(false);
  });
});
