import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { REFRESH_AFTER_EDIT, REFRESH_AFTER_REFUSED, queriesToRefreshAfterDrain, refreshAfterHydration } from "./drain-refresh.ts";

describe("refreshAfterHydration", () => {
  it("marks every restored query stale, not only the cat and feeding lists", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 60_000 } } });
    const keys = [["cats"], ["feedings"], ["devices"], ["house"], ["feedings-history", "c1"], ["report", "2026-03-01", "2026-03-31", null, "day", "Europe/Berlin"]];
    for (const k of keys) qc.setQueryData(k, []);
    await refreshAfterHydration(qc);
    for (const k of keys) expect(qc.getQueryState(k)?.isInvalidated, JSON.stringify(k)).toBe(true);
  });
});

describe("queriesToRefreshAfterDrain", () => {
  it("refreshes nothing after a drain that changed nothing", () => {
    expect(queriesToRefreshAfterDrain({ sent: 0, dropped: [] })).toEqual([]);
  });

  it("refreshes the lists and the reports after a drain that sent feedings", () => {
    expect(queriesToRefreshAfterDrain({ sent: 2, dropped: [] })).toEqual([["cats"], ["feedings"], ["feedings-history"], ["report"]]);
  });

  it("refreshes the lists but not the reports when every op was refused", () => {
    const dropped = [{ reason: "x" }] as never;
    expect(queriesToRefreshAfterDrain({ sent: 0, dropped })).toEqual([["cats"], ["feedings"], ["feedings-history"]]);
  });
});

describe("REFRESH_AFTER_EDIT", () => {
  it("refreshes the reports as well as the lists after an edit or delete on the cat page", () => {
    expect(REFRESH_AFTER_EDIT).toEqual([["feedings"], ["feedings-history"], ["cats"], ["report"]]);
  });
});

describe("REFRESH_AFTER_REFUSED", () => {
  it("refreshes only the lists when the server refused the cat page's edit: nothing changed there, so reports stay", () => {
    expect(REFRESH_AFTER_REFUSED).toEqual([["feedings"], ["feedings-history"], ["cats"]]);
    expect(REFRESH_AFTER_REFUSED).not.toContainEqual(["report"]);
  });
});
