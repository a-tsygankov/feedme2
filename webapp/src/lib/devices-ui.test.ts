import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api-client.ts";
import { deviceStatusLine, pairErrorMessage } from "./devices-ui.ts";

describe("devices ui helpers", () => {
  it("maps pairing failures to plain sentences", () => {
    expect(pairErrorMessage(new ApiError(404, { error: "pair_code_unknown" }))).toBe("That code was not found or has expired. Ask the device for a new one.");
    expect(pairErrorMessage(new ApiError(409, { error: "pair_code_used" }))).toBe("That code was already used.");
    expect(pairErrorMessage(new ApiError(409, { error: "device_in_use" }))).toBe("That device still belongs to another house. Forget it there first.");
    expect(pairErrorMessage(new ApiError(400, { error: "invalid_request", issues: [] }))).toBe("Enter the six digits shown on the device.");
    // 429 from the confirm budget: the wait is rounded up to whole minutes so "try again" is never too early.
    const tooMany = (retryAfterSec: number) => new ApiError(429, { error: "too_many_attempts", retryAfterSec });
    expect(pairErrorMessage(tooMany(600))).toBe("Too many wrong codes. Try again in 10 minutes.");
    expect(pairErrorMessage(tooMany(61))).toBe("Too many wrong codes. Try again in 2 minutes.");
    expect(pairErrorMessage(tooMany(120))).toBe("Too many wrong codes. Try again in 2 minutes.");
    expect(pairErrorMessage(tooMany(60))).toBe("Too many wrong codes. Try again in a minute.");
    expect(pairErrorMessage(tooMany(5))).toBe("Too many wrong codes. Try again in a minute.");
    expect(pairErrorMessage(new ApiError(429, { error: "too_many_attempts" }))).toBe("Too many wrong codes. Try again in a minute.");
    // A bare 404 (route missing, proxy hiccup) is not "code not found"; only the server's own code says that.
    expect(pairErrorMessage(new ApiError(404, { error: "not_found" }))).toBe("Something went wrong. Try again.");
    expect(pairErrorMessage(new ApiError(404, null))).toBe("Something went wrong. Try again.");
    expect(pairErrorMessage(new NetworkError())).toBe("Check your connection.");
    expect(pairErrorMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
  });
  it("summarises a device row", () => {
    const now = 1_700_000_000_000;
    const base = { id: "a".repeat(32), houseId: "h", name: "Kitchen", hwModel: "crowpanel-1.28" as const, fwVersion: "0.2.3", resetReason: null, autoInstall: false, createdAt: now - 1, revokedAt: null };
    expect(deviceStatusLine({ ...base, lastSeenAt: now - 5 * 60_000, batteryPct: 87 }, now)).toBe("fw 0.2.3 · seen 5 m ago · 87%");
    expect(deviceStatusLine({ ...base, lastSeenAt: null, batteryPct: null }, now)).toBe("fw 0.2.3 · never seen");
  });
});
