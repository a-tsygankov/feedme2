# Phase 5a: QR Login (server + web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A paired device can sign a phone into its house: the device asks the Worker for a one-time, 60-second login token and shows it as a QR of `https://feedme2-webapp.pages.dev/qr?deviceId=…&token=…`; opening that URL signs the phone in. This phase builds the Worker, the shared contracts, the web landing and the device simulator side; the device screen waits for the firmware pause to end.

**Architecture:** One new table (`login_qr_tokens`, migration 0003) holds a SHA-256 of each token, never the token. `POST /api/auth/login-token-create` (device token) replaces any live token of that device; `POST /api/auth/login-qr` (public) consumes a token atomically with one conditional `UPDATE … RETURNING`, re-checks that the device is still paired to that house, and issues ordinary house tokens. The webapp's public `/qr` route exchanges the token, stores the session like a PIN login and drops the token from history. The device simulator gains `loginToken()` and a `login-qr` command, which the e2e uses as the device.

**Tech Stack:** Hono 4 + Drizzle on D1, zod, vitest (pool-workers), React 18 + react-router-dom 6, Playwright (Pixel 7), the `tools/device-sim` package.

**Spec:** `docs/superpowers/specs/2026-09-20-feedme2-design.md` — D1, §1.3 ("land signed-in from a device QR"), §3.1 (`login_qr_tokens`), §3.2 (sign-in inputs include a QR login token), §3.3 (`POST /api/auth/login-qr`, `POST /api/auth/login-token-create`), §3.4 (cron prunes QR tokens), §4.1 (`/qr`), §5.2 ("Login QR (60 s)"), §7 row 5.

**Out of scope:** the device's Login QR screen (firmware is paused — see `handoff.md`), canary rollouts, help tours (Phase 5b), the 1.0.0 release.

## Global Constraints

