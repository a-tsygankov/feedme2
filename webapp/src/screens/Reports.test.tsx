// @vitest-environment jsdom
// No testing-library in this repo (and Phase 4 adds no dependency): mount with react-dom/client inside act(), with
// the few queries the plan's screen/within/waitFor snippets need written out below.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateReport, dayBoundsMs, type Feeding } from "@feedme2/shared";
import { seedMonth } from "../../../shared/src/testing/seed-month.ts";

vi.mock("../lib/api-client.ts", async (orig) => {
  const real = await orig<typeof import("../lib/api-client.ts")>();
  return { ...real, api: { ...real.api, reportSummary: vi.fn(), exportCsv: vi.fn(), listFeedings: vi.fn() } };
});
vi.mock("../lib/download.ts", () => ({ downloadBlob: vi.fn() }));
vi.mock("../hooks/use-house.ts", () => ({ useHouse: vi.fn() }));
vi.mock("../hooks/use-cats.ts", () => ({ useCats: vi.fn() }));
// The header needs the console provider and the sync engine; neither is what this screen is about.
vi.mock("../components/AppHeader.tsx", () => ({ AppHeader: () => null }));

import { Reports } from "./Reports.tsx";
import { ApiError, NetworkError, api } from "../lib/api-client.ts";
import { downloadBlob } from "../lib/download.ts";
import { useHouse } from "../hooks/use-house.ts";
import { useCats } from "../hooks/use-cats.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TZ = "Europe/Berlin";
const seed = seedMonth();
const monthSummary = aggregateReport({
  feedings: seed.feedings, cats: seed.cats.map((c) => ({ ...c, deleted: false })), from: "2026-03-01", to: "2026-03-31",
  timeZone: TZ, bucket: "day", foodUnit: "g", canSizeMg: 155_922,
});
const catsMock = vi.mocked(useCats);
const houseMock = vi.mocked(useHouse);
const summaryMock = vi.mocked(api.reportSummary);
const house = (foodUnit: "g" | "can" = "g") =>
  ({ data: { id: "h", name: "Home", settings: { timezone: TZ, foodUnit, canSizeMg: 155_922 } } }) as never;

let host: HTMLDivElement;
let root: Root;
let navigate: NavigateFunction;
function LocationProbe() {
  const l = useLocation();
  navigate = useNavigate();
  return <p data-testid="location">{l.search}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  summaryMock.mockResolvedValue(monthSummary);
  catsMock.mockReturnValue({ data: seed.cats } as never);
  houseMock.mockReturnValue(house());
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function renderReports(url = "/reports?range=month&from=2026-03-01") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}>
          <Routes><Route path="/reports" element={<><LocationProbe /><Reports /></>} /></Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
/** react-query delivers results on a timer tick, so one act() is not enough to see fetched data. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function waitFor<T>(fn: () => T): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try { return fn(); } catch (e) { last = e; }
    await flush();
  }
  throw last;
}
const queryByTestId = (id: string, within: ParentNode = host) => within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const getByTestId = (id: string, within: ParentNode = host) => {
  const el = queryByTestId(id, within);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  return el;
};
const findByTestId = (id: string, within: ParentNode = host) => waitFor(() => getByTestId(id, within));
/** A button by its accessible name: aria-label when it has one, else its text. */
const getButton = (within: ParentNode, name: RegExp) => {
  const all = [...within.querySelectorAll<HTMLElement>('button, [role="button"]')];
  const el = all.find((b) => name.test(b.getAttribute("aria-label") ?? b.textContent ?? ""));
  if (!el) throw new Error(`no button named ${name}`);
  return el;
};
const findButton = (within: ParentNode, name: RegExp) => waitFor(() => getButton(within, name));
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const location = () => getByTestId("location").textContent ?? "";

