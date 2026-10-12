// @vitest-environment jsdom
// No testing-library in this repo: mount with react-dom/client inside act(), as Reports.test.tsx does.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateReport, type Cat } from "@feedme2/shared";
import { seedMonth } from "../../../../shared/src/testing/seed-month.ts";

vi.mock("../../lib/api-client.ts", async (orig) => {
  const real = await orig<typeof import("../../lib/api-client.ts")>();
  return { ...real, api: { ...real.api, reportSummary: vi.fn() } };
});
vi.mock("../../hooks/use-house.ts", () => ({ useHouse: vi.fn() }));

import { CatTrends } from "./CatTrends.tsx";
import { NetworkError, api } from "../../lib/api-client.ts";
import { useHouse } from "../../hooks/use-house.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TZ = "Europe/Berlin";
const seed = seedMonth();
const mochi = seed.cats[0];
const cat = {
  ...mochi, houseId: "5eed0000-0000-4000-8000-0000000000aa", avatarPose: "sit", hungryAfterSec: 43_200, sortOrder: 0,
  defaultAmountMg: null, defaultEnteredUnit: null, defaultEnteredValue: null, lastFedAt: null, createdAt: 0, modifiedAt: 0,
} as unknown as Cat;
// 22:30 UTC on 31 Mar is already 00:30 on 1 Apr in Berlin (CEST): "today" is the house's, not the browser's.
const NOW = Date.UTC(2026, 2, 31, 22, 30);
const FROM = "2026-03-03";
const TO = "2026-04-01";
const summary = aggregateReport({
  feedings: seed.feedings.filter((f) => f.catId === mochi.id), cats: [{ ...mochi, deleted: false }], from: FROM, to: TO,
  timeZone: TZ, bucket: "day", foodUnit: "g", canSizeMg: 155_922,
});
const summaryMock = vi.mocked(api.reportSummary);

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(Date, "now").mockReturnValue(NOW);
  summaryMock.mockResolvedValue(summary);
  vi.mocked(useHouse).mockReturnValue({ data: { id: "h", name: "Home", settings: { timezone: TZ, foodUnit: "g", canSizeMg: 155_922 } } } as never);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function renderTrends() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter><CatTrends cat={cat} /></MemoryRouter>
      </QueryClientProvider>,
    );
  });
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
async function waitFor<T>(fn: () => T): Promise<T> {
  let last: unknown;
  for (let i = 0; i < 30; i++) {
    try { return fn(); } catch (e) { last = e; }
    await flush();
  }
  throw last;
}
const getByTestId = (id: string, within: ParentNode = host) => {
  const el = within.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  return el;
};
const findByTestId = (id: string) => waitFor(() => getByTestId(id));

describe("CatTrends", () => {
  it("asks for the cat's last 30 house-zone days by day", async () => {
    await renderTrends();
    await findByTestId("cat-trends-chart");
    expect(api.reportSummary).toHaveBeenCalledWith({ from: FROM, to: TO, cat: mochi.id, bucket: "day" });
  });

  it("draws 30 day bars in the cat's colour and the three tiles", async () => {
    await renderTrends();
    const chart = await findByTestId("cat-trends-chart");
    expect(chart.querySelectorAll('[data-testid^="bar-"]')).toHaveLength(30);
    const visible = getByTestId("bar-2026-03-15", chart).querySelectorAll("rect");
    expect(visible[visible.length - 1]!.getAttribute("fill")).toBe(mochi.color);
    expect(getByTestId("trend-feedings").textContent).toContain("58");
    expect(getByTestId("trend-mean-interval").textContent).toMatch(/\d+ h/);
    expect(getByTestId("trend-longest-gap").textContent).toMatch(/\d+ h/);
    expect(getByTestId("cat-trends").textContent).toContain("Amount per day");
    expect(host.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it("links to the same range in Reports", async () => {
    await renderTrends();
    const link = await findByTestId("cat-trends-link");
    expect(link.getAttribute("href")).toBe(`/reports?range=custom&from=${FROM}&to=${TO}&cat=${mochi.id}`);
    expect(link.textContent).toContain("Open in Reports");
  });

  it("says trends need a connection when offline with nothing cached", async () => {
    summaryMock.mockRejectedValue(new NetworkError());
    await renderTrends();
    expect((await findByTestId("cat-trends-offline")).textContent).toContain("Trends need a connection");
    expect(host.querySelector('[data-testid="cat-trends-chart"]')).toBeNull();
  });
});
