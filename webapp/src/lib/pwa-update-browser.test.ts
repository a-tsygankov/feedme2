// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const logger = vi.hoisted(() => ({ info: vi.fn(), warn: vi.fn() }));
vi.mock("./logger.ts", () => ({ appLog: logger }));
vi.mock("./versions.ts", () => ({ CLIENT_VERSION: "0.1.4" }));

type SwStub = {
  controller: object | null;
  register: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
};

function setupBrowser(served: string, controlled: boolean, waiting: object | null = null) {
  const registration = {
    waiting,
    installing: null,
    update: vi.fn().mockResolvedValue(undefined),
    addEventListener: vi.fn(),
  };
  const sw: SwStub = {
    controller: controlled ? {} : null,
    register: vi.fn().mockResolvedValue(registration),
    addEventListener: vi.fn(),
  };
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: sw });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ webapp: served }),
  }));
  return { sw, registration };
}

beforeEach(() => {
  vi.resetModules();
  vi.spyOn(window, "setInterval").mockImplementation(() => 1);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "serviceWorker", { configurable: true, value: undefined });
});

describe("PWA startup version checks", () => {
  it("offers reload on startup for an uncontrolled page serving a newer build", async () => {
    const { registration } = setupBrowser("0.1.5", false);
    const { startUpdateWatch, updateStore } = await import("./pwa-update-browser.ts");
    startUpdateWatch();
    await vi.waitFor(() => expect(updateStore.getSnapshot()).toBe("ready"));
    expect(registration.update).toHaveBeenCalledTimes(1);
    updateStore.dismiss();
    document.dispatchEvent(new Event("visibilitychange"));
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(2));
    expect(updateStore.getSnapshot()).toBe("dismissed");
  });

  it("checks a controlled page immediately without a false reload offer", async () => {
    const { registration } = setupBrowser("0.1.5", true);
    const { startUpdateWatch, updateStore } = await import("./pwa-update-browser.ts");
    startUpdateWatch();
    await vi.waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
    expect(updateStore.getSnapshot()).toBe("idle");
  });

  it("still offers a waiting worker on a controlled page", async () => {
    const waiting = { postMessage: vi.fn() };
    setupBrowser("0.1.5", true, waiting);
    const { startUpdateWatch, updateStore } = await import("./pwa-update-browser.ts");
    startUpdateWatch();
    await vi.waitFor(() => expect(updateStore.getSnapshot()).toBe("ready"));
    updateStore.apply();
    expect(waiting.postMessage).toHaveBeenCalledWith({ type: "SKIP_WAITING" });
  });
});
