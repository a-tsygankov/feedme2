import { describe, expect, it } from "vitest";
import sample from "../../fixtures/device-state.sample.json";
import {
  DeviceFeedingCreateSchema, DeviceIdSchema, DeviceStateSchema, HeartbeatBodySchema, PairCheckResponseSchema,
  PairCodeSchema, PairConfirmBodySchema, PairStartBodySchema,
} from "./device.ts";

const DEV = "0123456789abcdef0123456789abcdef";

describe("device contracts", () => {
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
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "crowpanel-1.28", fwVersion: "0.2.0" }).success).toBe(true);
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "toaster", fwVersion: "0.2.0" }).success).toBe(false);
    expect(PairStartBodySchema.safeParse({ deviceId: DEV, hwModel: "simulator", fwVersion: "v1" }).success).toBe(false);
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
  it("device feedings carry no note and heartbeat bounds battery", () => {
    expect(DeviceFeedingCreateSchema.safeParse({ id: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a11", catId: "4b1a0e2d-7c7b-4b7e-9a3a-5c3e2e1f0a12", fedAt: 1_700_000_000_000, amountMg: 40000, enteredUnit: "g", enteredValue: "40", note: "x" }).success).toBe(false);
    expect(HeartbeatBodySchema.safeParse({ fwVersion: "0.2.0", batteryPct: 101, uptimeSec: 1, resetReason: "POWERON", freeHeap: 1000 }).success).toBe(false);
    expect(HeartbeatBodySchema.safeParse({ fwVersion: "0.2.0", uptimeSec: 1, resetReason: "POWERON", freeHeap: 1000 }).success).toBe(true);
  });
});
