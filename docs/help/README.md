# Adding a help topic

Help topics live in `webapp/src/help/scenarios/` and are plain data: one `HelpScenario` per topic, registered in `webapp/src/help/registry.ts`. The model, the runtime and the Playwright runner are a port of gigsy's executable help (`C:\Workspaces\gigsy\docs\help\README.md`, design in `docs\gigsy-executable-help-implementation-spec.md` there). This file is feedme2's day-to-day checklist, with the lessons the eight Phase 5b topics taught.

The pieces:

| File | What |
|---|---|
| `webapp/src/help/types.ts` | `HelpScenario`, the step types (`highlight`, `click`, `input`, `select`, `navigate`, `branch`, `external`), `HelpCondition`, `HelpCategory` (the six menu sections) |
| `webapp/src/help/targets.ts` | the `HelpTarget` map (named `data-testid`s), `targetSelector`, `resolveTarget` |
| `webapp/src/help/registry.ts` | `helpScenarios` (the one list the menu and the suite read) and `executableHelpScenarios` |
| `webapp/src/help/validate.ts` | `validateHelpRegistry`, structural checks only |
| `webapp/src/help/runtime/` | `HelpProvider` (navigates to `startRoute`, ends a tour that is walked out of, lazily loads the renderer), `TourRenderer.ts` (driver.js 1.8.0), `HelpSheet`, `HelpMenu`, `HelpUnavailableBanner` |
| `webapp/src/styles/help.css` | the popover theme (`.feedme2-help-popover`), tokens only, no `dark:` utilities |
| `webapp/e2e/help/` | `help-runner.ts` (Playwright acting out a scenario), `help-fixtures.ts` (local-only guard and the seeded house), `scenarios.spec.ts`, `reachability.spec.ts` |

## 1. Give the elements stable targets

Add them to `HelpTarget` in `webapp/src/help/targets.ts`. Every entry is an existing `data-testid`; check it against the markup, and note there when the element renders only in some states, because that is what scenarios branch on.

**Declare the kind; never derive it from the name.** A target is `element(...)` or `painted(...)` (kind `switch`). A switch resolves to the visible `span[aria-hidden="true"]` inside the `<label>` around an sr-only input that carries the test id; an element resolves to the tagged node. In gigsy, most controls were such switches, and the names lied in both directions. feedme2 has no painted switch today, so every target is `element`; `painted` stays so the first one has a home. If you add a component that hides its real input, read it before choosing.

**A missing test id may be added for help, but say so.** Phase 5b added three: `gram-step` and `oz-step` on Settings (so a grams or ounces house has something positive to branch on) and `cat-limit` on the "up to 8 cats" note (so a full house is a positive state).

**Duplicated test ids are normal here.** The dashboard is a list of cats, and every `CatCard` repeats `cat-card`, `cat-feed` and `cat-feed-more`. The tour spotlights the **first** match (`querySelector` in both `resolveTarget` and driver.js), so the runner reads the first match too: `help-runner.ts`'s `locatorFor` ends in `.first()`. gigsy kept Playwright's strict mode and treated a second match as a bug; feedme2 does not, because the first CI fixture run (two seeded cats) made `feed-a-cat` a strict-mode violation while the tour itself worked. The consequence: only the first card's controls are proven, and a branch condition can be met by a later card than the one spotlighted (`feed-a-cat`'s comment covers the case).

## 2. Write the scenario

