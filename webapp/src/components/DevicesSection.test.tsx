// @vitest-environment jsdom
// No testing-library in this repo: render to static markup with the query cache pre-filled (effects do not run).
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter, useLocation } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Device } from "@feedme2/shared";

vi.mock("../lib/api-client.ts", async (orig) => ({
  ...(await orig<typeof import("../lib/api-client.ts")>()),
  api: { listDevices: vi.fn(), patchDevice: vi.fn(), deleteDevice: vi.fn(), confirmPair: vi.fn() },
}));

import { DevicesSection } from "./DevicesSection.tsx";
import { devicesKey } from "../hooks/use-devices.ts";
import { ApiError, api } from "../lib/api-client.ts";

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
    expect(html).not.toContain('role="alert"');
    // The live region exists before there is anything to announce, and the code field does not autofill.
    expect(tag(html, "pair-success")).toContain('role="status"');
    expect(tag(html, "pair-code")).toContain('autoComplete="off"');
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

// ---- interactive behaviour (mounted, effects run) ----
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mocked = api as unknown as Record<"listDevices" | "patchDevice" | "deleteDevice" | "confirmPair", ReturnType<typeof vi.fn>>;

let host: HTMLDivElement;
let root: Root;
let location: { pathname: string; search: string };
function Probe() { const l = useLocation(); location = l; return null; }

async function mount(url: string, devices: Device[] | "pending" = []) {
  mocked.listDevices.mockReturnValue(devices === "pending" ? new Promise(() => {}) : Promise.resolve({ devices }));
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[url]}><Probe /><section><DevicesSection /></section></MemoryRouter>
      </QueryClientProvider>,
    );
  });
  await flush();
  return qc;
}
/** react-query delivers results on a timer tick, so one act() is not enough to see fetched data. */
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const byId = <T extends HTMLElement>(id: string) => host.querySelector<T>(`[data-testid="${id}"]`)!;
const click = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const key = (el: Element, k: string) => act(async () => { el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true })); });
function type(el: HTMLInputElement, value: string) {
  return act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const submit = () => act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });

describe("DevicesSection (mounted)", () => {
  const scrollIntoView = vi.fn();
  beforeEach(() => {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    Object.values(mocked).forEach((m) => m.mockReset());
    scrollIntoView.mockReset();
    Element.prototype.scrollIntoView = scrollIntoView;
  });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it("scrolls to the section only after the devices have loaded, once", async () => {
    let resolve!: (v: { devices: Device[] }) => void;
    mocked.listDevices.mockReturnValue(new Promise((r) => { resolve = r; }));
    const qc = new QueryClient();
    await act(async () => {
      root.render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={["/settings?pair=123456"]}><section><DevicesSection /></section></MemoryRouter></QueryClientProvider>);
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    await act(async () => { resolve({ devices: [dev({})] }); });
    await flush();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    await act(async () => { await qc.invalidateQueries({ queryKey: devicesKey }); });
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it("clears ?pair= after a successful pairing so a reload does not re-prefill the used code", async () => {
    mocked.confirmPair.mockResolvedValue({ device: dev({ name: "Kitchen" }) });
    await mount("/settings?pair=123456&x=1");
    expect(byId<HTMLInputElement>("pair-code").value).toBe("123456");
    await submit();
    expect(mocked.confirmPair).toHaveBeenCalledWith({ pairCode: "123456" });
    expect(location.search).toBe("");
    expect(byId("pair-success").textContent).toBe("Paired Kitchen");
    expect(byId<HTMLInputElement>("pair-code").value).toBe("");
  });

  it("ties a pairing error to the code field for assistive tech", async () => {
    mocked.confirmPair.mockRejectedValue(new ApiError(404, { error: "pair_code_unknown" }));
    await mount("/settings?pair=123456");
    await submit();
    const input = byId<HTMLInputElement>("pair-code");
    const note = host.querySelector('[role="alert"]')!;
    expect(note.textContent).toContain("not found");
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.getAttribute("aria-describedby")).toContain(note.id);
  });

  it("rename: focuses the input, Enter saves, and an unchanged name sends nothing", async () => {
    mocked.patchDevice.mockResolvedValue({ device: dev({ name: "Hall" }) });
    await mount("/settings", [dev({})]);
    await click(byId("device-rename"));
    const input = byId<HTMLInputElement>("device-name-input");
    expect(document.activeElement).toBe(input);
    await key(input, "Enter");
    expect(mocked.patchDevice).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="device-name-input"]')).toBeNull();

    await click(byId("device-rename"));
    await type(byId<HTMLInputElement>("device-name-input"), "  Hall ");
    await key(byId("device-name-input"), "Enter");
    expect(mocked.patchDevice).toHaveBeenCalledTimes(1);
    expect(mocked.patchDevice).toHaveBeenCalledWith("a".repeat(32), { name: "Hall" });
  });

  it("rename: Escape cancels and drops a stale row error", async () => {
    mocked.patchDevice.mockRejectedValue(new ApiError(500, null));
    await mount("/settings", [dev({})]);
    await click(byId("device-rename"));
    await type(byId<HTMLInputElement>("device-name-input"), "Hall");
    await key(byId("device-name-input"), "Enter");
    expect(host.textContent).toContain("Couldn't rename the device");
    await key(byId("device-name-input"), "Escape");
    expect(host.querySelector('[data-testid="device-name-input"]')).toBeNull();
    expect(host.textContent).not.toContain("Couldn't rename the device");
  });

  it("disables Forget while a forget is in flight", async () => {
    mocked.deleteDevice.mockReturnValue(new Promise(() => {}));
    await mount("/settings", [dev({})]);
    await click(byId("device-forget"));
    await click(byId("device-forget"));
    expect(mocked.deleteDevice).toHaveBeenCalledTimes(1);
    expect(byId<HTMLButtonElement>("device-forget").disabled).toBe(true);
  });
});
