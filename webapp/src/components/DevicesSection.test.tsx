// @vitest-environment jsdom
// No testing-library in this repo: render to static markup with the query cache pre-filled (effects do not run).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { Device } from "@feedme2/shared";

vi.mock("../lib/api-client.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/api-client.ts")>()),
  api: { listDevices: vi.fn(), patchDevice: vi.fn(), deleteDevice: vi.fn(), confirmPair: vi.fn() },
}));

import { DevicesSection } from "./DevicesSection.tsx";
import { devicesKey } from "../hooks/use-devices.ts";

const NOW = Date.now();
const dev = (over: Partial<Device>): Device => ({
  id: "a".repeat(32), houseId: "h", name: "Kitchen", hwModel: "crowpanel-1.28", fwVersion: "0.2.3", lastSeenAt: NOW - 5 * 60_000,
  batteryPct: 87, resetReason: null, autoInstall: false, createdAt: NOW - 1000, revokedAt: null, ...over,
});

function render(devices: Device[], url = "/settings"): string {
  const qc = new QueryClient();
  qc.setQueryData(devicesKey, devices);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><DevicesSection /></MemoryRouter>
    </QueryClientProvider>,
  );
}
/** The opening tag carrying a test id (attribute order is React's business, not the test's). */
const tag = (html: string, id: string) => html.match(new RegExp(`<[^>]*data-testid="${id}"[^>]*>`))?.[0] ?? "";
const count = (html: string, id: string) => html.split(`data-testid="${id}"`).length - 1;

describe("DevicesSection", () => {
  it("lists each device with its status line, plus the pair form with a disabled submit", () => {
    const html = render([dev({}), dev({ id: "b".repeat(32), name: "Hall", lastSeenAt: null, batteryPct: null })]);
    expect(count(html, "device-row")).toBe(2);
    expect(html).toContain("Kitchen");
    expect(html).toContain("fw 0.2.3 · seen 5 m ago · 87%");
    expect(html).toContain("Hall");
    expect(html).toContain("fw 0.2.3 · never seen");
    expect(count(html, "device-rename")).toBe(2);
    expect(count(html, "device-forget")).toBe(2);
    expect(count(html, "pair-code")).toBe(1);
    expect(count(html, "pair-name")).toBe(1);
    expect(tag(html, "pair-submit")).toMatch(/ disabled(=""| |>)/);
    expect(count(html, "pair-error")).toBe(0);
  });

  it("shows the empty state", () => {
    const html = render([]);
    expect(html).toContain("No devices paired yet.");
    expect(count(html, "device-row")).toBe(0);
  });

  it("prefills the code from ?pair= (the device's QR link) and enables submit", () => {
    const html = render([], "/settings?pair=123456");
    expect(tag(html, "pair-code")).toContain('value="123456"');
    expect(tag(html, "pair-submit")).not.toMatch(/ disabled(=""| |>)/);
  });

  it("ignores a malformed ?pair= value", () => {
    const html = render([], "/settings?pair=12ab");
    expect(html).not.toContain('value="12ab"');
    expect(tag(html, "pair-submit")).toMatch(/ disabled(=""| |>)/);
  });
});
