import { describe, expect, it } from "vitest";
import { formatAmount } from "@feedme2/shared";
import { formatDuration, formatTotal, periodLabel, weekRowLabel } from "./report-format.ts";

const house = { foodUnit: "g" as const, canSizeMg: 155_922 };

describe("formatDuration", () => {
  it("drops zero parts and never rounds up into the next minute", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(2700)).toBe("45 m");
    expect(formatDuration(43_111)).toBe("11 h 58 m"); // 11 h 58 m 31 s
    expect(formatDuration(64_800)).toBe("18 h");
    expect(formatDuration(93_600)).toBe("1 d 2 h");
    expect(formatDuration(59)).toBe("0 m");
  });
  it("shows a dash for a value that is not a duration", () => {
    expect(formatDuration(Number.NaN)).toBe("—");
    expect(formatDuration(-5)).toBe("—");
  });
});

describe("formatTotal", () => {
  it("uses the house unit or cans", () => {
    expect(formatTotal(5_240_000, "house", house)).toBe(formatAmount(5_240_000, "g", 155_922));
    expect(formatTotal(5_240_000, "can", house)).toBe("33.61 cans");
  });
});

describe("periodLabel", () => {
  it("labels each bucket by its own unit", () => {
    expect(periodLabel("2026-03-29T07", "hour")).toBe("07");
    expect(periodLabel("2026-03-29", "day")).toBe("29");
    expect(periodLabel("2026-03-23", "week")).toBe("23 Mar");
    expect(periodLabel("2026-03", "month")).toBe("Mar");
  });
});

describe("weekRowLabel", () => {
  it("names only what differs, and marks a week cut by the range", () => {
    expect(weekRowLabel("2026-03-23", "2026-03-01", "2026-03-31")).toBe("23 – 29 Mar");
    expect(weekRowLabel("2026-02-23", "2026-03-01", "2026-03-31")).toBe("23 Feb – 1 Mar (from 1 Mar)");
    expect(weekRowLabel("2026-03-30", "2026-03-01", "2026-03-31")).toBe("30 Mar – 5 Apr (until 31 Mar)");
    expect(weekRowLabel("2025-12-29", "2025-12-01", "2026-01-31")).toBe("29 Dec 2025 – 4 Jan 2026");
  });
});