describe("Reports", () => {
  it("shows the month's totals", async () => {
    await renderReports();
    expect((await findByTestId("tile-feedings")).textContent).toContain("154");
    expect(getByTestId("tile-longest-gap").textContent).toContain("18 h");
    expect(api.reportSummary).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-03-31", bucket: "day" });
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("drills from a week row to its days, keeps it in the URL, and Back walks up again", async () => {
    await renderReports();
    await click(await findButton(await findByTestId("report-drill"), /23 – 29 Mar/));
    expect(location()).toContain("range=week&from=2026-03-23");
    await act(async () => { navigate(-1); });
    expect(location()).toBe("?range=month&from=2026-03-01");
  });

  it("labels the week cut by the start of the month as partial", async () => {
    await renderReports();
    const drill = await findByTestId("report-drill");
    await waitFor(() => getButton(drill, /from 1 Mar/));
  });

  it("opens the day from a day bar in the month chart (the drill table opens weeks)", async () => {
    await renderReports();
    const chart = await findByTestId("report-chart-feedings");
    await click(getByTestId("bar-2026-03-29", chart));
    expect(location()).toContain("range=day&from=2026-03-29");
  });

  it("hides the cat filter with one cat", async () => {
    catsMock.mockReturnValue({ data: [seed.cats[0]] } as never);
    await renderReports();
    await findByTestId("tile-feedings");
    expect(queryByTestId("report-cat")).toBeNull();
  });

  it("offers live cats only and labels a removed one in the legend", async () => {
    catsMock.mockReturnValue({ data: seed.cats } as never);
    summaryMock.mockResolvedValue({ ...monthSummary, cats: [...monthSummary.cats, { id: "ghost", name: "Ghost", color: "#607D8B", deleted: true }] });
    await renderReports();
    const select = await findByTestId("report-cat");
    expect([...select.querySelectorAll("option")].map((o) => o.textContent)).toEqual(["All cats", "Mochi", "Luna"]);
    const legend = await findByTestId("report-legend");
    expect([...legend.querySelectorAll("li")].map((li) => li.textContent)).toContain("Ghost (removed)");
  });

  it("offers the unit toggle unless the house already counts in cans", async () => {
    await renderReports();
    await findByTestId("tile-feedings");
    expect(queryByTestId("report-unit")).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(host);
    houseMock.mockReturnValue(house("can"));
    await renderReports();
    await findByTestId("tile-feedings");
    expect(queryByTestId("report-unit")).toBeNull();
  });

  it("asks for a connection when offline", async () => {
    summaryMock.mockRejectedValue(new NetworkError());
    await renderReports();
    expect((await findByTestId("report-offline")).textContent).toContain("Reports need a connection");
  });

  it("offers a retry for any other error", async () => {
    summaryMock.mockRejectedValueOnce(new ApiError(500, { error: "internal" }));
    await renderReports();
    const err = await findByTestId("report-error");
    expect(err.textContent).toContain("Couldn't load the report");
    await click(getButton(err, /Retry/));
    await findByTestId("tile-feedings");
    expect(api.reportSummary).toHaveBeenCalledTimes(2);
  });

  it("downloads the CSV for the current range", async () => {
    const blob = new Blob(["x"]);
    vi.mocked(api.exportCsv).mockResolvedValue(blob);
    await renderReports();
    await click(await findByTestId("report-csv"));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(blob, "feedme2-2026-03-01-2026-03-31.csv"));
    expect(api.exportCsv).toHaveBeenCalledWith({ from: "2026-03-01", to: "2026-03-31" });
  });

  it("lists a day's feedings oldest first in the house's zone, and hour bars do not drill", async () => {
    const day = "2026-03-29";
    const { fromMs, toMs } = dayBoundsMs(day, day, TZ);
    const items: Feeding[] = seed.feedings
      .filter((f) => f.fedAt >= fromMs && f.fedAt < toMs)
      .sort((a, b) => b.fedAt - a.fedAt) // the API pages newest first
      .map((f) => ({
        ...f, houseId: "h", enteredUnit: "g", enteredValue: String(f.amountMg / 1000), source: "web",
        deviceId: null, clientId: null, note: null, createdAt: f.fedAt, modifiedAt: f.fedAt,
      }));
    vi.mocked(api.listFeedings).mockResolvedValue({ items, nextCursor: null });
    summaryMock.mockResolvedValue(aggregateReport({
      feedings: seed.feedings, cats: seed.cats.map((c) => ({ ...c, deleted: false })), from: day, to: day,
      timeZone: TZ, bucket: "hour", foodUnit: "g", canSizeMg: 155_922,
    }));
    await renderReports(`/reports?range=day&from=${day}`);
    expect(api.reportSummary).toHaveBeenCalledWith({ from: day, to: day, bucket: "hour" });
    const rows = await waitFor(() => {
      const r = host.querySelectorAll('[data-testid="day-feeding"]');
      if (r.length !== 5) throw new Error(`rows: ${r.length}`);
      return [...r];
    });
    // The route's `to` is inclusive, hence the - 1.
    expect(api.listFeedings).toHaveBeenCalledWith({ from: fromMs, to: toMs - 1, limit: 200 });
    // 2026-03-29 is the spring-forward day: the house-zone wall times still read as fed.
    expect(rows.map((r) => r.querySelector("time")!.textContent)).toEqual(["07:00", "07:30", "13:00", "19:00", "20:00"]);
    expect(rows[0]!.textContent).toContain("Luna");
    expect(rows[0]!.querySelector("time")!.getAttribute("dateTime")).toBe(new Date(items[4]!.fedAt).toISOString());
    expect((await findByTestId("report-chart-feedings")).querySelector('[role="button"]')).toBeNull();
  });
});
