// @vitest-environment jsdom
// No testing-library in this repo: mount with react-dom/client inside act(), as Reports.test.tsx does.
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TokensResponse } from "@feedme2/shared";

vi.mock("../lib/api-client.ts", async (orig) => {
  const real = await orig<typeof import("../lib/api-client.ts")>();
  return { ...real, api: { ...real.api, loginQr: vi.fn() } };
});
// The logo's triple-tap needs the console provider, which is not what this screen is about.
vi.mock("../components/ConsoleProvider.tsx", () => ({ useConsole: () => ({ tapLogo: () => {} }) }));

import { QrLogin } from "./QrLogin.tsx";
import { ApiError, NetworkError, api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DEVICE_ID = "0123456789abcdef0123456789abcdef";
const TOKEN = "A".repeat(40) + "b-_";
// The fragment form: a fragment never reaches a server log or a Referer header.
const qrUrl = (deviceId = DEVICE_ID, token = TOKEN) => `/qr#deviceId=${deviceId}&token=${token}`;
const tokensFor = (houseId: string, name: string): TokensResponse => ({
  accessToken: `access-${name}`,
  expiresIn: 900,
  refreshToken: `refresh-${name}`,
  house: { id: houseId, name, createdAt: 1, modifiedAt: 1, settings: { timezone: "Europe/Berlin", foodUnit: "g", canSizeMg: 155_922 } } as TokensResponse["house"],
});
const NEW_HOUSE = tokensFor("00000000-0000-4000-8000-000000000002", "Cottage");
const OLD_HOUSE = tokensFor("00000000-0000-4000-8000-000000000001", "Home");
const loginQrMock = vi.mocked(api.loginQr);

let host: HTMLDivElement;
let root: Root;
function HomeProbe() {
  const l = useLocation();
  const type = useNavigationType();
  return <p data-testid="home">{`${l.pathname}${l.search}${l.hash}|${type}`}</p>;
}
/** Where the router is while QrLogin is still on screen (a failure or the confirm step). */
function QrProbe() {
  const l = useLocation();
  const type = useNavigationType();
  return <p data-testid="qr-location">{`${l.pathname}${l.search}${l.hash}|${type}`}</p>;
}

beforeEach(() => {
  vi.clearAllMocks();
  authStore.signOut();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  authStore.signOut();
  vi.restoreAllMocks();
});

async function renderAt(url: string, strict = false) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/qr" element={<><QrLogin /><QrProbe /></>} />
        <Route path="/" element={<HomeProbe />} />
        <Route path="/login" element={<p data-testid="login-page">login</p>} />
      </Routes>
    </MemoryRouter>
  );
  await act(async () => { root.render(strict ? <StrictMode>{tree}</StrictMode> : tree); });
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });
const byTestId = (id: string) => host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (id: string) => act(async () => { byTestId(id)!.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

describe("QrLogin", () => {
  it("exchanges the code, applies the tokens and replaces /qr with / so the token is in no history entry", async () => {
    loginQrMock.mockResolvedValue(NEW_HOUSE);
    const apply = vi.spyOn(authStore, "applyTokens");
    await renderAt(qrUrl());
    await flush();
    expect(api.loginQr).toHaveBeenCalledWith(DEVICE_ID, TOKEN);
    expect(apply).toHaveBeenCalledWith(NEW_HOUSE);
    expect(authStore.getSnapshot()).toEqual({ status: "signedIn", house: NEW_HOUSE.house });
    // REPLACE, not PUSH: Back can never return to the URL that carried the token.
    expect(byTestId("home")?.textContent).toBe("/|REPLACE");
    expect(host.innerHTML).not.toContain(TOKEN);
  });

  it("a refused code (401) says it expired or was used, offers PIN sign-in and does not navigate", async () => {
    loginQrMock.mockRejectedValue(new ApiError(401, { error: "unauthorized" }));
    await renderAt(qrUrl());
    await flush();
    const err = byTestId("qr-login-error");
    expect(err?.textContent).toBe("This sign-in code has expired or was already used. Show a new one on the device, or sign in with your PIN.");
    expect(byTestId("qr-login")?.querySelector('a[href="/login"]')).not.toBeNull();
    expect(byTestId("qr-login-retry")).toBeNull();
    expect(byTestId("home")).toBeNull();
    expect(authStore.getSnapshot().status).toBe("signedOut");
    // The token left the address bar before the exchange, so a failure leaves nothing live in the URL or history.
    expect(byTestId("qr-location")?.textContent).toBe("/qr|REPLACE");
  });

  it("still accepts the older query form, and scrubs it the same way", async () => {
    loginQrMock.mockRejectedValue(new ApiError(401, { error: "unauthorized" }));
    await renderAt(`/qr?deviceId=${DEVICE_ID}&token=${TOKEN}`);
    await flush();
    expect(api.loginQr).toHaveBeenCalledWith(DEVICE_ID, TOKEN);
    expect(byTestId("qr-location")?.textContent).toBe("/qr|REPLACE");
  });

  it.each([
    ["a short token", qrUrl(DEVICE_ID, "abc")],
    ["an uppercase device id", qrUrl(DEVICE_ID.toUpperCase())],
    ["no token", `/qr#deviceId=${DEVICE_ID}`],
    ["no parameters", "/qr"],
  ])("%s is rejected without calling the API", async (_name, url) => {
    await renderAt(url);
    await flush();
    expect(api.loginQr).not.toHaveBeenCalled();
    expect(byTestId("qr-login-error")?.textContent).toBe("This sign-in code isn't valid.");
    expect(byTestId("qr-login")?.querySelector('a[href="/login"]')).not.toBeNull();
    expect(byTestId("qr-location")?.textContent).toMatch(/^\/qr\|/);
  });

  it("calls the API once under StrictMode's double effects (a second call would find the token used)", async () => {
    loginQrMock.mockResolvedValue(NEW_HOUSE);
    await renderAt(qrUrl(), true);
    await flush();
    expect(api.loginQr).toHaveBeenCalledTimes(1);
    expect(byTestId("home")?.textContent).toBe("/|REPLACE");
  });

  it("a network failure offers Retry, which re-sends the same code", async () => {
    loginQrMock.mockRejectedValueOnce(new NetworkError()).mockResolvedValueOnce(NEW_HOUSE);
    await renderAt(qrUrl());
    await flush();
    expect(byTestId("qr-login-error")?.textContent).toBe("No connection. Try again when you're online.");
    // Offline, the screen waits for Retry with the code in state only: not in the address bar, not in history.
    expect(byTestId("qr-location")?.textContent).toBe("/qr|REPLACE");
    expect(host.innerHTML).not.toContain(TOKEN);
    await click("qr-login-retry");
    await flush();
    expect(loginQrMock).toHaveBeenNthCalledWith(2, DEVICE_ID, TOKEN);
    expect(byTestId("home")?.textContent).toBe("/|REPLACE");
  });

  // Security review (Phase 5a): a QR link from someone else must not silently move a signed-in phone to their house.
  it("signed in to another house: asks first, and Switch signs into the device's house", async () => {
    authStore.applyTokens(OLD_HOUSE);
    loginQrMock.mockResolvedValue(NEW_HOUSE);
    await renderAt(qrUrl());
    await flush();
    expect(api.loginQr).not.toHaveBeenCalled();
    expect(byTestId("qr-login-confirm-text")?.textContent).toBe("You're signed in to Home. Sign in to the device's house instead?");
    expect(byTestId("qr-location")?.textContent).toBe("/qr|REPLACE");
    expect(host.innerHTML).not.toContain(TOKEN);
    const apply = vi.spyOn(authStore, "applyTokens");
    await click("qr-login-confirm");
    await flush();
    expect(api.loginQr).toHaveBeenCalledWith(DEVICE_ID, TOKEN);
    // applyTokens replaces the session; main.tsx's crossesSessionBoundary clears the old house's cached data.
    expect(apply).toHaveBeenCalledWith(NEW_HOUSE);
    expect(authStore.getSnapshot()).toEqual({ status: "signedIn", house: NEW_HOUSE.house });
    expect(byTestId("home")?.textContent).toBe("/|REPLACE");
  });

  it("signed in to another house: Stay goes home without spending the code", async () => {
    authStore.applyTokens(OLD_HOUSE);
    await renderAt(qrUrl());
    await flush();
    await click("qr-login-cancel");
    await flush();
    expect(api.loginQr).not.toHaveBeenCalled();
    expect(authStore.getSnapshot()).toEqual({ status: "signedIn", house: OLD_HOUSE.house });
    expect(byTestId("home")?.textContent).toBe("/|REPLACE");
  });
});