- Integers only in D1 (epoch-ms). Tokens are stored hashed (`hashToken`, SHA-256 hex, as `refresh_tokens.token_hash` and `pending_pairings.poll_secret_hash` are) — the spec's `token` column becomes `token_hash`.
- Migrations are hand-written, numbered, never edited once on main: this phase adds `backend/migrations/0003_login_qr_tokens.sql` (the schema tier's bump) and the Drizzle mirror plus the drift guard entry.
- Device routes take `houseId`/`deviceId` only from `requireDevice()`. `POST /api/auth/login-qr` is public: house and device come from the stored token row, never from the body beyond the lookup key.
- Errors: validation 400 `{error:"invalid_request", issues}`; a failed QR login is the uniform 401 `{error:"unauthorized"}` whatever the reason (unknown, expired, used, wrong device, device forgotten) so the endpoint is no oracle.
- Public request bodies are capped (`publicBodyLimit`, 1 KB → 413) as the pair routes are.
- Webapp: no `dark:` utilities; no new dependency; tests use react-dom/client + act() (no @testing-library).
- Versioning: `shared/` bumps webapp + worker; `backend/` bumps worker; `webapp/` bumps webapp; `tools/` is not a tier; a new migration is the schema tier. Stage bumped `package.json` files.
- Commits: lowercase conventional with scope, explicit pathspecs, the lock (`until mkdir .git/feedme2-commit.lock 2>/dev/null; do sleep 10; done` … `rmdir .git/feedme2-commit.lock`), trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- TDD; comments explain why.

## Review Focus

1. **A token used twice** (two phones scan the same QR, or a reload of `/qr`): exactly one sign-in succeeds; the other gets 401 and the page says the code was used. → Task 2 (concurrent consume test), Task 4.
2. **A device forgotten (or re-paired to another house) within the 60 s**: the token no longer signs anyone in. → Task 2.
3. **An expired token** (61 s): 401, and the page offers PIN sign-in. → Tasks 2, 4.
4. **Already signed in to another house** when scanning: the phone switches to the device's house and the cached data of the old house is cleared (the existing `crossesSessionBoundary` path). → Task 4 test, Task 5 e2e.
5. **The token in history/logs**: after the exchange the URL is replaced with `/` so Back and the history never show it, and the request logger never prints the token (it is in the body, not the query). → Tasks 3, 4.

## File Structure

```
backend/migrations/0003_login_qr_tokens.sql          Task 1
backend/src/db/schema.ts (loginQrTokens)              Task 1
backend/test/schema.test.ts (newest migration, drift)  Task 1
shared/src/device.ts (LoginQrBodySchema, LoginTokenCreateResponseSchema, LOGIN_QR_TTL_SEC)  Task 1
backend/src/repos/login-qr-tokens.ts                  Task 2
backend/src/routes/login-qr.ts                        Task 2 (both routes; mounted under /api/auth)
backend/src/index.ts, backend/src/cron.ts             Task 2
backend/test/login-qr.test.ts                         Task 2
tools/device-sim/src/{sim,cli}.ts + tests, README     Task 3
webapp/src/screens/QrLogin.tsx + test, App.tsx, lib/api-client.ts   Task 4
webapp/e2e/qr-login.spec.ts                           Task 5
handoff.md, README.md, CLAUDE.md, docs/handoffs/…-phase5a-execution-handoff.md   Task 6
```
Order: 1 → 2 → (3 ∥ 4) → 5 → 6.

---

## Task 1: Contracts and the table

**Files:**
- Create: `backend/migrations/0003_login_qr_tokens.sql`
- Modify: `backend/src/db/schema.ts`, `backend/test/schema.test.ts`, `shared/src/device.ts`, `shared/src/device.test.ts` (or the existing shared test that covers device schemas)

**Interfaces:**
- Produces:
  - `LOGIN_QR_TTL_SEC = 60` (shared).
  - `LoginQrTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/)` — 32 random bytes in base64url, as `mintRefreshToken()` makes.
  - `LoginQrBodySchema = z.object({ deviceId: DeviceIdSchema, token: LoginQrTokenSchema }).strict()`.
  - `LoginTokenCreateResponseSchema = z.object({ token: LoginQrTokenSchema, expiresInSec: z.number().int().positive() })`.
  - Drizzle `loginQrTokens` table: `tokenHash` (text PK), `deviceId`, `houseId`, `createdAt`, `expiresAt`, `consumedAt` (nullable).

- [ ] **Step 1: Failing tests.** In the shared device test: `LoginQrBodySchema` accepts `{deviceId: "a".repeat(32), token: <43 base64url chars>}`, rejects a 42-char token, a token with `+` or `/`, an uppercase device id and an extra key. In `backend/test/schema.test.ts`: the newest migration is `0003_login_qr_tokens.sql`; add `["login_qr_tokens", loginQrTokens]` to the drift-guard list (see how `devices`/`pending_pairings` are listed).
- [ ] **Step 2: Run** `pnpm --filter @feedme2/shared test` and `pnpm --filter ./backend test -- schema` → FAIL.
- [ ] **Step 3: Implement.** Migration:
```sql
-- QR login (spec §3.1, §3.3): a paired device mints a one-time, 60-second token a phone exchanges for house tokens.
-- Only the SHA-256 of the token is stored, like refresh_tokens and pending_pairings.poll_secret_hash.
CREATE TABLE login_qr_tokens (
  token_hash  TEXT PRIMARY KEY CHECK (length(token_hash) = 64),
  device_id   TEXT NOT NULL CHECK (length(device_id) = 32),
  house_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL CHECK (expires_at > created_at),
  consumed_at INTEGER
);
-- One live token per device: a new create deletes the device's older rows first (see the repo).
CREATE INDEX login_qr_tokens_device ON login_qr_tokens (device_id);
CREATE INDEX login_qr_tokens_expires ON login_qr_tokens (expires_at);
```
Drizzle mirror in `schema.ts` in the same style as `pendingPairings`. Shared schemas as above, exported from `shared/src/device.ts` (already re-exported by `index.ts`).
- [ ] **Step 4: Run** both suites → green; `pnpm -r typecheck`.
- [ ] **Step 5: Commit** `feat(backend): login_qr_tokens table and the qr login contracts` (stage the migration, schema.ts, schema.test.ts, shared device files, both package.json).

---

## Task 2: The Worker routes

**Files:**
- Create: `backend/src/repos/login-qr-tokens.ts`, `backend/src/routes/login-qr.ts`, `backend/test/login-qr.test.ts`
- Modify: `backend/src/index.ts` (mount the router at `/api/auth` **before** `authRouter`, or as a sub-router — check Hono matching so `/api/auth/login-qr` and `/api/auth/login-token-create` reach it), `backend/src/cron.ts` (prune)

**Interfaces:**
- Consumes: `mintRefreshToken()`, `hashToken()`, `clock` (`backend/src/auth/tokens.ts`); `issueTokens` from `backend/src/routes/auth.ts` (export it — it is module-private today); `requireDevice()` (`backend/src/middleware/device.ts`); `publicBodyLimit` (as `routes/pair.ts` uses it); `validationHook`; `DevicesRepo`, `HousesRepo`; Task 1 schemas.
- Produces:
  - `class LoginQrTokensRepo { create(deviceId, houseId, nowMs): Promise<string> /* plaintext token */; consume(deviceId, token, nowMs): Promise<{ houseId: string } | null>; pruneExpired(nowMs): Promise<number> }`.
    - `create` deletes the device's existing rows, then inserts a new one with `expires_at = now + LOGIN_QR_TTL_SEC*1000` (one D1 batch).
    - `consume` is one statement: `UPDATE login_qr_tokens SET consumed_at = ? WHERE token_hash = ? AND device_id = ? AND consumed_at IS NULL AND expires_at > ? RETURNING house_id` — the atomic claim (copy the pattern in `RefreshTokensRepo.consume`).
    - `pruneExpired` deletes rows whose `expires_at` is older than `now - 1 h` (keeps used rows an hour for debugging), chunked like `PairingsRepo.pruneExpired`.
  - `POST /api/auth/login-token-create` — `requireDevice()`; body empty; → 200 `{ token, expiresInSec: 60 }`; logs `info "qr login token created"` with the device id (never the token).
  - `POST /api/auth/login-qr` — public, `publicBodyLimit`, body `LoginQrBodySchema` → `consume`; null → 401 `UNAUTHORIZED`; then the device row must exist, not be revoked, and belong to the token's house (`DevicesRepo.getAny(deviceId)`), else 401; then `issueTokens(env, house, now)` → 200 `TokensResponse`; logs `info "qr login"` with house and device ids.

- [ ] **Step 1: Failing tests** `backend/test/login-qr.test.ts` (use `pairDevice()` from `test/helpers/device.ts` and `vi.spyOn(clock, "now")` for time):
```ts
import { LoginTokenCreateResponseSchema, TokensResponseSchema } from "@feedme2/shared";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { clock } from "../src/auth/tokens.ts";
import { applyAllMigrations } from "./helpers/migrate.ts";
import { json, signup } from "./helpers/api.ts";
import { pairDevice } from "./helpers/device.ts";

const publicPost = (path: string, body: unknown) => SELF.fetch(new Request(`http://feedme2${path}`, { ...json(body), headers: { "content-type": "application/json" } }));
// (SELF from "cloudflare:test"; match how test/helpers/api.ts builds requests.)

describe("QR login", () => {
  beforeAll(applyAllMigrations);
  afterEach(() => vi.restoreAllMocks());

  async function deviceWithToken() {
    const d = await pairDevice();
    const res = await d.fetchDevice("/api/auth/login-token-create", { method: "POST" });
    expect(res.status).toBe(200);
    return { d, ...LoginTokenCreateResponseSchema.parse(await res.json()) };
  }

  it("signs a phone into the device's house once", async () => {
    const { d, token, expiresInSec } = await deviceWithToken();
    expect(expiresInSec).toBe(60);
    const first = await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token });
    expect(first.status).toBe(200);
    expect(TokensResponseSchema.parse(await first.json()).house.id).toBe(d.house.houseId);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("lets exactly one of two simultaneous scans win", async () => {
    const { d, token } = await deviceWithToken();
    const [a, b] = await Promise.all([1, 2].map(() => publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })));
    expect([a!.status, b!.status].sort()).toEqual([200, 401]);
  });

  it("expires after 60 s", async () => {
    const t0 = Date.now();
    vi.spyOn(clock, "now").mockReturnValue(t0);
    const { d, token } = await deviceWithToken();
    vi.spyOn(clock, "now").mockReturnValue(t0 + 60_001);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("is dead once the device is forgotten", async () => {
    const { d, token } = await deviceWithToken();
    await d.house.fetchAuthed(`/api/devices/${d.deviceId}`, { method: "DELETE" });
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
  });

  it("is bound to its device id and replaced by a newer token", async () => {
    const { d, token } = await deviceWithToken();
    const other = await pairDevice();
    expect((await publicPost("/api/auth/login-qr", { deviceId: other.deviceId, token })).status).toBe(401);
    const newer = LoginTokenCreateResponseSchema.parse(await (await d.fetchDevice("/api/auth/login-token-create", { method: "POST" })).json());
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token })).status).toBe(401);
    expect((await publicPost("/api/auth/login-qr", { deviceId: d.deviceId, token: newer.token })).status).toBe(200);
  });

  it("needs a device token to create, and rejects bad bodies uniformly", async () => {
    const house = await signup();
    expect((await house.fetchAuthed("/api/auth/login-token-create", { method: "POST" })).status).toBe(401);
    expect((await publicPost("/api/auth/login-qr", { deviceId: "x", token: "y" })).status).toBe(400);
    expect((await publicPost("/api/auth/login-qr", { deviceId: "a".repeat(32), token: "A".repeat(43) })).status).toBe(401);
  });

  it("prunes old tokens in the hourly housekeeping", async () => { /* create, advance clock 2 h, runHousekeeping(env, now), count rows = 0 via env.DB */ });
});
```
Fill the prune test with the pattern in `backend/test/logs.test.ts` (runHousekeeping) and count rows with `env.DB.prepare("SELECT count(*) AS n FROM login_qr_tokens").first()`.
- [ ] **Step 2: Run** → FAIL (404s).
- [ ] **Step 3: Implement** per the interfaces. Mount: a small `loginQrRouter` (its own Hono with the device route using `requireDevice()` per route and the public route with `publicBodyLimit`) mounted with `app.route("/api/auth", loginQrRouter)` next to the auth router; confirm both orders route correctly with the tests. Export `issueTokens` from `routes/auth.ts` (move it to `backend/src/auth/issue.ts` if exporting from a route file reads badly).
- [ ] **Step 4: Run** `pnpm --filter ./backend test && pnpm -r typecheck` → green.
- [ ] **Step 5: Commit** `feat(backend): one-time qr login tokens minted by a paired device and exchanged for house tokens`.

---

## Task 3: The device simulator speaks QR login

**Files:** Modify `tools/device-sim/src/sim.ts`, `tools/device-sim/src/cli.ts`, their tests, `tools/device-sim/README.md`.

**Interfaces:**
- Produces: `DeviceSim.loginToken(): Promise<{ token: string; expiresInSec: number }>` (via the private `call`, parsed with `LoginTokenCreateResponseSchema`); `DeviceSim.loginUrl(webBase: string, token: string): string` → `${webBase}/qr?deviceId=${deviceId}&token=${token}` (both URL-encoded); CLI `login-qr [--web <base>]` prints the URL and the seconds left (default web base `https://feedme2-webapp.pages.dev`), exits 1 when unpaired.
- [ ] **Step 1: Failing tests** in the sim's test file (follow its existing fetch-mock pattern): `loginToken()` posts to `/api/auth/login-token-create` with the bearer device token and parses the body; `loginUrl` encodes; the CLI prints the URL for a paired snapshot and exits 1 unpaired.
- [ ] **Step 2–4:** Run red, implement, run `pnpm --filter @feedme2/device-sim test` and `pnpm -r typecheck` green.
- [ ] **Step 5: Commit** `feat(device-sim): qr login token and url` (tools is not a tier: no version bump).

