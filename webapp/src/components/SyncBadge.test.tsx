// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DrainReport, SyncSnapshot } from "../lib/sync-engine.ts";
import { SyncBadge, SyncDroppedBanner } from "./SyncBadge.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLElement;
afterEach(() => { act(() => root?.unmount()); root = null; });
function mount(node: React.ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(node));
}

function fakeEngine(initial: SyncSnapshot) {
  let snap = initial;
  const ls = new Set<() => void>();
  const drained = new Set<(r: DrainReport) => void>();
  return {
    subscribe: (l: () => void) => { ls.add(l); return () => void ls.delete(l); },
    getSnapshot: () => snap,
    drain: vi.fn(async () => ({ sent: 0, dropped: 0, stopped: false })),
    onDrained: (cb: (r: DrainReport) => void) => { drained.add(cb); return () => void drained.delete(cb); },
    set(next: SyncSnapshot) { snap = next; act(() => ls.forEach((l) => l())); },
    emit(r: DrainReport) { act(() => drained.forEach((cb) => cb(r))); },
  };
}

describe("SyncBadge", () => {
  it("keeps an empty polite live region in the DOM when nothing is pending", () => {
    mount(<SyncBadge engine={fakeEngine({ pending: 0, status: "idle" })} />);
    const region = host.querySelector('[role="status"]')!;
    expect(region.getAttribute("aria-live")).toBe("polite");
    expect(region.textContent).toBe("");
  });

  it("fills the same region as the state changes", () => {
    const e = fakeEngine({ pending: 0, status: "idle" });
    mount(<SyncBadge engine={e} />);
    const region = host.querySelector('[role="status"]')!;
    e.set({ pending: 2, status: "offline" });
    expect(host.querySelector('[role="status"]')).toBe(region);
    expect(region.textContent).toBe("2 to sync · offline");
    e.set({ pending: 2, status: "syncing" });
    expect(region.textContent).toBe("syncing…");
  });

  it("an error is a retry button that drains", () => {
    const e = fakeEngine({ pending: 1, status: "error" });
    mount(<SyncBadge engine={e} />);
    const b = host.querySelector("button")!;
    expect(b.textContent).toBe("sync problem · tap to retry");
    act(() => b.click());
    expect(e.drain).toHaveBeenCalledTimes(1);
  });
});

describe("SyncDroppedBanner", () => {
  it("shows an alert with the dropped count, accumulates, and can be dismissed", () => {
    const e = fakeEngine({ pending: 0, status: "idle" });
    mount(<SyncDroppedBanner engine={e} />);
    expect(host.querySelector('[data-testid="sync-dropped"]')).toBeNull();
    e.emit({ sent: 3, dropped: [] });
    expect(host.querySelector('[data-testid="sync-dropped"]')).toBeNull();
    e.emit({ sent: 0, dropped: [{ kind: "create", feedingId: "a", status: 404, reason: "x" }] });
    const banner = host.querySelector('[data-testid="sync-dropped"]')!;
    expect(banner.getAttribute("role")).toBe("alert");
    expect(banner.textContent).toContain("1 feeding change couldn't be saved");
    e.emit({ sent: 0, dropped: [{ kind: "patch", feedingId: "b", status: 400, reason: "x" }, { kind: "delete", feedingId: "c", status: 404, reason: "x" }] });
    expect(host.querySelector('[data-testid="sync-dropped"]')!.textContent).toContain("3 feeding changes couldn't be saved");
    act(() => host.querySelector<HTMLButtonElement>('[data-testid="sync-dropped"] button')!.click());
    expect(host.querySelector('[data-testid="sync-dropped"]')).toBeNull();
  });
});
