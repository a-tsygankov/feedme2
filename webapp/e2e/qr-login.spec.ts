import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { DeviceSim } from "@feedme2/device-sim";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";
import { addCat, expectNoHorizontalOverflow, openSettings } from "./helpers/ui.ts";

/**
 * Phase 5a exit test (Review Focus 1 and 5): a paired simulated device mints a one-time login token, a second
 * phone with no session opens the QR's URL and lands on the house's dashboard with the token gone from the address
 * bar, and the same code opened again on a third phone is refused. Runs against the local stack, like device-flow.
 */
test("a paired device signs a second phone into its house, once", async ({ page, browser, baseURL }) => {
  await page.goto("/login");
  await requireTestAuth(page);
  await signInAsTestHouse(page, uniqueHouseName("qr"));
  await addCat(page, "Mochi");

  const sim = new DeviceSim({ apiBase: baseURL!, fwVersion: "0.2.0" });
  const { pairCode } = await sim.pairStart();
  await openSettings(page);
  await page.getByTestId("pair-code").fill(pairCode);
  await page.getByTestId("pair-name").fill("Kitchen");
  await page.getByTestId("pair-submit").click();
  await expect(page.getByTestId("pair-success")).toContainText("Kitchen");
  await sim.pairUntilConfirmed({ timeoutMs: 20_000, intervalMs: 250 });

  const { token } = await sim.loginToken();
  // "" = a path on the page's own origin; the new contexts carry the project's baseURL.
  const url = sim.loginUrl("", token);

  const contexts: BrowserContext[] = [];
  try {
    // A second phone with no session.
    const phone = await newPhone(browser, baseURL!, contexts);
    await phone.goto(url);
    await expect(phone.getByTestId("dashboard")).toBeVisible();
    await expect(phone.getByTestId("cat-card").filter({ hasText: "Mochi" })).toBeVisible();
    // The one-time token left the address bar (QrLogin replaces the entry with "/").
    expect(new URL(phone.url()).search).toBe("");

    // The same code a second time, on a third phone: refused, with the way back to PIN sign-in.
    const third = await newPhone(browser, baseURL!, contexts);
    await third.goto(url);
    await expect(third.getByTestId("qr-login-error")).toContainText("expired or was already used");
    await expect(third.getByTestId("qr-login-to-login")).toBeVisible();
    await expectNoHorizontalOverflow(third);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

/** A fresh context with the project's device profile (Pixel 7), so every phone in the test is the same handset. */
async function newPhone(browser: Browser, baseURL: string, contexts: BrowserContext[]) {
  const ctx = await browser.newContext({ ...test.info().project.use, baseURL });
  contexts.push(ctx);
  return ctx.newPage();
}