---

## Task 4: The `/qr` landing

**Files:** Create `webapp/src/screens/QrLogin.tsx`, `webapp/src/screens/QrLogin.test.tsx`; modify `webapp/src/App.tsx` (route `/qr` at the top level, outside `AuthGate`, like `/login`), `webapp/src/lib/api-client.ts` (`api.loginQr`).

**Interfaces:**
- Consumes: `publicPost` in `api-client.ts`, `TokensResponseSchema`, `LoginQrBodySchema`, `authStore.applyTokens`, `ApiError`, `NetworkError`.
- Produces: `api.loginQr(deviceId: string, token: string): Promise<TokensResponse>`; `QrLogin` screen:
  - reads `deviceId` and `token` once from the URL; invalid shape (fails `LoginQrBodySchema`) → "This sign-in code isn't valid." + a link to `/login` (no request);
  - otherwise posts once (guard against React StrictMode double effects with a ref), then `authStore.applyTokens(tokens)` and `navigate("/", { replace: true })` — the replace keeps the token out of history (Review Focus 5);
  - 401 → "This sign-in code has expired or was already used. Show a new one on the device, or sign in with your PIN." + link to `/login`; network error → "No connection. Try again when you're online." with a Retry button (same token, if still within the minute);
  - `data-testid`s: `qr-login`, `qr-login-error`, `qr-login-retry`.
