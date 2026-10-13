# Phase 5b execution handoff — 2026-10-13

Branch `feat/phase5b-help-tours`, from `main` after the Phase 5a merge (`3eb62df`), so the branch's own commits are exactly `origin/main..HEAD`. It holds the plan commit `0c97dd6`, five task commits from `da28571` to `52fea9b`, two review fix commits (`10cd5e1`, `770046a`) and this docs commit. Not pushed; no PR yet. Plan: `docs/superpowers/plans/2026-10-13-phase5b-help-tours.md` (Tasks 0–4 and Task 5's docs step ticked; verification and the PR are the dispatcher's). Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md` §4 ("driver.js tours for help"), §7 row 5. Live state: `handoff.md`. Authoring guide: `docs/help/README.md`.

## Before this phase: Phase 5a merged and deployed

PR a-tsygankov/feedme2#5 (QR login) merged on 2026-10-12/13 and deployed. Production now serves worker 0.1.50 and webapp 0.1.61, and the merge's deploy applied migration `0003_login_qr_tokens.sql` remotely. The production e2e run gave 12 passed and 9 skipped; the signed-in specs skip because production has no test-login. The device's Login QR screen still waits for the firmware pause; `device-sim login-qr` stands in.

## What was built

| Task | What | Commits |
|---|---|---|
| 0 | `driver.js` pinned exactly to `1.8.0`, the version gigsy locks, and the only new dependency. The help surface tokens (`--surface-help` sky-100, `--border-help` sky-200, re-pointed in dark) were already there from the scaffold's gigsy token layer, so this added only the test that pins them | `da28571` |
| 1 | The help model in `webapp/src/help/`, ported from gigsy: `types.ts` (scenarios, steps, branches, conditions; feedme2's six categories), `targets.ts` (`element`/`painted`, `targetSelector`, `resolveTarget`), `routes.ts` (route matching for `navigate` steps), `validate.ts` (structural registry checks), `environment.ts` (the install-environment guess), `registry.ts` | `ef46e46` |
| 2 | The runtime in `webapp/src/help/runtime/`: `HelpProvider` (wraps the routes in `App.tsx`, navigates to `startRoute`, ends a tour that is walked out of, lazily imports the renderer), `TourRenderer.ts` (driver.js, popover class `feedme2-help-popover`, one branch expanded at a time), `HelpSheet`, `HelpMenu` (search and sections), `HelpUnavailableBanner`; `webapp/src/styles/help.css` (tokens only). The "?" button in `AppHeader`. Also `webapp/src/components/Input.tsx` and `Field.tsx` changed to render it (see below) | `0a61d5f` |
| 3 | Eight topics in `webapp/src/help/scenarios/` and the target map; three new test ids on Settings (`gram-step`, `oz-step`, `cat-limit`, the last in the fix batch) | `c8e0fe4`; `770046a` |
| 4 | Help in CI: the `help` Playwright project, `webapp/e2e/help/{help-fixtures,help-runner,scenarios.spec,reachability.spec}.ts`, the `help:test` and `help:validate` scripts, and the help step in `deploy.yml`'s `webapp-e2e-full` | `52fea9b`; `770046a` |
| fixes | Help sheet modality (backdrop, focus return) | `10cd5e1` |
| fixes | True copy, `add-a-cat` in a full house, a nightly-safe fixture time, review nits | `770046a` |
| 5 | This handoff, `handoff.md`, the README Help section, the CLAUDE.md rule, `docs/help/README.md`, and the plan ticks and corrections | this commit |

**`0a61d5f` has an empty commit body.** For the record: besides the runtime, it added `webapp/src/components/Input.tsx` (the bare text input, for the help search box, which names itself with `aria-label` rather than a visible label) and changed `webapp/src/components/Field.tsx` to render `Input`. The markup and classes are the same as before, so every existing field looks and behaves as it did, and the two cannot drift apart.

## How it works

1. **The door.** `AppHeader` renders a ringed "?" (`data-testid="help-link"`, `aria-expanded`, `aria-controls="help-sheet"`) on every signed-in screen: the dashboard, the cat page, Reports and Settings. It toggles the sheet.
2. **The sheet.** A bottom sheet (sky-100, tokenised for dark mode) with a search box and the topics grouped into six sections in `CATEGORY_LABELS` order. A full-screen backdrop at z-50 blocks the page behind it and closes help on a tap. Escape and Close close it too, and focus returns to "?".
3. **A tour.** Picking a topic closes the sheet. `HelpProvider` navigates to the topic's `startRoute`, then dynamically imports `TourRenderer.ts`, which imports driver.js and its css. That is a lazy chunk of about 26 kB plus the renderer and `help.css`, none of it on first paint. Each step's target is resolved when the step is entered (driver.js gets `targetSelector`'s string and re-queries it), and each branch is resolved when the tour reaches it.
4. **The rules every topic keeps.** Tours never type and never write. Steps are highlights, plus a click only where the person's tap is harmless: `open-reports` taps the Reports tab, and `add-a-cat` opens the cat editor, which writes nothing until Save. No step presses Feed, Save, Pair or Download, and no scenario knows a record id (`registry.test.ts` pins both). Branches read only positive states (`target-visible`): a screen still loading matches nothing, so it never reads as "no cats".
5. **Failure.** A target that never appears, a branch with no winner, or a renderer chunk that 404s after a deploy ends the tour with "This help step is currently unavailable" and Back to Help. Navigating somewhere the scenario did not declare stops the tour.

| Topic | Section | Starts on | Branches (CI takes the first listed) |
|---|---|---|---|
| `open-reports` | Getting started | `/` | none: one click on the Reports tab |
| `feed-a-cat` | Cats and feeding | `/` | `cats-showing` / `no-cats-yet`, then `can-feed-other` / `first-feeding` |
| `feed-all-cats` | Cats and feeding | `/` | `two-or-more` / `one-cat` / `no-cats-yet` |
| `add-a-cat` | Cats and feeding | `/settings` | `room-for-another` / `house-full` (checked first: a full house greys out Add a cat) |
| `change-units` | Settings | `/settings` | `grams` / `cans` / `ounces` |
| `pair-a-device` | Devices | `/settings` | none: three highlights |
| `read-reports` | Reports | `/reports` | `report-showing` / `one-day` / `report-offline`, then `two-cats` / `one-cat` |
| `install-app` | Install the app | — | described only: variants for iOS Safari, Android Chrome, desktop Chrome, desktop Edge and a fallback |

**CI.** The `help` Playwright project (Pixel 7, 90 s timeout, 15 s `expect`) runs `e2e/help/*.spec.ts`; the `chromium` project ignores that folder. `help-runner.ts` is gigsy's runner. It performs each scenario's steps itself and returns the branches taken, and `scenarios.spec.ts` asserts them against `expectedCiBranches`. `help-fixtures.ts` refuses any target but localhost, 127.0.0.1 or `[::1]`. It gives each scenario a fresh test house seeded through the API (grams, two cats, one 40 g feeding each, two minutes ago clamped to the start of today in UTC), waits for both cat cards, then opens `startRoute`. `reachability.spec.ts` covers the door and the real runtime: help opens from `/settings` and `/`, a topic starts a driver.js popover (computed `max-width` 320px, `driver-active-element` on the target, no horizontal overflow), and the sheet closes on the backdrop, Enter on "?" and Close, with focus returned. It also checks that the backdrop blocks the page. In `deploy.yml` the step runs after the main suite in `webapp-e2e-full`, which runs only on pull requests, against wrangler on :8787 and vite on :5192.

**Duplicated test ids.** Every cat card repeats `cat-card`, `cat-feed` and `cat-feed-more`. The tour spotlights the first match (`querySelector`), so the runner's `locatorFor` uses `.first()` instead of gigsy's strict mode. The first CI-fixture run, with two seeded cats, made `feed-a-cat` a strict-mode violation while the tour itself worked. This is documented in `help-runner.ts` and `docs/help/README.md`.

## How it was verified

- **TDD per task.** Tests were copied from gigsy first (red), then the modules were ported (green). `TourRenderer.driver.test.ts` drives the real driver.js in jsdom (about 16 s). `registry.test.ts` pins:
  - the eight ids, their order and their menu sections
  - every `startRoute` against `App.tsx`'s routes
  - no `input` or `select` step, and no record id
  - `add-a-cat` checks for a full house before the click
- **Reviews.** The runtime port was judged faithful to gigsy. Four must-fixes were found, all landed:
  1. **Help sheet modality.** With help open, a cat's Feed button above the sheet was still tappable. The FeedSheet (portalled at z-40, `#root` inert) opened under help, could not be used, and one Escape closed both. Fixed with a backdrop and focus return (`10cd5e1`).
  2. **A nightly-failing fixture time.** Feedings seeded "an hour ago" landed on yesterday between 00:00 and 01:00 UTC, which broke `reachability.spec.ts`'s "Today" check. Fixed with `seededFedAt` (`770046a`).
  3. **Two false help texts.** `feed-a-cat`'s Other… said whatever you log becomes the usual amount; it is the latest feeding's by `fed_at`. `add-a-cat`'s Name said each cat needs its own name, which nothing enforces (`770046a`).
  4. **`add-a-cat` in a full house.** At 8 cats the Add a cat button is disabled, and the click step waited forever. The topic now branches on `cat-limit` first (`770046a`).
- **Nits, all landed** (`770046a`):
  - the tour popover's Close stays legible in dark mode when focused (driver.css's `:focus` colour beat `help.css` at equal specificity)
  - the local-target guard moved into a `beforeEach`, so `test:e2e:ui` and `--list` no longer die without `E2E_BASE_URL`
  - a test name
- **Local e2e** (wrangler and vite, `E2E_REQUIRE_AUTH=1`, after the fix batch): `chromium` **21/21**, `help` **13/13**. The 13 are the registry check, seven executable topics, `install-app` described and four reachability tests.
- **Unit counts** (re-run for this docs commit: `pnpm -r test`, `python -m unittest discover -s scripts`): shared **114**, backend **235**, webapp **650** (474 before this phase), device-sim **22**, scripts **45**. All passed. The first `pnpm -r test` run lost one backend case (`device-logs.test.ts`) to a Windows `EBUSY` on miniflare's isolated D1 storage; `pnpm --filter ./backend test` straight after passed 235/235. That is a known local flake, not a Phase 5b change (this phase touches no backend code).

Not run in this phase: CI on the branch (not pushed), the production e2e, and Task 5's full `pnpm -r typecheck && … check_version_bump.py` command.

## Decisions taken beyond the plan

1. **Test ids added for help.** `gram-step` and `oz-step` were added so that every unit has a positive state, and `cat-limit` so that a full house does. Without them those states could be read only as absences.
2. **`.first()` in the runner**, as described above.
3. **A modal help sheet.** gigsy's sheet has no backdrop. feedme2's needs one because its house Sheets are portalled outside `#root` and make it inert, so a sheet opened under help could not be used.
4. **More branches than the plan.**
   - `read-reports` branches on `report-showing`, not the plan's `has-feedings`, because the drill table renders with or without feedings. It also has `one-day` and `report-offline`.
   - `feed-a-cat` has a `first-feeding` alternative, and `feed-all-cats` has `no-cats-yet`.
   - `add-a-cat` has `house-full`.
5. **No reset in the fixture.** gigsy's fixture resets state on one shared dev user. feedme2's test-login finds or creates a house by a unique name, so every scenario starts from a house nobody else touched.

## Known limitations (Phase 5b)

- **Escape during `add-a-cat`** closes both the tour and the cat editor: both listen for Escape.
- **The "help unavailable" banner sits inside `#root`.** It is inert while a house Sheet is open, and it covers the update bar while shown.
- **A pointer tap on "?" while help is open** lands on the backdrop (z-50 over the z-30 header), and the backdrop closes help. This is intended: the person sees the button close what it opened. Only the keyboard reaches the button itself.
- **What the help suite cannot see.** It proves only the branch CI takes, so the targets on other branches are untested prose: `cat-limit`, `empty-cats`, `can-size`, `oz-step`, `report-range`, `report-chart-feedings` and `report-offline`. Within that branch it proves only the first of repeated ids. It also does not prove that a step's tap leads anywhere (except `open-reports`, via `reachability.spec.ts`) or that the copy is true. See `docs/help/README.md` §6.

## Decisions pending for Andrey

None new in Phase 5b. The Phase 4 and 5a items in `handoff.md` stand.

## Process notes

- Several agents shared one checkout. They staged by pathspec only, under the commit lock (`mkdir .git/feedme2-commit.lock`), and never ran `git add -A`.
- The hook bumped only the webapp, the one tier this phase touches: 0.1.61 → **0.1.68**. Worker stays 0.1.50, schema `0003_login_qr_tokens`, firmware 0.1.36 (paused). Docs bump nothing.

## Next steps

1. Task 5 verification: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py`, and the local e2e (`chromium` and `help` projects).
2. Push and open **"Phase 5b: help tours"** against `main`. CI runs the full-stack e2e and then the help tours. There is no migration; merging deploys the webapp.
3. Andrey: review and merge. The remaining spec Phase 5 items are either blocked by the firmware pause (the device's Login QR screen, canary rollouts) or are his call (the new cat poses, release 1.0.0, HIL-3).