**Tours never type and never write.** Steps are `highlight`, `click` (the person's own tap, and only where the tap is harmless: `open-reports` taps the Reports tab, `add-a-cat` opens the cat editor, which writes nothing until Save), `navigate` or `external`. No step is `input` or `select`, no `click` lands on Feed, Save, Pair or Download, and no scenario knows a record id. `registry.test.ts` pins all of this ("no topic types into a field or picks a value", "no scenario carries a record id"). The `input`, `select` and `navigate` step types and runner cases stay from gigsy so a future topic has them, but a topic that needs one is redesigned first.

**Give it a `startRoute`.** The provider navigates there before the tour starts. It must be a route `App.tsx` declares (pinned by `registry.test.ts`). `open-reports` starts on `/` rather than `/reports` so its one tap is a real move.

**A step's target may not exist yet.** The renderer resolves each step's target when the step is entered, not up front, and hands driver.js `targetSelector`'s string so `waitForElement` re-queries it. That is why `add-a-cat` can click `cat-add` and then highlight `cat-name`, `cat-colors` and `cat-save`, which exist only while the editor sheet is open. Keep that property if you touch the runtime.

**Branches resolve where the tour reaches them, in both adapters.** The renderer expands one branch at a time as the tour approaches it, and the runner walks the list in order, so a branch may sit after a click. It must still be answerable when it is reached: a condition about a screen the person has not opened yet is not.

**Branches do not nest.** Use two branch steps in a row (`feed-a-cat`: is there a cat; does it have a usual amount). An alternative that cannot continue ends on a step with `end: true`; everything after the branch step then belongs to the alternatives that did not end. Say so in a comment (`// Only cats-showing reaches here`).

**Branch on what the screen positively shows (`target-visible`), not on what it has not drawn yet (`target-missing`).** An absence is three claims at once: none, still loading, failed. gigsy's `find-a-gig` told people with hundreds of gigs that they had none for as long as a cold sync took. feedme2's topics use only `target-visible`:

- `cat-card` vs `empty-cats` (Dashboard.tsx): a dashboard still loading matches neither, so the branch waits instead of saying "no cats".
- `gram-step` / `oz-step` / `can-size`: Settings renders exactly one of the three, in the same commit as `food-unit`.
- `cat-limit` vs `cat-row`: both render from the loaded cat list in the same commit. `cat-add` is no condition at all: it is on screen, enabled, while the list is still loading.
- `report-drill` / `report-chart-feedings` / `report-offline`: the drill table is up for any range finer than a day, with or without feedings, so that branch is `report-showing`, not "has feedings".

**An ordered fallback is a positive condition made safe by order.** `feed-all-cats`' `one-cat` is "a card is visible", which is also true in a two-cat house; it is reached only because `two-or-more` (`feed-all`) is checked first, and both render in the same commit, so once a card is up the button's absence is a fact about the house. Use this only when the two elements really render together; say so in the comment.

**Branch only on states the person could be in, and give each a real chance to hold.** A branch step where no alternative holds is a hard failure (the tour ends in "This help step is currently unavailable" with Back to Help), not a no-op. Loading and server errors deliberately match nothing; "help isn't available right now" is the truth about a screen that has not loaded.

**Check the copy against the code, not against the plan.** Two Phase 5b texts were false when first written, and the review caught them. `feed-a-cat`'s Other… said whatever you log there becomes the usual amount, but the usual amount is the latest feeding's amount by `fed_at`, so a feeding logged for an earlier time leaves it alone. `add-a-cat`'s Name said each cat needs its own name, which nothing enforces. The same review found `add-a-cat` asking for a tap on Add a cat in a full house, where the button is greyed out and the click step waited forever; it now branches on `cat-limit` first.

## 3. Register it

Add it to `helpScenarios` in `webapp/src/help/registry.ts`. Registration order is the order inside a menu section; the sections follow `CATEGORY_LABELS` in `HelpMenu.tsx`. `registry.test.ts` pins the list and its order, so update it in the same commit.

## 4. Validate

```bash
pnpm --filter ./webapp help:validate
```

This is `vitest run src/help`: the whole help unit suite, not just the validator. It includes `TourRenderer.driver.test.ts`, which drives the real driver.js in jsdom and takes about 16 s on its own. `validateHelpRegistry` is structural only (duplicate ids, an empty branch, a nested branch, `expectedCiBranches` naming a branch that does not exist, a non-executable scenario without a `fallback` variant). It cannot tell whether a selector still resolves; that is step 5.

## 5. Run it against a local stack

`help:test` refuses any target but localhost, 127.0.0.1 or `[::1]` (`requireLocalTarget` in `help-fixtures.ts`, an allow-list): the scenarios sign in through the dev-only test-login and seed houses, and Playwright's default target is production, where they would skip, and a skip must never read as green. Bring up the same stack CI's `webapp-e2e-full` job does (see the README's full local end-to-end):

```bash
cp backend/.dev.vars.example backend/.dev.vars   # ENVIRONMENT=development, so test-login exists
pnpm db:migrate:local
pnpm dev:backend                                # wrangler on :8787
pnpm dev:webapp                                 # vite on :5173 (a second shell)
cd webapp && E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm help:test
```

The `help` Playwright project (Pixel 7, 90 s test timeout, 15 s `expect`, for the cold first pull and vite's first transform) runs `e2e/help/*.spec.ts`; the `chromium` project ignores that folder. In CI it runs only on pull requests, after the main suite in `webapp-e2e-full`, against wrangler on :8787 and vite on :5192.

**The fixture.** `prepareHelpScenario` gives every scenario a house no other test has touched (test-login finds or creates a house by a unique name), seeded through the API before the browser signs in: food unit grams, two cats (`Mochi`, `Luna`), one 40 g feeding each. It then waits for both cat cards (the first pull) and goes to `startRoute`. Nothing is shared between scenarios, so unlike gigsy nothing needs resetting. If a topic needs another state, seed it here, out of band, before any step runs; never by having the tour read the screen and click its way there.

The feeding time is `seededFedAt`: two minutes ago, but never before the start of today in UTC. It must stay on the test house's today (`reachability.spec.ts` reads "Today: 1 feeding · 40 g"), and the API rejects a feeding more than 5 minutes ahead. It used to be an hour ago, which between 00:00 and 01:00 UTC landed on yesterday and failed every nightly run.

**`expectedCiBranches` is measured, not guessed.** Run the suite and pin what the fixture produces, with a comment saying why. Today:

| Scenario | `expectedCiBranches` | Why |
|---|---|---|
| `open-reports`, `pair-a-device` | none | no branch step |
| `feed-a-cat` | `cats-showing`, `can-feed-other` | two cats, each fed once, so each has a usual amount |
| `feed-all-cats` | `two-or-more` | two cats |
| `add-a-cat` | `room-for-another` | two cats, well under 8 |
| `change-units` | `grams` | the fixture pins grams |
| `read-reports` | `report-showing`, `two-cats` | `/reports` opens on this week; two cats |

If the assertion fails intermittently, it is a race (a condition settling after the first check): fix the stability margin (`BRANCH_APPEAR_TIMEOUT_MS` 10 s, `BRANCH_STABLE_MS` 750 ms in `help-runner.ts`), not the assertion. If it fails consistently because the environment really changed, update the pin and the comment. Editing the pin to match a flake retires the coverage of the branch CI used to take.

## 6. Look at it, and know what the suite cannot see

A green `help:test` proves each step's target resolves and is operable on the branch CI takes. It does not prove the help is right:

- **Targets on branches CI does not take are prose.** Rename one and the guarding condition simply stops holding; the pinned branch runs and nothing fails. Today that is `cat-limit` (`add-a-cat`'s `house-full`), `empty-cats` (`no-cats-yet` in two topics), `feed-a-cat`'s `first-feeding`, `feed-all-cats`' `one-cat`, `can-size` and `oz-step` (`change-units`), `report-range`, `report-chart-feedings` and `report-offline` (`read-reports`), and `read-reports`' `one-cat`. If you touch a test id, grep `webapp/src/help/` for it yourself.
- **What a step does.** The runner clicks and moves on; it asserts nothing about the result. `reachability.spec.ts` happens to assert that `open-reports`' tap lands on `/reports`; nothing does that for `add-a-cat`'s tap.
- **Whether the copy is true.** Nothing compares a description to the control. See the two false texts in step 2.
- **Which card a person would look at.** The runner proves the first match only (step 1).

So run the topic yourself (`pnpm dev:webapp`, press "?" in the header, start it, and do what each step says, including the taps). On a phone width, and in dark mode.

`reachability.spec.ts` covers what the scenario suite structurally cannot: help opens from the header on `/settings` and `/`, picking a topic starts a real driver.js tour (`.feedme2-help-popover`, computed `max-width` 320px, `driver-active-element` on the target, no horizontal overflow on a 412 px phone), the sheet closes on the backdrop, on Enter on the focused "?" and on Close with focus returned to "?", and the backdrop blocks the page behind help. Do not add a per-topic copy of it.

Known behaviour worth knowing before you add a topic: Escape during `add-a-cat` closes both the tour and the cat editor; a pointer tap on "?" while help is open lands on the backdrop (z-50 over the z-30 header), which closes help, as intended; the "help unavailable" banner sits inside `#root`, so it is inert while a house Sheet is open, and it covers the update bar while shown.

## 7. Final check before committing

```bash
pnpm --filter ./webapp typecheck
pnpm --filter ./webapp test
pnpm --filter ./webapp help:validate
cd webapp && E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm help:test
cd webapp && E2E_BASE_URL=http://127.0.0.1:5173 E2E_REQUIRE_AUTH=1 pnpm test:e2e
```

Commit the scenario, any new `HelpTarget` entries and test ids, and the registry and its test together. The pre-commit hook bumps the webapp version.