- [ ] **Step 1: Failing tests** `QrLogin.test.tsx` (MemoryRouter with initialEntries `/qr?deviceId=…&token=…`, a probe route at `/` printing the location, `vi.mock("../lib/api-client.ts")`): success applies tokens and lands on `/` with `replace` (history length unchanged; no token in location); 401 shows the expired message and no navigation; a malformed token never calls the API; StrictMode renders call `api.loginQr` once; signed in to another house → `applyTokens` is called with the new house (the store's boundary handling is existing code; assert the call).
- [ ] **Step 2–4:** Run red, implement, `pnpm --filter ./webapp test && pnpm --filter ./webapp typecheck && pnpm --filter ./webapp build` green.
- [ ] **Step 5: Commit** `feat(webapp): qr sign-in landing that exchanges a device code and leaves no token in history`.

---

## Task 5: e2e — a device signs a phone in

**Files:** Create `webapp/e2e/qr-login.spec.ts`.

- [ ] **Step 1: The spec** (copy the pairing part of `webapp/e2e/device-flow.spec.ts`):
```ts
import { expect, test } from "@playwright/test";
import { DeviceSim } from "@feedme2/device-sim";
import { requireTestAuth, signInAsTestHouse, uniqueHouseName } from "./helpers/test-auth.ts";
import { addCat, openSettings } from "./helpers/ui.ts";

test("a paired device signs a second phone into its house, once", async ({ page, browser, baseURL }) => {
  await page.goto("/login");
  await requireTestAuth(page);
  const house = uniqueHouseName("qr");
  await signInAsTestHouse(page, house);
  await addCat(page, "Mochi");
  const sim = new DeviceSim({ apiBase: baseURL!, fwVersion: "0.2.0" });
  const { pairCode } = await sim.pairStart();
  await openSettings(page);
  await page.getByTestId("pair-code").fill(pairCode);
  await page.getByTestId("pair-name").fill("Kitchen");
  await page.getByTestId("pair-submit").click();
  await sim.pairUntilConfirmed({ timeoutMs: 15_000, intervalMs: 500 });

  const { token } = await sim.loginToken();
  const url = sim.loginUrl("", token);

  // A second phone with no session.
  const phone = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await phone.goto(url);
  await expect(phone.getByTestId("dashboard")).toBeVisible();
  await expect(phone.getByTestId("cat-card").filter({ hasText: "Mochi" })).toBeVisible();
  expect(new URL(phone.url()).search).toBe(""); // the token left the address bar

  // The same code a second time: refused.
  const third = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await third.goto(url);
  await expect(third.getByTestId("qr-login-error")).toContainText("expired or was already used");
});
```
- [ ] **Step 2: Run** against the local stack exactly as CI's `webapp-e2e-full` job does (wrangler dev on 8787, vite on 5192, `E2E_BASE_URL=http://127.0.0.1:5192 E2E_REQUIRE_AUTH=1`), then the whole suite; stop every process you started and confirm ports 8787/5192 are free.
- [ ] **Step 3: Commit** `test(webapp): a device signs a second phone in by qr, once`.

---

## Task 6: Docs, verification, PR

- [ ] Docs: `handoff.md` (routes table rows for the two endpoints, `/qr`, migration 0003, versions, log), `README.md` (QR login, the sim's `login-qr` command), `CLAUDE.md` (QR tokens are stored hashed and consumed atomically; `/qr` is public), `tools/device-sim/README.md`, `docs/handoffs/2026-10-13-phase5a-execution-handoff.md`, and the spec correction note (the `login_qr_tokens.token` column is `token_hash`).
- [ ] Verification: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py`, plus the local full-stack e2e.
- [ ] Push `feat/phase5a-qr-login` and open "Phase 5a: QR login" against main; merging applies migration 0003 in production.

## Self-review against the spec

- D1/§1.3/§3.2: QR sign-in lands the phone signed in (Tasks 2, 4, 5). §3.1 table (Task 1, hashed column). §3.3 both routes (Task 2). §3.4 prune (Task 2). §4.1 `/qr` (Task 4). §5.2 60 s (Task 1 TTL; the device screen is out of scope while firmware is paused, the sim stands in).
- Review Focus 1–5 → Tasks 2 (double use, forgotten device, expiry), 4 (messages, history), 5 (end to end).
- Types: `LoginQrBodySchema`, `LoginTokenCreateResponseSchema`, `LOGIN_QR_TTL_SEC` (Task 1) are what Tasks 2–4 use; `LoginQrTokensRepo` (Task 2) only the routes use; `DeviceSim.loginToken/loginUrl` (Task 3) is what Task 5 drives.
