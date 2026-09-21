import { describe, expect, it, vi } from "vitest";
import { createUpdateStore, isNewerBuildServed, type UpdateStoreDeps } from "./pwa-update.ts";

function make() {
  const deps: UpdateStoreDeps = { skipWaiting: vi.fn(), reload: vi.fn() };
  return { deps, store: createUpdateStore(deps) };
}

describe("createUpdateStore", () => {
  it("starts idle and becomes ready when a worker is waiting", () => {
    const { store } = make();
    expect(store.getSnapshot()).toBe("idle");
    store.markReady();
    expect(store.getSnapshot()).toBe("ready");
  });

  it("notifies subscribers once per change", () => {
    const { store } = make();
    const listener = vi.fn();
    store.subscribe(listener);
    store.markReady();
    store.markReady();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("apply asks the worker to skip waiting, once", () => {
    const { store, deps } = make();
    store.markReady();
    store.apply();
    store.apply();
    expect(deps.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("apply does nothing when nothing is waiting", () => {
    const { store, deps } = make();
    store.apply();
    expect(deps.skipWaiting).not.toHaveBeenCalled();
  });

  it("reloads only the tab that applied, and only once", () => {
    const { store, deps } = make();
    store.onControllerChange(); // first install: not an update
    expect(deps.reload).not.toHaveBeenCalled();
    store.markReady();
    store.apply();
    store.onControllerChange();
    store.onControllerChange();
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("dismiss hides the bar; a newer build clears the dismissal", () => {
    const { store } = make();
    store.markReady();
    store.dismiss();
    expect(store.getSnapshot()).toBe("dismissed");
    store.markReady();
    expect(store.getSnapshot()).toBe("ready");
  });

  it("reload mode applies by reloading immediately, without skipWaiting", () => {
    const { store, deps } = make();
    store.markReady("reload");
    store.apply();
    expect(deps.skipWaiting).not.toHaveBeenCalled();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    store.onControllerChange();
    expect(deps.reload).toHaveBeenCalledTimes(1);
  });

  it("a stalled worker apply can be retried after the timeout", () => {
    let pending: (() => void) | null = null;
    const deps = { skipWaiting: vi.fn(), reload: vi.fn(), setTimer: (fn: () => void) => { pending = fn; } };
    const store = createUpdateStore(deps);
    store.markReady();
    store.apply();
    store.apply();
    expect(deps.skipWaiting).toHaveBeenCalledTimes(1);
    pending!();
    store.apply();
    expect(deps.skipWaiting).toHaveBeenCalledTimes(2);
    expect(deps.reload).not.toHaveBeenCalled();
  });

  it("a timeout that fires after the reload does nothing", () => {
    let pending: (() => void) | null = null;
    const deps = { skipWaiting: vi.fn(), reload: vi.fn(), setTimer: (fn: () => void) => { pending = fn; } };
    const store = createUpdateStore(deps);
    store.markReady();
    store.apply();
    store.onControllerChange();
    pending!();
    expect(deps.reload).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toBe("ready");
  });
});

describe("isNewerBuildServed", () => {
  it("is true only when the served version is strictly newer", () => {
    expect(isNewerBuildServed("0.1.5", "0.1.4")).toBe(true);
    expect(isNewerBuildServed("0.1.4", "0.1.4")).toBe(false);
    expect(isNewerBuildServed("0.1.3", "0.1.4")).toBe(false);
  });
  it("is false for garbage", () => {
    expect(isNewerBuildServed(null, "0.1.4")).toBe(false);
    expect(isNewerBuildServed(undefined, "0.1.4")).toBe(false);
  });
});
