// @vitest-environment node
import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import { saveOnHide } from "./query-persister.ts";

function target() {
  const l = new Map<string, () => void>();
  return {
    addEventListener: (t: string, f: () => void) => { l.set(t, f); },
    removeEventListener: (t: string) => { l.delete(t); },
    fire: (t: string) => l.get(t)?.(),
    has: (t: string) => l.has(t),
  };
}

describe("saveOnHide", () => {
  // Incident: "add cat", reload within 1 s showed "No cats yet." because the throttled save had not run yet.
  it("saves when the page is hidden and on pagehide, not when it becomes visible", () => {
    const win = target();
    const doc = Object.assign(target(), { visibilityState: "visible" });
    const save = vi.fn();
    saveOnHide(win, doc, save);

    doc.fire("visibilitychange");
    expect(save).not.toHaveBeenCalled();
    doc.visibilityState = "hidden";
    doc.fire("visibilitychange");
    expect(save).toHaveBeenCalledTimes(1);
    win.fire("pagehide");
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("a failing save is swallowed and the disposer removes both listeners", () => {
    const win = target();
    const doc = Object.assign(target(), { visibilityState: "hidden" });
    const stop = saveOnHide(win, doc, () => Promise.reject(new Error("quota")));
    expect(() => win.fire("pagehide")).not.toThrow();
    stop();
    expect(win.has("pagehide")).toBe(false);
    expect(doc.has("visibilitychange")).toBe(false);
  });
});
