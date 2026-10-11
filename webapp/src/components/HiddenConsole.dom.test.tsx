// @vitest-environment jsdom
// No testing-library in this repo: drive the real DOM with react-dom/client inside act().
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LogEntry } from "@feedme2/shared";
import { HiddenConsole, TEXT_DEBOUNCE_MS, type ConsoleDataSource } from "./HiddenConsole.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let appRoot: HTMLElement;
let opener: HTMLButtonElement;
let mount: Root;

beforeEach(() => {
  vi.useFakeTimers();
  appRoot = document.createElement("div");
  appRoot.id = "root";
  opener = document.createElement("button");
  appRoot.append(opener);
  document.body.append(appRoot);
  opener.focus();
  const host = document.createElement("div");
  appRoot.append(host);
  mount = createRoot(host);
});

afterEach(() => {
  act(() => mount.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
});

const entry = (ts: number, msg: string): LogEntry => ({ ts, level: "info", source: "web", msg });
function source() {
  const ds = {
    getVersions: vi.fn(async () => ({ client: "1", worker: "2", schema: "3", firmware: null, env: null })),
    getRemoteLogs: vi.fn(async () => ({ status: "ok" as const, entries: [entry(2, "remote line")] })),
    getLocalLogs: vi.fn(() => [entry(1, "local line")]),
  };
  return ds satisfies ConsoleDataSource;
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });
const byId = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const click = (id: string) => act(() => { byId(id).click(); });
function type(id: string, value: string) {
  const input = byId(id) as HTMLInputElement;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("HiddenConsole", () => {
  it("is a modal dialog; focus moves in, the app goes inert, and closing restores both", async () => {
    const onClose = vi.fn();
    act(() => mount.render(<HiddenConsole onClose={onClose} dataSource={source()} />));
    await flush();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(appRoot.contains(dialog)).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(appRoot.hasAttribute("inert")).toBe(true);
    act(() => mount.render(null));
    expect(appRoot.hasAttribute("inert")).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it("buttons and the search box are at least 44 px tall", async () => {
    act(() => mount.render(<HiddenConsole onClose={() => {}} dataSource={source()} />));
    await flush();
    for (const id of ["console-refresh", "console-live", "console-copy", "console-download", "console-close", "filter-web", "level-warn", "filter-text"]) {
      expect(byId(id).className).toContain("min-h-[44px]");
    }
  });

  it("fetches versions once per open, not per filter change or Live tick; logs refetch on a server-side filter change", async () => {
    const ds = source();
    act(() => mount.render(<HiddenConsole onClose={() => {}} dataSource={ds} />));
    await flush();
    expect(ds.getVersions).toHaveBeenCalledTimes(1);
    expect(ds.getRemoteLogs).toHaveBeenCalledTimes(1);
    expect(ds.getRemoteLogs).toHaveBeenLastCalledWith({ source: "all", minLevel: "debug", device: "" });

    click("level-warn");
    await flush();
    expect(ds.getRemoteLogs).toHaveBeenLastCalledWith({ source: "all", minLevel: "warn", device: "" });
    click("filter-device");
    await flush();
    expect(ds.getRemoteLogs).toHaveBeenLastCalledWith({ source: "device", minLevel: "warn", device: "" });
    type("filter-device-id", "dev-9");
    await act(async () => { await vi.advanceTimersByTimeAsync(TEXT_DEBOUNCE_MS); });
    expect(ds.getRemoteLogs).toHaveBeenLastCalledWith({ source: "device", minLevel: "warn", device: "dev-9" });

    click("console-live");
    const before = ds.getRemoteLogs.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(ds.getRemoteLogs.mock.calls.length).toBe(before + 2);
    expect(ds.getVersions).toHaveBeenCalledTimes(1);

    click("console-refresh");
    await flush();
    expect(ds.getVersions).toHaveBeenCalledTimes(2);
  });

  it("the text filter is local only: debounced 300 ms, and it never refetches", async () => {
    const ds = source();
    act(() => mount.render(<HiddenConsole onClose={() => {}} dataSource={ds} />));
    await flush();
    expect(document.querySelectorAll('[data-testid="log-entry"]')).toHaveLength(2);
    type("filter-text", "remote");
    expect(document.querySelectorAll('[data-testid="log-entry"]')).toHaveLength(2); // not yet
    await act(async () => { await vi.advanceTimersByTimeAsync(TEXT_DEBOUNCE_MS); });
    expect(document.querySelectorAll('[data-testid="log-entry"]')).toHaveLength(1);
    expect(ds.getRemoteLogs).toHaveBeenCalledTimes(1);
  });
});
