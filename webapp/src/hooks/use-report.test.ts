import { describe, expect, it } from "vitest";
import { reportKey } from "./use-report.ts";

describe("reportKey", () => {
  const f = { from: "2026-03-01", to: "2026-03-31", cat: null } as const;

  it("differs by house timezone: the zone decides which day a feeding falls on", () => {
    expect(reportKey(f, "day", "Europe/Berlin")).not.toEqual(reportKey(f, "day", "America/New_York"));
  });

  it("is stable for the same range, cat, bucket and zone", () => {
    expect(reportKey(f, "day", "Europe/Berlin")).toEqual(reportKey({ ...f }, "day", "Europe/Berlin"));
  });

  it("stays under the report root, which house and cat changes invalidate", () => {
    expect(reportKey(f, "week", "UTC")[0]).toBe("report");
  });
});
