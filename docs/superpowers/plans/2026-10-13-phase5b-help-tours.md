# Phase 5b: Help Tours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "?" in the header opens a help sheet of topics; picking one runs a guided tour over the real screen (driver.js), and every executable tour is also run end to end in CI so a tour can never silently point at nothing.

**Architecture:** A port of gigsy's executable help (`C:\Workspaces\gigsy\webapp\src\help\`, design in `C:\Workspaces\gigsy\docs\gigsy-executable-help-implementation-spec.md` and `docs\help\README.md`): plain-data scenarios over named targets (existing `data-testid`s), a provider that navigates and lazily loads the driver.js renderer, a help sheet with search, and a second "adapter" in Playwright that performs each scenario's steps itself. The runtime is copied nearly verbatim with renames; the scenarios and targets are feedme2's own.

**Tech Stack:** React 18, react-router-dom 6, Tailwind 3 tokens, **driver.js 1.8.0** (the spec's "driver.js tours for help", same version gigsy locks), vitest + jsdom, Playwright (a `help` project on Pixel 7).

**Spec:** `docs/superpowers/specs/2026-09-20-feedme2-design.md` — §4 stack ("driver.js tours for help"), §7 row 5 ("help tours"). Firmware stays paused; no device topics beyond pairing in the web app.

## Global Constraints

- Stack must match gigsy (memory: feedme2-stack-preferences): copy gigsy's help runtime and tests; rename `gigsy` → `feedme2` in the popover class (`feedme2-help-popover`) and the step Symbol (`"feedme2.helpStep"`).
- One new dependency: `driver.js` pinned to `1.8.0` in `webapp/package.json` (exact, no caret — `.npmrc` `min-release-age=7` is satisfied; lockfile updated by `pnpm install`).
- No `dark:` utilities: the popover is themed by tokens in `webapp/src/styles/help.css`; add `--surface-help` (sky-100) and `--border-help` (sky-200) to `webapp/src/styles/tokens/semantic.css` for both themes (light values first, dark under `[data-theme="dark"]`), plus any missing sky steps in `colors.css`, `tailwind.config.ts` and the design-token drift test, as gigsy did.
- Tours never write data on their own: steps are `highlight`, `click` (the person taps), `navigate` or `external`; no step types into a field. A tour that would need a record id is redesigned (gigsy lesson: no scenario knows a record id).
- Branch on what a screen positively shows (gigsy lesson: `target-missing` read a loading screen as "empty").
- Help e2e runs only against the hermetic local stack (`requireLocalTarget()`), never against production or a preview (gigsy lesson: a preview job went green while skipping most tests).
- Webapp tests: react-dom/client + act() (no @testing-library), `/** @vitest-environment jsdom */` where gigsy's files have it.
- Commits: lowercase conventional with scope, explicit pathspecs, the commit lock, trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Hook bumps webapp for `webapp/` changes.

## Review Focus

1. **A target that never appears** (cats still loading, offline, a screen renamed a testid): the tour ends with the "currently unavailable" banner and Back to Help, never a popover pointing at nothing. → Task 2 (renderer tests), Task 4 (registry validation + CI run of every scenario).
2. **Navigating away mid-tour** (tab bar tap): the tour stops unless the new route is one the scenario declared. → Task 2 (provider tests).
3. **A one-cat house** (feedme2's "never show a selector with one option" rule hides the Reports cat filter and Feed all): scenarios branch on what is shown. → Task 3 (scenario branches), Task 4 (CI branches pinned with `expectedCiBranches`).
4. **Dark mode and a 412 px phone**: popover legible, inside the viewport, page not wider than the screen. → Task 2 (help.css), Task 4 (`expectNoHorizontalOverflow` during a tour).
5. **A deploy while the sheet is open** (the lazy renderer chunk 404s): "This help step is currently unavailable", no crash. → Task 2 (provider test, copied from gigsy).

---

## Task 0: driver.js and the tokens

**Files:** `webapp/package.json`, `pnpm-lock.yaml`, `webapp/src/styles/tokens/{colors,semantic}.css`, `webapp/tailwind.config.ts` (only if a new step is needed), the design-token test (`webapp/src/lib/design-tokens.test.ts` if present, else the theme test that pins tokens).

- [ ] Add `"driver.js": "1.8.0"` to webapp dependencies; `pnpm install`; confirm `pnpm-lock.yaml` resolves 1.8.0 and nothing else changed.
- [ ] Add `--surface-help` / `--border-help` for both themes (copy gigsy `webapp/src/styles/tokens/semantic.css` help lines and their dark counterparts) and a failing-then-passing token test asserting both are defined in light and dark.
- [ ] Commit `build(webapp): driver.js 1.8.0 and help surface tokens`.

## Task 1: The help model (pure)

**Files:** create `webapp/src/help/{types,targets,routes,validate,environment,registry}.ts` and their tests, copied from `C:\Workspaces\gigsy\webapp\src\help\` with these changes:
- `types.ts`: `HelpCategory = "getting-started" | "cats" | "reports" | "devices" | "settings" | "installation"`; keep `HelpEnvironment`.
- `targets.ts`: keep `element()`, `painted()`/switch factories, `targetSelector`, `resolveTarget`; the `HelpTarget` map is empty for now (Task 3 fills it).
- `registry.ts`: `helpScenarios: HelpScenario[] = []` for now.
- Tests: copy `routes.test.ts`, `targets.test.ts` (generic parts), `validate.test.ts`, `environment.test.ts`; drop gigsy-specific id assertions.

- [ ] Copy tests first, run (red: modules missing), copy/adapt modules, run green, `pnpm --filter ./webapp typecheck`.
- [ ] Commit `feat(webapp): help model — scenarios, targets, routes and validation (ported from gigsy)`.

## Task 2: The help runtime

**Files:** create `webapp/src/help/runtime/{TourRenderer.ts,HelpProvider.tsx,HelpSheet.tsx,HelpUnavailableBanner.tsx,HelpMenu.tsx}` and their tests (`TourRenderer.test.ts`, `TourRenderer.driver.test.ts` with the real driver.js, `HelpProvider.test.tsx`, `HelpSheet.test.tsx`, `HelpMenu.test.ts`), `webapp/src/styles/help.css` (imported where gigsy imports it, from the main stylesheet), copied from gigsy with: the popover class and Symbol renamed; `HelpSheet` without `FeedbackForm`; `CATEGORY_LABELS` for feedme2's categories (`Getting started`, `Cats and feeding`, `Reports`, `Devices`, `Settings`, `Install the app`); imports pointed at feedme2's `Button`/`Input`/`Select` and `appLog` (`webapp/src/lib/logger.ts`) — adapt to what exists (feedme2 has `components/Button.tsx`, `Field.tsx`, `Select.tsx`; add a small `Input` only if none fits).
Wire-up: `HelpProvider` inside the Router wrapping `<Routes>` in `webapp/src/App.tsx`; a header button in `webapp/src/components/AppHeader.tsx` — `<button data-testid="help-link" aria-label="Help" aria-expanded={isOpen} onClick={isOpen ? closeHelp : openHelp}>?</button>`, styled like gigsy's (ringed "?"); screens with their own header (Settings, Reports, CatPage) use the same `AppHeader`, so the button appears everywhere — check and say so.

- [ ] Copy the tests first (adjust only names/imports), run red, port the modules, run `pnpm --filter ./webapp test -- src/help` green (the real-driver test takes ~16 s), typecheck, build.
- [ ] Commit `feat(webapp): help sheet and driver.js tours (runtime ported from gigsy)`.

## Task 3: feedme2's topics

**Files:** `webapp/src/help/targets.ts` (the map), `webapp/src/help/scenarios/*.ts`, `webapp/src/help/registry.ts`, `webapp/src/help/registry.test.ts`; add a `data-testid` to a control only where none exists (say which).

Targets (existing test ids): `TabReports` (`tab-reports`), `TabSettings` (`tab-settings`), `CatCard` (`cat-card`), `CatFeed` (`cat-feed`), `CatFeedMore` (`cat-feed-more`), `FeedAll` (`feed-all`), `EmptyCats` (`empty-cats`), `CatAdd` (`cat-add`), `CatName` (`cat-name`), `CatColors` (`cat-colors`), `CatSave` (`cat-save`), `FoodUnit` (`food-unit`), `CanSize` (`can-size`), `Devices` (`devices`), `PairCode` (`pair-code`), `PairSubmit` (`pair-submit`), `ReportTitle` (`report-title`), `ReportPrev` (`report-prev`), `ReportNext` (`report-next`), `ReportDrill` (`report-drill`), `ReportCsv` (`report-csv`), `ReportCat` (`report-cat`), `HelpLink` (`help-link`). Check each id against the current markup before using it.

Scenarios (all read-only; `click` only where the person's tap is harmless navigation):
1. `open-reports` (getting-started, start `/`): click `TabReports` — "See every feeding by day, week or month."
2. `feed-a-cat` (cats, start `/`): branch `cats-showing` (`CatCard` visible) → highlight `CatCard` (status and today's total), highlight `CatFeed` ("One tap logs the cat's usual amount; the first feeding opens the sheet"), branch `can-feed-other` (`CatFeedMore` visible) → highlight `CatFeedMore` ("Other… sets a different amount or time"), else end; branch `no-cats-yet` (`EmptyCats` visible) → highlight `EmptyCats` ("Add a cat in Settings first") end. `expectedCiBranches: ["cats-showing", …]` — pin whichever the CI fixture produces.
3. `feed-all-cats` (cats, start `/`): branch `two-or-more` (`FeedAll` visible) → highlight `FeedAll`; branch `one-cat` (`CatCard` visible) → highlight with "Feed all appears once you have two cats" end.
4. `add-a-cat` (cats, start `/settings`): click `CatAdd` → highlight `CatName` ("Type a name") → highlight `CatColors` → highlight `CatSave` ("Save adds it to the dashboard") end. (The tour opens the editor; it never types.)
5. `change-units` (settings, start `/settings`): highlight `FoodUnit`, branch `cans` (`CanSize` visible) → highlight `CanSize`.
6. `pair-a-device` (devices, start `/settings`): highlight `Devices`, highlight `PairCode` ("The 6-digit code on the device"), highlight `PairSubmit` end.
7. `read-reports` (reports, start `/reports`): highlight `ReportTitle` + `ReportPrev`/`ReportNext` ("move by the same range"), branch `has-feedings` (`ReportDrill` visible) → highlight `ReportDrill` ("tap a row to drill down: month → week → day → each feeding"), highlight `ReportCsv` end; branch `two-cats` (`ReportCat` visible) → highlight `ReportCat` inserted before the CSV step.
8. `install-app` (installation, non-executable, variants per environment) — copy gigsy's `install-app.ts` with the app name changed.

- [ ] Registry test first: `validateHelpRegistry(helpScenarios)` returns `[]`; ids are unique and the list above is registered in this order; each scenario's `startRoute` exists in `App.tsx`'s routes. Run red, add scenarios and targets, green.
- [ ] Commit `feat(webapp): help topics for feeding, cats, units, devices and reports`.

## Task 4: Help in CI

**Files:** `webapp/playwright.config.ts` (a `help` project: `devices["Pixel 7"]`, `testMatch: /help\/.*\.spec\.ts/`, `timeout: 90_000`, `expect: { timeout: 15_000 }`; the `chromium` project gets `testIgnore: /help\//` — copy gigsy's block and its comments on cold-start timeouts), `webapp/package.json` scripts (`help:test`, `help:validate`), `webapp/e2e/help/{help-fixtures.ts,help-runner.ts,scenarios.spec.ts,reachability.spec.ts}`, `.github/workflows/deploy.yml` (run `pnpm --filter ./webapp exec playwright test --project=help` in the `webapp-e2e-full` job after the main suite, same env).

- `help-runner.ts`: copy gigsy's (`runHelpScenario(page, scenario): Promise<{scenarioId, branchesTaken, stepsRun}>`, the 10 s appear/750 ms stable constants).
- `help-fixtures.ts`: `requireLocalTarget()` (localhost/127.0.0.1/[::1] only); `prepareHelpScenario(page, scenario)` = test-login a fresh house, seed what the expected branches need through the API (two cats with one feeding each for the "two-or-more"/"has-feedings" branches; see `webapp/e2e/helpers/seed.ts` for API seeding), wait for the dashboard's cat cards (the first pull), then `goto(startRoute)`.
- `scenarios.spec.ts`: "the registry is structurally valid"; `help: ${id}` per executable scenario asserting `stepsRun > 0` and `branchesTaken` equals `expectedCiBranches`; `help: ${id} (described, not executed)` for `install-app`.
- `reachability.spec.ts`: help opens from the header on `/` and on `/settings`; a real tour shows `.feedme2-help-popover` with computed `max-width` 320px (help.css loaded) and the target carries `driver-active-element`; the header button closes the sheet it opened; and `expectNoHorizontalOverflow(page)` holds with the popover open.

- [ ] Write the specs, run locally against the full stack (as CI's `webapp-e2e-full` does, wrangler 8787 + vite 5192), green; stop every process you started; add the CI step; commit `test(webapp): every help topic runs end to end in ci`.

## Task 5: Docs, verification, PR

- [ ] `handoff.md` (help tours line; the `help` Playwright project), `README.md` (how to add a topic: copy gigsy's `docs/help/README.md` adapted as `docs/help/README.md`), `CLAUDE.md` (help scenarios target `data-testid`s — renaming a test id breaks a tour, which CI now catches; tours never type or write), execution handoff.
- [ ] Verification: `pnpm -r typecheck && pnpm -r test && python -m unittest discover -s scripts && BASE_REF=origin/main python scripts/check_version_bump.py`, the local e2e (chromium + help projects).
- [ ] Push `feat/phase5b-help-tours`, PR "Phase 5b: help tours".

## Self-review against the spec

- §4 "driver.js tours for help" → Tasks 0–2; §7 row 5 "help tours" → Tasks 3–4. Stack parity with gigsy → Tasks 1–2, 4 are ports.
- Review Focus 1–5 → Tasks 2/4, 2, 3/4, 2/4, 2.
- Types: `HelpScenario`, `HelpTarget`, `targetSelector`, `validateHelpRegistry` (Task 1) are what Tasks 2–4 use; `runTour`, `HelpProvider`/`useHelp` (Task 2) what the header and specs use; scenario ids (Task 3) what `scenarios.spec.ts` iterates.
