import { describe, expect, it } from "vitest";
import { ApiError, NetworkError } from "./api-client.ts";
import { deviceStatusLine, pairErrorMessage } from "./devices-ui.ts";

describe("devices ui helpers", () => {
  it("maps pairing failures to plain sentences", () => {
    expect(pairErrorMessage(new ApiError(404, { error: "pair_code_unknown" }))).toBe("That code was not found or has expired. Ask the device for a new one.");
    expect(pairErrorMessage(new ApiError(409, { error: "pair_code_used" }))).toBe("That code was already used.");
    expect(pairErrorMessage(new ApiError(409, { error: "device_in_use" }))).toBe("That device still belongs to another house. Forget it there first.");
    expect(pairErrorMessage(new ApiError(400, { error: "invalid_request", issues: [] }))).toBe("Enter the six digits shown on the device.");
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
