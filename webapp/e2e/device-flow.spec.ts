import { expect, test } from "@playwright/test";
import { DeviceSim } from "@feedme2/device-sim";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";
import { addCat, openSettings } from "./helpers/ui.ts";

/**
 * The Phase 2a exit test: a simulated CrowPanel pairs through the real Settings form, syncs a feeding and a log
 * line, and the web app shows both; forgetting the device kills its token. Runs against the local stack (the
 * sim talks to the same origin the page does, so vite's /api proxy and the worker are both in the path).
 */
test.describe("device flow (simulator)", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await requireTestAuth(page);
  });

  test("pair by code, feed from the device, see it on the dashboard, cat page and console, then forget it", async ({ page, baseURL }) => {
    const tokens = await signInAsTestHouse(page, uniqueHouseName("e2e-dev"));
    await addCat(page, "Mochi");

    const sim = new DeviceSim({ apiBase: baseURL!, fwVersion: "0.2.0" });
    const start = await sim.pairStart();

    await openSettings(page);
    await page.getByTestId("pair-code").fill(start.pairCode);
    await page.getByTestId("pair-name").fill("Kitchen");
    await page.getByTestId("pair-submit").click();
    await expect(page.getByTestId("pair-success")).toContainText("Kitchen");
    await expect(page.getByTestId("device-row")).toHaveCount(1);

    await sim.pairUntilConfirmed({ timeoutMs: 20_000, intervalMs: 250 });
    const { state } = await sim.fetchState();
    expect(state.cats.map((c) => c.name)).toEqual(["Mochi"]);
    expect(state.device.name).toBe("Kitchen");

    sim.feed("Mochi", 40_000);
    sim.log("info", "idle cat=Mochi level=content");
    const round = await sim.syncRound();
    // syncRound re-fetches the state after uploading, so the feeding must already have changed the etag by then.
    expect(round).toMatchObject({ feedingsAccepted: 1, logsSent: 1, stateChanged: true, heartbeat: true });

    await page.goto("/");
    const card = page.getByTestId("cat-card").first();
    await expect(card.getByTestId("cat-today")).toContainText("1 feeding");
    await card.getByRole("link", { name: "Mochi details" }).click();
    await expect(page.getByTestId("feeding-row").first()).toContainText("device");

    // The state the round fetched reflects the feeding; asking again with that etag is a 304.
    expect(sim.snapshot().state!.cats[0]!.lastFedAt).not.toBeNull();
    expect((await sim.fetchState()).changed).toBe(false);

    // Console: the device's own line, attributed to the device.
    await page.goto("/");
    await page.getByTestId("app-logo").click({ clickCount: 3 });
    await expect(page.getByTestId("hidden-console")).toBeVisible();
    await page.getByTestId("filter-device").click();
    await page.getByTestId("console-refresh").click();
    await expect(page.locator('[data-testid="log-entry"][data-source="device"]').first()).toContainText("idle cat=Mochi");

    // Forget (two taps) → the device's token dies.
    await page.keyboard.press("Escape");
    await openSettings(page);
    await page.getByTestId("device-forget").click();
    await page.getByTestId("device-forget").click();
    await expect(page.getByTestId("device-row")).toHaveCount(0);
    await expect(sim.fetchState()).rejects.toMatchObject({ status: 401 });

    // The house keeps the feeding, and the server copy says it came from the device.
    const res = await page.request.get("/api/feedings", { headers: { authorization: `Bearer ${tokens.accessToken}` } });
    const body = (await res.json()) as { items: Array<{ source: string; deviceId: string | null }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ source: "device", deviceId: sim.deviceId });
  });
});
