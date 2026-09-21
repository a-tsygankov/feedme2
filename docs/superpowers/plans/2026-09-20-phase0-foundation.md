# feedme2 Phase 0 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the feedme2 monorepo with four independently versioned tiers (webapp, worker, schema, firmware), CI that tests and deploys each on change, a deployed PWA shell whose hidden console shows every tier's version, a firmware skeleton that boots on hardware and in Wokwi, and the deep-sleep bench spike.

**Architecture:** pnpm workspace with `backend/` (Hono on Cloudflare Workers + D1), `webapp/` (React 18 + Vite 5 PWA on Cloudflare Pages, `/api/*` proxied to the Worker by a Pages Function), `shared/` (TypeScript-only workspace package: zod schemas, ring buffer, version compare), `firmware/` (PlatformIO, LVGL 9, three envs). Versions are auto-bumped per tier by a pre-commit hook and enforced by a CI gate. Everything in this phase is ported from `C:\Workspaces\gigsy` (web, worker, versioning, CI) and `C:\Workspaces\howler` (firmware, Wokwi); the plan quotes every file that differs from its source and gives an exact `cp` for every file that does not.

**Tech Stack:** pnpm 9, Node 22, TypeScript 5.6, Hono 4, Drizzle (config only this phase), wrangler 4, vitest 2 with `@cloudflare/vitest-pool-workers`, React 18, Vite 5, Tailwind 3.4, shadcn/ui (new-york), vite-plugin-pwa 0.21 (injectManifest), Playwright 1.49, Python 3.11 (version scripts), PlatformIO with espressif32 6.9, LVGL 9.0.0, TFT_eSPI 2.5, Wokwi CLI.

**Spec:** `docs/superpowers/specs/2026-09-20-feedme2-design.md` (§2 layout, §3.3 `/api/version`, §4.5–4.6 update bar + hidden console, §5.5 power spike, §5.7 Wokwi, §6 versioning/CI/scripts).

**Conventions used throughout:**
- Commands are run from the repo root `C:\Workspaces\feedme2` unless a step says otherwise. Shell is Git Bash (`bash`), because the pre-commit hook and CI scripts are POSIX.
- `GIGSY=C:/Workspaces/gigsy` and `HOWLER=C:/Workspaces/howler` are the port sources. Every `cp` in this plan is from one of them.
- Commit after every task with the message shown. The pre-commit hook (installed in Task 3) will auto-bump tier versions; that is expected and the bumped `package.json` rides along.
- Branch: do all of Phase 0 on `feat/phase0-foundation`, opened from `main` in Task 1, and open one PR at the end (Task 21).

---

## File structure (what this phase creates)

```
feedme2/
  .npmrc  .gitignore  package.json  pnpm-workspace.yaml  CLAUDE.md  README.md  handoff.md
  .githooks/pre-commit
  .github/workflows/{deploy.yml,version-check.yml}
  scripts/{version_rules.py,bump_versions.py,check_version_bump.py,
           test_version_scripts.py,test_check_version_bump.py,
           deploy.sh,deploy.ps1,setup-secrets.ps1}
  shared/{package.json,tsconfig.json,vitest.config.ts,
          src/{index.ts,log.ts,version.ts,ring-buffer.ts,compare-versions.ts,*.test.ts}}
  backend/{package.json,wrangler.toml,tsconfig.json,vitest.config.ts,drizzle.config.ts,.dev.vars.example,
           migrations/0000_init.sql,
           src/{index.ts,env.ts,logger.ts,version.ts,routes/{version.ts,debug.ts}},
           test/{health.test.ts,version.test.ts,debug.test.ts}}
  webapp/{package.json,vite.config.ts,vitest.config.ts,playwright.config.ts,
          tsconfig.json,tsconfig.app.json,tsconfig.node.json,tsconfig.e2e.json,
          tailwind.config.ts,postcss.config.js,components.json,index.html,
          public/{theme-boot.js,_redirects,icons/*},
          functions/{_middleware.ts,api/[[path]].ts},
          scripts/generate-icons.mjs,
          src/{main.tsx,App.tsx,sw.ts,styles.css,styles/tokens/*.css,
               lib/{utils.ts,theme.ts,logger.ts,versions.ts,multi-tap.ts,pwa-update.ts,pwa-update-browser.ts,*.test.ts},
               components/{Logo.tsx,UpdateBar.tsx,LogList.tsx,HiddenConsole.tsx,ConsoleProvider.tsx},
               screens/Shell.tsx},
          e2e/{smoke.spec.ts,hidden-console.spec.ts}}
  firmware/{platformio.ini,wokwi.toml,diagram.json,.gitignore,
            partitions/default_16MB.csv,include/lv_conf.h,
            scripts/{strip_lvgl_simd.py,merge_simulator_bin.py},
            wokwi/boot.scenario.yaml,
            src/{main.cpp,application/Version.h,domain/Version.h,domain/SimInput.h,spike/sleep_touch/main.cpp},
            test/test_domain/{runner.cpp,test_version.cpp,test_sim_input.cpp}}
  docs/spikes/2026-09-deep-sleep-touch-wake.md
```

Responsibilities: `shared/` owns anything both TS tiers must agree on; `backend/src/logger.ts` and `webapp/src/lib/logger.ts` are thin sinks over `shared` types; `scripts/version_rules.py` is the only place tier membership is defined; `firmware/src/domain/` has no Arduino includes so `pio test -e native` compiles it on the host.

---

## Task 1: Repository root, workspace, branch

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `.gitignore`, `CLAUDE.md`, `README.md`, `handoff.md`

- [ ] **Step 1: Create the branch**

```bash
cd C:/Workspaces/feedme2 && git checkout -b feat/phase0-foundation
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "feedme2",
  "private": true,
  "version": "0.0.1",
  "description": "feedme2 — household cat-feeding tracker (PWA + Cloudflare Workers + ESP32 dial). See docs/superpowers/specs/2026-09-20-feedme2-design.md.",
  "scripts": {
    "prepare": "git config core.hooksPath .githooks",
    "dev:backend": "pnpm --filter feedme2-backend dev",
    "dev:webapp": "pnpm --filter feedme2-webapp dev",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck",
    "test": "pnpm -r test",
    "db:migrate:local": "pnpm --filter feedme2-backend db:migrate:local",
    "db:migrate:remote": "pnpm --filter feedme2-backend db:migrate:remote",
    "deploy:backend": "pnpm --filter feedme2-backend deploy",
    "deploy:webapp": "pnpm --filter feedme2-webapp deploy"
  },
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=20" }
}
```

- [ ] **Step 3: Write `pnpm-workspace.yaml`**

```yaml
packages:
  - shared
  - backend
  - webapp
```

- [ ] **Step 4: Write `.npmrc`** (supply-chain gate from the global rules; 7 days)

```ini
min-release-age=7
```

- [ ] **Step 5: Write `.gitignore`**

```gitignore
# Node
node_modules/
.pnpm-store/
*.log
npm-debug.log*
pnpm-debug.log*

# Build output
dist/
build/
.cache/
*.tsbuildinfo

# Cloudflare / Wrangler
.wrangler/
.dev.vars
.dev.vars.*
!.dev.vars.example

# Drizzle
drizzle/meta/
.drizzle/

# Vite
*.local

# Playwright
test-results/
playwright-report/
playwright/.cache/

# Python (version tooling)
__pycache__/
*.pyc

# PlatformIO
firmware/.pio/
firmware/serial.log
firmware/scripts/secrets/

# OS / editor
.DS_Store
Thumbs.db
.idea/
.vscode/*
!.vscode/extensions.json

# Secrets
.env
.env.*
!.env.example
# setup-secrets.ps1 is committed with placeholders; a filled-in copy
# must never be. Keep local copies under this name:
scripts/setup-secrets.local.ps1
```

- [ ] **Step 6: Write `CLAUDE.md`**

```markdown
# feedme2 — agent rules

Spec: `docs/superpowers/specs/2026-09-20-feedme2-design.md`. Plans: `docs/superpowers/plans/`. Live state: `handoff.md` (one page, update when a phase changes or a URL/resource is added).

## Layout
- `shared/` TypeScript-only workspace package (`@feedme2/shared`): zod schemas, ring buffer, version compare. Imported by backend and webapp as source.
- `backend/` Hono Worker `feedme2-api` on D1 `feedme2-db`. Migrations are hand-written numbered SQL in `backend/migrations/`; never edit one in place, add a new one.
- `webapp/` React 18 + Vite 5 PWA on Pages `feedme2-webapp`. `/api/*` is proxied by `functions/api/[[path]].ts`. No `dark:` Tailwind utilities: theming is the token layer in `src/styles/tokens/` plus `data-theme` on `<html>`.
- `firmware/` PlatformIO. `domain/` has no Arduino includes (host-tested by `pio test -e native`). Envs: `crowpanel` (hardware), `simulator` (Wokwi), `native` (tests), `spike-sleep` (bench spike only).

## Versioning
Four tiers, each auto-bumped by `.githooks/pre-commit` (`scripts/bump_versions.py`) and enforced on PRs by `scripts/check_version_bump.py`: webapp (`webapp/package.json`), worker (`backend/package.json`), schema (new file in `backend/migrations/`), firmware (`firmware/src/application/Version.h`). `shared/` changes bump webapp and worker. Doc-only changes bump nothing.

## Rules
- TDD: failing test first, then the minimal code. Comments explain *why* and name the incident when there is one.
- Integers only in D1 (epoch-ms, milligrams). Client-generated UUID primary keys.
- Never print secret values. `scripts/setup-secrets.ps1` is committed with placeholders; the real copy is `scripts/setup-secrets.local.ps1` (gitignored).
- Cloudflare account: the one whose workers.dev subdomain is `atsyg-feedme`. Names: `feedme2-api`, `feedme2-webapp`, `feedme2-db`, `feedme2-firmware`.
- Commit messages: lowercase conventional style with scope (`feat(webapp): …`), ending with the Co-Authored-By line from the session reminder.
```

- [ ] **Step 7: Write `README.md`**

```markdown
# feedme2

Household cat-feeding tracker: a knob-driven ESP32 dial (Elecrow CrowPanel 1.28"), a PWA, and a Cloudflare Worker. Design: `docs/superpowers/specs/2026-09-20-feedme2-design.md`.

## Layout

| Dir | What | Deploys to |
|---|---|---|
| `shared/` | zod schemas, ring buffer, version compare (TS only) | bundled into both |
| `backend/` | Hono Worker + D1 | `feedme2-api.atsyg-feedme.workers.dev` |
| `webapp/` | React 18 + Vite PWA | `feedme2-webapp.pages.dev` |
| `firmware/` | PlatformIO / LVGL 9 for CrowPanel | flashed over USB, later OTA |

## Getting started

```bash
pnpm install                      # also installs the pre-commit version-bump hook
cp backend/.dev.vars.example backend/.dev.vars
pnpm db:migrate:local
pnpm dev:backend                  # wrangler dev on :8787
pnpm dev:webapp                   # vite on :5173, proxies /api to :8787
pnpm test                         # shared + backend + webapp unit tests
cd webapp && pnpm test:e2e        # Playwright against E2E_BASE_URL (default: production)
cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator
```

## Versioning

Each tier has its own version, bumped automatically on commit for the tiers the staged diff touches. See `CLAUDE.md`.

## Hidden console

Tap the logo three times to open the debug console: tier versions and client/worker logs.
```

- [ ] **Step 8: Write `handoff.md`**

```markdown
# feedme2 — state of the world

Single page. Update at the end of any session that changes phase, adds a resource, or resolves a spec open question.

## Phase
Phase 0 (foundation) in progress — plan: `docs/superpowers/plans/2026-09-20-phase0-foundation.md`.

## Live resources
| Thing | Name / URL | Notes |
|---|---|---|
| Worker | `feedme2-api` → https://feedme2-api.atsyg-feedme.workers.dev | deployed by `.github/workflows/deploy.yml` on push to main |
| Pages | `feedme2-webapp` → https://feedme2-webapp.pages.dev | per-branch previews `<branch>.feedme2-webapp.pages.dev` |
| D1 | `feedme2-db` (id in `backend/wrangler.toml`) | migrations via `wrangler d1 migrations apply` |
| R2 | `feedme2-firmware` | OTA binaries (Phase 3) |
| GitHub secrets | `CLOUDFLARE_API_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `WOKWI_CLI_TOKEN` | set with `scripts/setup-secrets.local.ps1 -GitHub` |
| Worker secrets | `AUTH_SECRET` | set with `scripts/setup-secrets.local.ps1 -Cloudflare` |

## Open questions (spec §0)
Q1 battery pin · Q2 touch-controller rail (spike: `docs/spikes/2026-09-deep-sleep-touch-wake.md`) · Q3 two new cat poses · Q4 web client id · Q5 can-size presets.

## Log
- 2026-09-20 — spec approved; Phase 0 started.
```

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-workspace.yaml .npmrc .gitignore CLAUDE.md README.md handoff.md
git commit -m "chore: repo root, workspace, agent rules"
```

---

## Task 2: `shared/` workspace package

**Files:**
- Create: `shared/package.json`, `shared/tsconfig.json`, `shared/vitest.config.ts`
- Create: `shared/src/ring-buffer.ts`, `shared/src/ring-buffer.test.ts`
- Create: `shared/src/compare-versions.ts`, `shared/src/compare-versions.test.ts`
- Create: `shared/src/log.ts`, `shared/src/log.test.ts`
- Create: `shared/src/version.ts`, `shared/src/version.test.ts`
- Create: `shared/src/index.ts`

- [ ] **Step 1: Write `shared/package.json`**

```json
{
  "name": "@feedme2/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "build": "echo shared has no build step"
  },
  "dependencies": { "zod": "^3.23.0" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "~2.1.0" }
}
```

The package version is deliberately `0.0.0` and never bumped: `shared/` is not a tier. Changes here bump webapp and worker (Task 3).

- [ ] **Step 2: Write `shared/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Write `shared/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the failing ring-buffer test `shared/src/ring-buffer.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { RingBuffer } from "./ring-buffer.ts";

describe("RingBuffer", () => {
  it("keeps only the most recent `capacity` items, oldest first", () => {
    const b = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) b.push(n);
    expect(b.toArray()).toEqual([3, 4, 5]);
    expect(b.size).toBe(3);
  });

  it("rejects a non-positive capacity", () => {
    expect(() => new RingBuffer(0)).toThrow(/positive integer/);
    expect(() => new RingBuffer(1.5)).toThrow(/positive integer/);
  });

  it("toArray returns a copy", () => {
    const b = new RingBuffer<number>(2);
    b.push(1);
    const a = b.toArray();
    a.push(99);
    expect(b.toArray()).toEqual([1]);
  });
});
```

- [ ] **Step 5: Run it to verify it fails**

```bash
cd shared && pnpm install && pnpm test
```
Expected: FAIL, `Cannot find module './ring-buffer.ts'`.

- [ ] **Step 6: Write `shared/src/ring-buffer.ts`**

```ts
/**
 * Fixed-capacity FIFO buffer — keeps the most recent `capacity` items.
 * Backs the client and worker log histories shown in the hidden
 * console. One copy, in shared/, so the two tiers cannot drift.
 */
export class RingBuffer<T> {
  private items: T[] = [];

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new Error(`RingBuffer capacity must be a positive integer, got ${capacity}`);
    }
  }

  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.capacity) {
      this.items.splice(0, this.items.length - this.capacity);
    }
  }

  /** Items oldest → newest. */
  toArray(): T[] {
    return [...this.items];
  }

  get size(): number {
    return this.items.length;
  }
}
```

- [ ] **Step 7: Write the failing compare-versions test `shared/src/compare-versions.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { compareVersions } from "./compare-versions.ts";

const sgn = (v: number) => (v > 0 ? 1 : v < 0 ? -1 : 0);

describe("compareVersions", () => {
  it("equal", () => {
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
  });
  it("numeric ordering beats lexicographic", () => {
    expect(sgn(compareVersions("1.10.0", "1.2.0"))).toBe(1);
    expect(sgn(compareVersions("0.9.0", "0.10.0"))).toBe(-1);
  });
  it("missing segments are zero", () => {
    expect(compareVersions("1.4", "1.4.0")).toBe(0);
    expect(sgn(compareVersions("1.4", "1.4.1"))).toBe(-1);
  });
  it("prerelease sorts before release", () => {
    expect(sgn(compareVersions("1.4.2-rc1", "1.4.2"))).toBe(-1);
    expect(sgn(compareVersions("1.4.2", "1.4.2-rc1"))).toBe(1);
  });
});
```

- [ ] **Step 8: Write `shared/src/compare-versions.ts`**

```ts
/**
 * Semver-style compare without the dependency. Mirrors
 * firmware/src/domain/Version.h exactly: per-segment numeric compare
 * when both sides are digits; a non-numeric tail ("1.4.2-rc1") sorts
 * BEFORE the bare numeric form. Used by the update bar (Task 12) to
 * compare the served webapp version with the running one, and later by
 * the OTA advisory.
 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".");
  const pb = b.split(".");
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? "0";
    const sb = pb[i] ?? "0";
    const aNum = /^\d+$/.test(sa);
    const bNum = /^\d+$/.test(sb);
    if (aNum && bNum) {
      const na = Number(sa);
      const nb = Number(sb);
      if (na !== nb) return na < nb ? -1 : 1;
    } else if (aNum !== bNum) {
      return aNum ? 1 : -1;
    } else {
      const cmp = sa.localeCompare(sb);
      if (cmp !== 0) return cmp < 0 ? -1 : 1;
    }
  }
  return 0;
}
```

- [ ] **Step 9: Write the failing log-schema test `shared/src/log.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { LogEntrySchema } from "./log.ts";

describe("LogEntrySchema", () => {
  it("accepts a minimal entry", () => {
    const r = LogEntrySchema.safeParse({ ts: 1, level: "info", source: "web", msg: "hi" });
    expect(r.success).toBe(true);
  });
  it("rejects an unknown level or source", () => {
    expect(LogEntrySchema.safeParse({ ts: 1, level: "trace", source: "web", msg: "x" }).success).toBe(false);
    expect(LogEntrySchema.safeParse({ ts: 1, level: "info", source: "phone", msg: "x" }).success).toBe(false);
  });
  it("caps msg at 500 chars", () => {
    expect(LogEntrySchema.safeParse({ ts: 1, level: "info", source: "web", msg: "x".repeat(501) }).success).toBe(false);
  });
});
```

- [ ] **Step 10: Write `shared/src/log.ts`**

```ts
import { z } from "zod";

/**
 * One log line, the same shape for web, worker and device so the
 * hidden console renders all three in one list (spec §4.6).
 */
export const LogLevelSchema = z.enum(["debug", "info", "warn", "error"]);
export const LogSourceSchema = z.enum(["web", "worker", "device"]);

export const LogEntrySchema = z.object({
  /** epoch ms */
  ts: z.number().int(),
  level: LogLevelSchema,
  source: LogSourceSchema,
  msg: z.string().max(500),
  data: z.record(z.unknown()).optional(),
  deviceId: z.string().max(64).optional(),
  clientId: z.string().max(64).optional(),
});

export type LogLevel = z.infer<typeof LogLevelSchema>;
export type LogSource = z.infer<typeof LogSourceSchema>;
export type LogEntry = z.infer<typeof LogEntrySchema>;
```

- [ ] **Step 11: Write the failing version-schema test `shared/src/version.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { VersionResponseSchema } from "./version.ts";

describe("VersionResponseSchema", () => {
  it("parses the worker's /api/version body", () => {
    const body = {
      worker: { version: "0.1.0", env: "production" },
      schema: { version: "0000_init.sql" },
      firmware: { latest: null },
    };
    expect(VersionResponseSchema.parse(body)).toEqual(body);
  });
  it("allows schema.version to be null (no migrations applied)", () => {
    expect(
      VersionResponseSchema.safeParse({
        worker: { version: "0.1.0", env: "development" },
        schema: { version: null },
        firmware: { latest: null },
      }).success,
    ).toBe(true);
  });
});
```

- [ ] **Step 12: Write `shared/src/version.ts`**

```ts
import { z } from "zod";

/**
 * GET /api/version. The webapp adds its own build-time version; the
 * worker reports the tiers only it can know. `firmware.latest` is the
 * newest active release (null until Phase 3 lands firmware_releases).
 */
export const VersionResponseSchema = z.object({
  worker: z.object({ version: z.string(), env: z.string() }),
  schema: z.object({ version: z.string().nullable() }),
  firmware: z.object({ latest: z.string().nullable() }),
});

export type VersionResponse = z.infer<typeof VersionResponseSchema>;
```

- [ ] **Step 13: Write `shared/src/index.ts`**

```ts
export { RingBuffer } from "./ring-buffer.ts";
export { compareVersions } from "./compare-versions.ts";
export { LogEntrySchema, LogLevelSchema, LogSourceSchema } from "./log.ts";
export type { LogEntry, LogLevel, LogSource } from "./log.ts";
export { VersionResponseSchema } from "./version.ts";
export type { VersionResponse } from "./version.ts";
```

- [ ] **Step 14: Run tests and typecheck**

```bash
cd shared && pnpm test && pnpm typecheck
```
Expected: 4 test files, all PASS; tsc silent.

- [ ] **Step 15: Commit**

```bash
git add shared pnpm-lock.yaml
git commit -m "feat(shared): ring buffer, version compare, log and version schemas"
```

---

## Task 3: Versioning scripts, pre-commit hook, CI gate

Ported from gigsy with one extension: a fourth tier, `firmware`, whose version lives in a C++ header, and `shared/` counting toward both webapp and worker.

**Files:**
- Create: `scripts/version_rules.py`, `scripts/bump_versions.py`, `scripts/check_version_bump.py`
- Create: `scripts/test_version_scripts.py`, `scripts/test_check_version_bump.py`
- Create: `.githooks/pre-commit`
- Create: `.github/workflows/version-check.yml`

- [ ] **Step 1: Write the failing rules test `scripts/test_version_scripts.py`** (start from gigsy's, then the firmware/shared cases)

```bash
cp "$GIGSY/scripts/test_version_scripts.py" scripts/test_version_scripts.py
```

Then replace the `DocClassification`, `TierMatching` and `BaseRepo` classes with these (leave the rest of the file untouched):

```python
class DocClassification(unittest.TestCase):
    def test_markdown_anywhere_is_doc(self):
        self.assertTrue(vr.is_doc_file("webapp/README.md"))
        self.assertTrue(vr.is_doc_file("firmware/notes.md"))

    def test_docs_dir_is_doc(self):
        self.assertTrue(vr.is_doc_file("docs/superpowers/specs/x.md"))

    def test_handoff_is_doc(self):
        self.assertTrue(vr.is_doc_file("handoff.md"))

    def test_source_is_not_doc(self):
        self.assertFalse(vr.is_doc_file("webapp/src/App.tsx"))
        self.assertFalse(vr.is_doc_file("firmware/src/main.cpp"))


class TierMatching(unittest.TestCase):
    def tier(self, name: str) -> vr.Tier:
        return next(t for t in vr.TIERS if t.name == name)

    def test_webapp_matches_webapp_source(self):
        self.assertTrue(self.tier("webapp").matches("webapp/src/App.tsx"))

    def test_webapp_ignores_webapp_docs(self):
        self.assertFalse(self.tier("webapp").matches("webapp/README.md"))

    def test_worker_matches_backend_source(self):
        self.assertTrue(self.tier("worker").matches("backend/src/index.ts"))

    def test_worker_excludes_migrations(self):
        self.assertFalse(self.tier("worker").matches("backend/migrations/0001_x.sql"))

    def test_shared_counts_for_webapp_and_worker(self):
        self.assertTrue(self.tier("webapp").matches("shared/src/log.ts"))
        self.assertTrue(self.tier("worker").matches("shared/src/log.ts"))
        self.assertFalse(self.tier("firmware").matches("shared/src/log.ts"))

    def test_firmware_matches_firmware_and_fixtures(self):
        self.assertTrue(self.tier("firmware").matches("firmware/src/main.cpp"))
        self.assertTrue(self.tier("firmware").matches("firmware/platformio.ini"))
        self.assertTrue(self.tier("firmware").matches("fixtures/unit-vectors.json"))
        self.assertFalse(self.tier("firmware").matches("firmware/README.md"))

    def test_tiers_declare_version_files(self):
        self.assertEqual(self.tier("webapp").version_file, "webapp/package.json")
        self.assertEqual(self.tier("worker").version_file, "backend/package.json")
        self.assertEqual(self.tier("firmware").version_file, "firmware/src/application/Version.h")


class VersionExtractors(unittest.TestCase):
    def test_package_json(self):
        self.assertEqual(vr.read_package_json_version('{"version": "1.2.3"}'), "1.2.3")
        self.assertIsNone(vr.read_package_json_version("{}"))

    def test_header(self):
        src = 'constexpr const char* kFirmwareVersion = "0.3.2";\n'
        self.assertEqual(vr.read_header_version(src), "0.3.2")
        self.assertIsNone(vr.read_header_version("// nothing here"))

    def test_header_rewrite_preserves_everything_else(self):
        src = "#pragma once\nconstexpr const char* kFirmwareVersion = \"0.3.2\";  // keep me\n"
        out = vr.write_header_version(src, "0.3.3")
        self.assertEqual(out, "#pragma once\nconstexpr const char* kFirmwareVersion = \"0.3.3\";  // keep me\n")


def _header(version: str) -> str:
    return f'#pragma once\nnamespace feedme2::application {{\nconstexpr const char* kFirmwareVersion = "{version}";\n}}\n'


class BaseRepo(unittest.TestCase):
    """A four-tier repo with one commit of history."""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.repo = Path(self._tmp.name)
        _git(self.repo, "init", "-b", "main")
        _git(self.repo, "config", "user.email", "t@example.com")
        _git(self.repo, "config", "user.name", "t")
        _write(self.repo, "webapp/package.json", _pkg("0.0.1"))
        _write(self.repo, "backend/package.json", _pkg("0.0.1"))
        _write(self.repo, "firmware/src/application/Version.h", _header("0.0.1"))
        _write(self.repo, "webapp/src/App.tsx", "export {}\n")
        _write(self.repo, "backend/src/index.ts", "export {}\n")
        _write(self.repo, "shared/src/log.ts", "export {}\n")
        _write(self.repo, "firmware/src/main.cpp", "int main(){}\n")
        _git(self.repo, "add", "-A")
        _git(self.repo, "commit", "-m", "base")

    def tearDown(self):
        self._tmp.cleanup()


class FirmwareAndSharedBumps(BaseRepo):
    def test_bumps_firmware_header_when_firmware_staged(self):
        _write(self.repo, "firmware/src/main.cpp", "int main(){return 1;}\n")
        _git(self.repo, "add", "firmware/src/main.cpp")

        bumped = bv.run(self.repo)

        self.assertEqual(bumped, ["firmware"])
        staged = _git(self.repo, "show", ":firmware/src/application/Version.h")
        self.assertIn('kFirmwareVersion = "0.0.2"', staged)
        worktree = (self.repo / "firmware/src/application/Version.h").read_bytes().decode()
        self.assertIn('kFirmwareVersion = "0.0.2"', worktree)

    def test_shared_change_bumps_webapp_and_worker_only(self):
        _write(self.repo, "shared/src/log.ts", "export const x = 1\n")
        _git(self.repo, "add", "shared/src/log.ts")

        bumped = bv.run(self.repo)

        self.assertEqual(sorted(bumped), ["webapp", "worker"])
        self.assertEqual(_staged_version(self.repo, "webapp/package.json"), "0.0.2")
        self.assertEqual(_staged_version(self.repo, "backend/package.json"), "0.0.2")
        header = _git(self.repo, "show", ":firmware/src/application/Version.h")
        self.assertIn('kFirmwareVersion = "0.0.1"', header)
```

Also, in the copied file, every remaining reference to `gigsy-handoff.md` becomes `handoff.md`:

```bash
sed -i 's/gigsy-handoff\.md/handoff.md/g' scripts/test_version_scripts.py
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m unittest scripts.test_version_scripts -v 2>&1 | tail -5
```
Expected: `ModuleNotFoundError: No module named 'bump_versions'` (or `version_rules`).

- [ ] **Step 3: Write `scripts/version_rules.py`**

```python
#!/usr/bin/env python3
"""Single source of truth for tier/versioning rules (spec §6.1).

Consumed by:
  bump_versions.py       — pre-commit auto-bump (writes versions)
  check_version_bump.py  — CI gate (verifies versions)

Tiers and their version sources:
  webapp    webapp/package.json                 `.version`
  worker    backend/package.json                `.version`
  firmware  firmware/src/application/Version.h  kFirmwareVersion = "..."
  schema    backend/migrations/   the numbered .sql filename IS the
                                  version — no file to bump, so it has
                                  no Tier entry; both consumers
                                  special-case it via SCHEMA_DIR.

shared/ is not a tier: it is bundled into webapp and worker, so a
change there bumps both. fixtures/ ships into firmware tests and the
TS tests alike; it counts for firmware (the TS side is covered by the
shared/ rule when the vectors module changes with it).
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

DOC_SUFFIXES = (".md", ".txt")
DOC_PATHS = ("handoff.md", "README.md", "AGENTS.md", "CLAUDE.md", "docs/")

SCHEMA_DIR = "backend/migrations/"
SHARED_DIR = "shared/"
FIXTURES_DIR = "fixtures/"


def is_doc_file(path: str) -> bool:
    return path.endswith(DOC_SUFFIXES) or any(
        path == p or path.startswith(p) for p in DOC_PATHS
    )


def _in_shared(p: str) -> bool:
    return p.startswith(SHARED_DIR) and not is_doc_file(p)


def _in_webapp(p: str) -> bool:
    return (p.startswith("webapp/") and not is_doc_file(p)) or _in_shared(p)


def _in_worker(p: str) -> bool:
    if _in_shared(p):
        return True
    return p.startswith("backend/") and not p.startswith(SCHEMA_DIR) and not is_doc_file(p)


def _in_firmware(p: str) -> bool:
    if p.startswith(FIXTURES_DIR) and not is_doc_file(p):
        return True
    return p.startswith("firmware/") and not is_doc_file(p)


# ── version file codecs ──────────────────────────────────────────
# Each tier's version file has a reader (content → version or None)
# and a writer (content, new version → content) that touches ONLY the
# version field, so formatting, comments and line endings survive.

def read_package_json_version(content: str) -> Optional[str]:
    try:
        return str(json.loads(content)["version"])
    except (KeyError, json.JSONDecodeError):
        return None


def write_package_json_version(content: str, new_version: str) -> str:
    replaced = re.sub(
        r'("version"\s*:\s*")[^"]+(")',
        rf"\g<1>{new_version}\g<2>",
        content,
        count=1,
    )
    if read_package_json_version(replaced) != new_version:
        raise RuntimeError("failed to rewrite package.json version field")
    return replaced


_HEADER_RE = re.compile(r'(kFirmwareVersion\s*=\s*")([^"]+)(")')


def read_header_version(content: str) -> Optional[str]:
    m = _HEADER_RE.search(content)
    return m.group(2) if m else None


def write_header_version(content: str, new_version: str) -> str:
    replaced, n = _HEADER_RE.subn(rf"\g<1>{new_version}\g<3>", content, count=1)
    if n != 1 or read_header_version(replaced) != new_version:
        raise RuntimeError("failed to rewrite kFirmwareVersion")
    return replaced


@dataclass(frozen=True)
class Tier:
    name: str
    version_file: str
    read: Callable[[str], Optional[str]] = field(repr=False)
    write: Callable[[str, str], str] = field(repr=False)
    _matches: Callable[[str], bool] = field(repr=False)

    def matches(self, path: str) -> bool:
        return self._matches(path)


TIERS: list[Tier] = [
    Tier("webapp", "webapp/package.json", read_package_json_version, write_package_json_version, _in_webapp),
    Tier("worker", "backend/package.json", read_package_json_version, write_package_json_version, _in_worker),
    Tier("firmware", "firmware/src/application/Version.h", read_header_version, write_header_version, _in_firmware),
]


def bump_patch(v: str) -> str:
    """Next patch version (M.m.p → M.m.p+1). Best-effort; if the
    version doesn't look like semver we append '.1' so callers still
    produce a changed value."""
    parts = v.split(".")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return f"{parts[0]}.{parts[1]}.{int(parts[2]) + 1}"
    return f"{v}.1"
```

- [ ] **Step 4: Write `scripts/bump_versions.py`** (gigsy's, with the codec calls going through the tier)

```bash
cp "$GIGSY/scripts/bump_versions.py" scripts/bump_versions.py
```

Then make these three edits:

1. Replace the import line `from version_rules import TIERS, bump_patch` with:
```python
from version_rules import TIERS, Tier, bump_patch
```
2. Delete the functions `_version_of` and `_bump_package_json` entirely.
3. Replace `_bump_worktree` and `run` with:

```python
def _bump_worktree(repo: Path, tier: Tier, staged_v: str, new_v: str) -> None:
    """Edit the version field of the worktree copy in place, leaving
    the rest of the file (unstaged edits included) untouched."""
    path = repo / tier.version_file
    if not path.exists():
        return
    content = path.read_bytes().decode("utf-8")
    if tier.read(content) != staged_v:
        # The worktree version already differs from the staged one, so
        # an unstaged edit (or an unparsable file) is in play. Retyping
        # the field would destroy it — leave the file alone and say so
        # loudly. The index still gets the bump.
        # ASCII only: this runs inside a pre-commit hook, where a
        # UnicodeEncodeError on a narrow console codepage would abort
        # the commit.
        print(
            f"[bump_versions] {tier.version_file}: worktree version differs "
            f"from the staged one - worktree left untouched, index staged at "
            f"{new_v}. Reconcile the file by hand.",
            file=sys.stderr,
        )
        return
    path.write_bytes(tier.write(content, new_v).encode("utf-8"))


def run(repo: Path) -> list[str]:
    """Bump every tier the staged diff touches. Returns bumped tier
    names (empty when nothing needed)."""
    staged = _staged_files(repo)
    if not staged:
        return []

    bumped: list[str] = []
    for tier in TIERS:
        if not any(tier.matches(p) for p in staged):
            continue

        rel = tier.version_file
        staged_src = _show(repo, f":{rel}")
        head_src = _show(repo, f"HEAD:{rel}")
        staged_v = tier.read(staged_src) if staged_src is not None else None
        head_v = tier.read(head_src) if head_src is not None else None
        if staged_v is None:
            # Version file missing/unparsable in the index — leave it
            # to the CI check to complain with full context.
            continue
        if head_v is None or staged_v != head_v:
            # New file, or already bumped in this commit — done.
            continue

        new_v = bump_patch(staged_v)
        assert staged_src is not None
        # Index first: it is what the commit records. If the worktree
        # write then fails the hook aborts the commit, and the next
        # run finds the version already bumped and no-ops.
        _stage_blob(repo, rel, tier.write(staged_src, new_v))
        _bump_worktree(repo, tier, staged_v, new_v)
        bumped.append(tier.name)
    return bumped
```

- [ ] **Step 5: Write `scripts/check_version_bump.py`** (gigsy's, reading through the tier codec)

```bash
cp "$GIGSY/scripts/check_version_bump.py" scripts/check_version_bump.py
```

Edits: delete the `package_json_version` function; change the import to `from version_rules import SCHEMA_DIR, TIERS, bump_patch, is_doc_file` (unchanged) and replace the two lines

```python
        head_v = package_json_version(head_content)
        base_v = package_json_version(base_content)
```
with
```python
        head_v = tier.read(head_content)
        base_v = tier.read(base_content)
```
and in the module docstring add the line `  firmware firmware/src/application/Version.h  kFirmwareVersion` under the tier list.

- [ ] **Step 6: Copy the CI-gate tests and fix names**

```bash
cp "$GIGSY/scripts/test_check_version_bump.py" scripts/test_check_version_bump.py
sed -i 's/gigsy-handoff\.md/handoff.md/g' scripts/test_check_version_bump.py
```

Append this class to the end of the file (it reuses the file's existing `_git`/`_write` helpers if present; if the copied file names them differently, use its names):

```python
class FirmwareGate(unittest.TestCase):
    """The gate parses the header tier through the same codec the bumper writes."""

    def test_firmware_header_read(self):
        import version_rules as vr
        self.assertEqual(vr.TIERS[2].name, "firmware")
        self.assertEqual(vr.TIERS[2].read('constexpr const char* kFirmwareVersion = "1.2.3";'), "1.2.3")
```

- [ ] **Step 7: Run the whole scripts suite**

```bash
python -m unittest discover -s scripts -v 2>&1 | tail -15
```
Expected: all tests `ok`, ending `OK`. The gigsy-inherited tests (`PreservesUnstagedEdits`, `HookEndToEnd`, `LineEndingsPreserved`) must still pass; they use `webapp/package.json` and are unaffected by the extra tiers.

- [ ] **Step 8: Write `.githooks/pre-commit`** (verbatim from gigsy)

```bash
cp "$GIGSY/.githooks/pre-commit" .githooks/pre-commit
chmod +x .githooks/pre-commit
sed -i 's|(webapp / worker — see|(webapp / worker / firmware — see|' .githooks/pre-commit
git config core.hooksPath .githooks
```

- [ ] **Step 9: Write `.github/workflows/version-check.yml`**

```yaml
name: Version bump check

# Fails the PR if any tier (webapp, worker, firmware, schema) was
# modified without a version bump. Sources:
#   webapp    webapp/package.json                ".version"
#   worker    backend/package.json               ".version"
#   firmware  firmware/src/application/Version.h kFirmwareVersion
#   schema    backend/migrations/                new numbered .sql file
# Doc-only PRs are exempt. Rules: scripts/version_rules.py.

on:
  pull_request:
    branches: [main]

jobs:
  check:
    name: Verify patch bump
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          # Full history so the script can `git show base_ref:path`.
          fetch-depth: 0
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - name: Version tooling unit tests
        run: python3 -m unittest discover -s scripts
      - name: Run version-bump check
        env:
          BASE_REF: ${{ github.base_ref }}
        run: python3 scripts/check_version_bump.py
```

- [ ] **Step 10: Commit**

```bash
git add scripts .githooks .github/workflows/version-check.yml
git commit -m "chore(versioning): four-tier auto-bump hook and CI gate"
```

---

## Task 4: Backend scaffold, D1 provisioning, first migration, health route

**Files:**
- Create: `backend/package.json`, `backend/tsconfig.json`, `backend/wrangler.toml`, `backend/vitest.config.ts`, `backend/drizzle.config.ts`, `backend/.dev.vars.example`
- Create: `backend/migrations/0000_init.sql`
- Create: `backend/src/env.ts`, `backend/src/index.ts`
- Create: `backend/test/env.d.ts`, `backend/test/helpers/migrate.ts`, `backend/test/health.test.ts`

- [ ] **Step 1: Write `backend/package.json`**

```json
{
  "name": "feedme2-backend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:generate": "drizzle-kit generate",
    "db:migrate:local": "wrangler d1 migrations apply feedme2-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply feedme2-db --remote"
  },
  "dependencies": {
    "@feedme2/shared": "workspace:*",
    "@hono/zod-validator": "^0.4.0",
    "drizzle-orm": "^0.36.0",
    "hono": "^4.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.5.0",
    "@cloudflare/workers-types": "^4.20250101.0",
    "drizzle-kit": "^0.28.0",
    "typescript": "^5.6.0",
    "vitest": "~2.1.0",
    "wrangler": "^4.0.0"
  }
}
```

- [ ] **Step 2: Write `backend/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*", "test/**/*", "drizzle.config.ts"]
}
```

- [ ] **Step 3: Provision D1 and R2 (one-time, needs `wrangler login` on this machine)**

This creates resources in the shared Cloudflare account, as the spec's Phase 0 requires.

```bash
cd backend && pnpm install && pnpm exec wrangler d1 create feedme2-db && pnpm exec wrangler r2 bucket create feedme2-firmware
```
Expected: `d1 create` prints a `[[d1_databases]]` block with a `database_id` UUID. Copy that UUID into Step 4. If `wrangler` reports not logged in, run `pnpm exec wrangler login` first (opens a browser; the session is the account whose workers.dev subdomain is `atsyg-feedme`, confirm with `pnpm exec wrangler whoami`).

- [ ] **Step 4: Write `backend/wrangler.toml`** (paste the real id)

```toml
name = "feedme2-api"
main = "src/index.ts"
compatibility_date = "2025-01-01"
compatibility_flags = ["nodejs_compat"]

# Provisioned once with:
#   wrangler d1 create feedme2-db
#   wrangler r2 bucket create feedme2-firmware

[[d1_databases]]
binding = "DB"
database_name = "feedme2-db"
database_id = "PASTE-THE-UUID-FROM-STEP-3"
migrations_dir = "migrations"

[[r2_buckets]]
binding = "FIRMWARE"
bucket_name = "feedme2-firmware"

# Hourly housekeeping (log retention, expired tokens) — the handler is
# a no-op until Phase 1 gives it something to prune.
[triggers]
crons = ["0 * * * *"]

[vars]
# What `wrangler deploy` ships. Local dev overrides via .dev.vars
# (gitignored — copy .dev.vars.example); tests pin their own value in
# vitest.config.ts miniflare bindings.
ENVIRONMENT = "production"
# Secrets — set via scripts/setup-secrets.local.ps1 -Cloudflare:
#   AUTH_SECRET   HS256 signing key (Phase 1)

[observability]
enabled = true
```

- [ ] **Step 5: Write `backend/.dev.vars.example`**

```ini
# Copy to .dev.vars (gitignored) — wrangler dev overlays these on
# wrangler.toml [vars] for LOCAL runs only.
ENVIRONMENT=development
AUTH_SECRET=local-dev-auth-secret-do-not-ship
```

- [ ] **Step 6: Write `backend/vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        // One runtime for the whole suite: isolated runtimes spawn a
        // workerd per test file and exhaust loopback connections on
        // Windows (gigsy hit ConnectEx #1225 at ~70 files).
        singleWorker: true,
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          compatibilityDate: "2025-01-01",
          compatibilityFlags: ["nodejs_compat"],
          bindings: {
            ENVIRONMENT: "development",
            AUTH_SECRET: "integration-test-secret",
          },
        },
      },
    },
  },
});
```

- [ ] **Step 7: Write `backend/drizzle.config.ts`** (schema file arrives in Phase 1; the config is here so `db:generate` is wired)

```ts
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  driver: "d1-http",
});
```

- [ ] **Step 8: Write `backend/migrations/0000_init.sql`**

```sql
-- 0000_init: the unified log table (spec §4.6, decision D10). Written
-- by the worker's D1 sink and the /api/logs + /api/device/logs routes
-- from Phase 1; created now so the schema tier has a version and CI's
-- migrate step has something to apply. house_id is nullable until
-- houses exist (Phase 1 adds the FK in its own migration).
CREATE TABLE log_entries (
  id         TEXT PRIMARY KEY,
  house_id   TEXT,
  source     TEXT    NOT NULL CHECK (source IN ('web', 'worker', 'device')),
  device_id  TEXT,
  client_id  TEXT,
  ts         INTEGER NOT NULL,
  level      TEXT    NOT NULL CHECK (level IN ('debug', 'info', 'warn', 'error')),
  msg        TEXT    NOT NULL,
  data       TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX log_entries_house_ts ON log_entries (house_id, ts DESC);
```

- [ ] **Step 9: Write `backend/src/env.ts`**

```ts
/**
 * Worker bindings + config. Secrets are set via `wrangler secret put`
 * (scripts/setup-secrets.ps1); vars live in wrangler.toml [vars].
 */
export type Bindings = {
  DB: D1Database;
  FIRMWARE: R2Bucket;
  ENVIRONMENT: string;
  AUTH_SECRET: string;
};
```

- [ ] **Step 10: Write `backend/test/env.d.ts`**

```ts
import type { Bindings } from "../src/env.ts";

declare module "cloudflare:test" {
  interface ProvidedEnv extends Bindings {}
}
```

- [ ] **Step 11: Write `backend/test/helpers/migrate.ts`**

```ts
/**
 * Apply every migration in backend/migrations/ to the test D1, and
 * record it in wrangler's own `d1_migrations` tracker the way
 * `wrangler d1 migrations apply` would — so /api/version reports a
 * schema version in tests exactly as it does in production.
 */
import { env } from "cloudflare:test";

// Vite's glob import with ?raw gives us every migration's SQL text,
// keyed by path, without a filesystem read inside the worker.
const files = import.meta.glob("../../migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export const MIGRATIONS: Array<{ name: string; sql: string }> = Object.entries(files)
  .map(([path, sql]) => ({ name: path.split("/").pop()!, sql }))
  .sort((a, b) => a.name.localeCompare(b.name));

/** The D1 runner strips `--` comments and splits on `;`. Mirror it. */
export function splitStatements(sql: string): string[] {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function applyAllMigrations(): Promise<void> {
  await env.DB.exec(
    "CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
  );
  for (const m of MIGRATIONS) {
    for (const stmt of splitStatements(m.sql)) await env.DB.exec(stmt);
    await env.DB.prepare("INSERT INTO d1_migrations (name) VALUES (?)").bind(m.name).run();
  }
}
```

- [ ] **Step 12: Write the failing health test `backend/test/health.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("answers with ok, the env, and a timestamp", async () => {
    const res = await SELF.fetch("http://feedme2/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string; ts: number };
    expect(body.ok).toBe(true);
    expect(body.env).toBe("development");
    expect(typeof body.ts).toBe("number");
  });
});
```

- [ ] **Step 13: Run it to verify it fails**

```bash
cd backend && pnpm test
```
Expected: FAIL — `src/index.ts` does not exist (wrangler cannot find `main`).

- [ ] **Step 14: Write `backend/src/index.ts`**

```ts
import { Hono } from "hono";
import type { Bindings } from "./env.ts";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));

export { app };

export default {
  fetch: app.fetch,
  // Hourly cron ([triggers] in wrangler.toml). Nothing to prune yet;
  // Phase 1 adds log retention and expired-token cleanup here.
  async scheduled(_event, _env, _ctx) {},
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 15: Run tests, typecheck, and a local migrate**

```bash
cd backend && pnpm test && pnpm typecheck && cp .dev.vars.example .dev.vars && pnpm db:migrate:local
```
Expected: 1 test PASS; tsc silent; migrate prints `0000_init.sql` applied (a `.wrangler/state` dir appears, gitignored).

- [ ] **Step 16: Commit**

```bash
git add backend pnpm-lock.yaml
git commit -m "feat(backend): worker scaffold, D1 binding, log_entries migration, health route"
```

---

## Task 5: Worker logger with console + ring-buffer sinks

**Files:**
- Create: `backend/src/logger.ts`, `backend/test/logger.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the failing test `backend/test/logger.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { RingBuffer } from "@feedme2/shared";
import type { LogEntry } from "@feedme2/shared";
import { BufferSink, Logger, type LogSink } from "../src/logger.ts";

describe("Logger", () => {
  it("stamps source=worker and the clock, and fans out to every sink", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buffer = new RingBuffer<LogEntry>(10);
    const log = new Logger([sink, new BufferSink(buffer)], () => 1234);

    log.info("hello", { a: 1 });
    log.error("boom");

    expect(seen).toEqual([
      { ts: 1234, level: "info", source: "worker", msg: "hello", data: { a: 1 } },
      { ts: 1234, level: "error", source: "worker", msg: "boom" },
    ]);
    expect(buffer.toArray()).toEqual(seen);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && pnpm test
```
Expected: FAIL, `Cannot find module '../src/logger.ts'`.

- [ ] **Step 3: Write `backend/src/logger.ts`**

```ts
/**
 * Structured logging with pluggable sinks. The app-wide singleton
 * writes JSON lines to the console (Workers Logs ingests them) AND to
 * a per-isolate ring buffer that /api/debug/logs exposes to the hidden
 * console. Phase 1 adds a D1 sink for persistence (spec D10); the
 * buffer stays as the zero-latency "what just happened" view.
 */
import { RingBuffer, type LogEntry, type LogLevel } from "@feedme2/shared";

export interface LogSink {
  write(entry: LogEntry): void;
}

export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    const line = JSON.stringify(entry);
    if (entry.level === "error") console.error(line);
    else if (entry.level === "warn") console.warn(line);
    else console.log(line);
  }
}

export class BufferSink implements LogSink {
  constructor(private readonly buffer: RingBuffer<LogEntry>) {}
  write(entry: LogEntry): void {
    this.buffer.push(entry);
  }
}

export class Logger {
  constructor(
    private readonly sinks: LogSink[],
    private readonly clock: () => number = Date.now,
  ) {}

  debug(msg: string, data?: Record<string, unknown>): void {
    this.write("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.write("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.write("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.write("error", msg, data);
  }

  private write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = {
      ts: this.clock(),
      level,
      source: "worker",
      msg,
      ...(data ? { data } : {}),
    };
    for (const sink of this.sinks) sink.write(entry);
  }
}

/** Recent lines for the debug console. Capacity is a tuning knob. */
export const logBuffer = new RingBuffer<LogEntry>(200);

/** App-wide logger: console + debug buffer. */
export const log = new Logger([new ConsoleSink(), new BufferSink(logBuffer)]);
```

- [ ] **Step 4: Add the request-log middleware to `backend/src/index.ts`**

Replace the file's contents with:

```ts
import { Hono } from "hono";
import type { Bindings } from "./env.ts";
import { log } from "./logger.ts";

const app = new Hono<{ Bindings: Bindings }>();

// One JSON line per request. Skip the health probe and /api/debug/*
// itself — the console polling for logs must not generate the logs it
// displays.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health" || path.startsWith("/api/debug")) return;
  log.info("request", {
    method: c.req.method,
    path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));

export { app };

export default {
  fetch: app.fetch,
  // Hourly cron ([triggers] in wrangler.toml). Nothing to prune yet;
  // Phase 1 adds log retention and expired-token cleanup here.
  async scheduled(_event, _env, _ctx) {},
} satisfies ExportedHandler<Bindings>;
```

- [ ] **Step 5: Run tests and typecheck**

```bash
cd backend && pnpm test && pnpm typecheck
```
Expected: 2 files PASS.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): structured logger with console and ring-buffer sinks"
```

---

## Task 6: `GET /api/version`

**Files:**
- Create: `backend/src/version.ts`, `backend/src/routes/version.ts`, `backend/test/version.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the failing test `backend/test/version.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { VersionResponseSchema } from "@feedme2/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { applyAllMigrations } from "./helpers/migrate.ts";
import pkg from "../package.json";

describe("GET /api/version", () => {
  beforeAll(applyAllMigrations);

  it("reports worker, schema and firmware tiers in the shared shape", async () => {
    const res = await SELF.fetch("http://feedme2/api/version");
    expect(res.status).toBe(200);
    const body = VersionResponseSchema.parse(await res.json());
    expect(body.worker).toEqual({ version: pkg.version, env: "development" });
    // The newest applied migration is the schema version.
    expect(body.schema.version).toBe("0000_init.sql");
    // No firmware_releases table yet (Phase 3).
    expect(body.firmware.latest).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && pnpm test
```
Expected: FAIL, `/api/version` returns 404.

- [ ] **Step 3: Write `backend/src/version.ts`**

```ts
/**
 * Tier versions (spec §6.1):
 * - worker: backend/package.json, auto-bumped by the pre-commit hook,
 *   inlined at build time via the JSON import.
 * - schema: the latest APPLIED migration, from wrangler's d1_migrations
 *   tracker at runtime — truthful even when the worker ships ahead of
 *   a migration, or a fresh local DB has none.
 * - firmware: newest active row of firmware_releases (Phase 3). Until
 *   that table exists the query fails and we report null.
 */
import pkg from "../package.json";

export const WORKER_VERSION: string = pkg.version;

export async function getSchemaVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT name FROM d1_migrations ORDER BY id DESC LIMIT 1")
      .first<{ name: string }>();
    return row?.name ?? null;
  } catch {
    return null;
  }
}

export async function getLatestFirmwareVersion(db: D1Database): Promise<string | null> {
  try {
    const row = await db
      .prepare("SELECT version FROM firmware_releases WHERE active = 1 ORDER BY created_at DESC LIMIT 1")
      .first<{ version: string }>();
    return row?.version ?? null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Write `backend/src/routes/version.ts`**

```ts
import { Hono } from "hono";
import type { VersionResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { WORKER_VERSION, getLatestFirmwareVersion, getSchemaVersion } from "../version.ts";

/** GET /api/version — public: versions must show pre-login. */
export const versionRouter = new Hono<{ Bindings: Bindings }>().get("/", async (c) => {
  const body: VersionResponse = {
    worker: { version: WORKER_VERSION, env: c.env.ENVIRONMENT },
    schema: { version: await getSchemaVersion(c.env.DB) },
    firmware: { latest: await getLatestFirmwareVersion(c.env.DB) },
  };
  return c.json(body);
});
```

- [ ] **Step 5: Mount it in `backend/src/index.ts`**

Add after the imports:
```ts
import { versionRouter } from "./routes/version.ts";
```
and after the health route:
```ts
app.route("/api/version", versionRouter);
```

- [ ] **Step 6: Run tests and typecheck**

```bash
cd backend && pnpm test && pnpm typecheck
```
Expected: 3 files PASS. If `pkg.version` import complains, confirm `resolveJsonModule` is on in tsconfig (it is in Task 4).

- [ ] **Step 7: Commit**

```bash
git add backend
git commit -m "feat(backend): /api/version reports worker, schema and firmware tiers"
```

---

## Task 7: `GET /api/debug/logs`

Unauthenticated in Phase 0 (there is no auth yet); Phase 1 puts `requireHouse()` in front of it. The ring buffer holds no house data, so nothing sensitive is exposed meanwhile.

**Files:**
- Create: `backend/src/routes/debug.ts`, `backend/test/debug.test.ts`
- Modify: `backend/src/index.ts`

- [ ] **Step 1: Write the failing test `backend/test/debug.test.ts`**

```ts
import { SELF } from "cloudflare:test";
import { LogEntrySchema } from "@feedme2/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const Body = z.object({ entries: z.array(LogEntrySchema) });

describe("GET /api/debug/logs", () => {
  it("returns recent worker log lines, oldest first, including the request log", async () => {
    await SELF.fetch("http://feedme2/api/version");
    const res = await SELF.fetch("http://feedme2/api/debug/logs?limit=50");
    expect(res.status).toBe(200);
    const { entries } = Body.parse(await res.json());
    const req = entries.filter((e) => e.msg === "request");
    expect(req.length).toBeGreaterThan(0);
    expect(req.at(-1)?.data).toMatchObject({ method: "GET", path: "/api/version", status: 200 });
    expect(entries.every((e) => e.source === "worker")).toBe(true);
  });

  it("clamps limit to 100 and defaults to 100", async () => {
    for (let i = 0; i < 120; i++) await SELF.fetch("http://feedme2/api/version");
    const res = await SELF.fetch("http://feedme2/api/debug/logs?limit=5000");
    const { entries } = Body.parse(await res.json());
    expect(entries.length).toBe(100);
  });

  it("does not log its own requests", async () => {
    await SELF.fetch("http://feedme2/api/debug/logs");
    const res = await SELF.fetch("http://feedme2/api/debug/logs");
    const { entries } = Body.parse(await res.json());
    expect(entries.some((e) => (e.data as { path?: string } | undefined)?.path?.startsWith("/api/debug"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd backend && pnpm test
```
Expected: FAIL, 404 on `/api/debug/logs`.

- [ ] **Step 3: Write `backend/src/routes/debug.ts`**

```ts
import { Hono } from "hono";
import type { Bindings } from "../env.ts";
import { logBuffer } from "../logger.ts";

const DEFAULT_LIMIT = 100;

/**
 * Debug endpoints for the webapp's hidden console.
 * GET /api/debug/logs?limit=N — recent worker log lines, oldest →
 * newest, from the per-isolate ring buffer (best-effort history; the
 * persisted D1 view arrives in Phase 1 along with house auth).
 */
export const debugRouter = new Hono<{ Bindings: Bindings }>().get("/logs", (c) => {
  const raw = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isInteger(raw) && raw > 0 ? Math.min(raw, DEFAULT_LIMIT) : DEFAULT_LIMIT;
  return c.json({ entries: logBuffer.toArray().slice(-limit) });
});
```

- [ ] **Step 4: Mount it in `backend/src/index.ts`**

```ts
import { debugRouter } from "./routes/debug.ts";
// …
app.route("/api/debug", debugRouter);
```

- [ ] **Step 5: Run tests and typecheck**

```bash
cd backend && pnpm test && pnpm typecheck
```
Expected: 4 files PASS.

- [ ] **Step 6: Commit**

```bash
git add backend
git commit -m "feat(backend): /api/debug/logs serves the worker ring buffer"
```

---

## Task 8: Webapp scaffold (Vite, Tailwind tokens, shadcn config, Pages functions, shell screen)

Everything here is gigsy's, renamed. The design tokens are copied verbatim (the feedme2 palette is Phase 1 design work; Phase 0 only needs a themed shell).

**Files:**
- Create: `webapp/package.json`, `webapp/vite.config.ts`, `webapp/vitest.config.ts`, `webapp/tsconfig.json`, `webapp/tsconfig.app.json`, `webapp/tsconfig.node.json`, `webapp/tsconfig.e2e.json`, `webapp/tailwind.config.ts`, `webapp/postcss.config.js`, `webapp/components.json`, `webapp/index.html`
- Create: `webapp/public/theme-boot.js`, `webapp/public/_redirects`, `webapp/public/icons/*` (generated), `webapp/scripts/generate-icons.mjs`
- Create: `webapp/functions/_middleware.ts`, `webapp/functions/api/[[path]].ts`
- Create: `webapp/src/styles.css`, `webapp/src/styles/tokens/*.css`, `webapp/src/lib/utils.ts`, `webapp/src/lib/theme.ts`, `webapp/src/lib/index-html.test.ts`
- Create: `webapp/src/main.tsx`, `webapp/src/App.tsx`, `webapp/src/components/Logo.tsx`, `webapp/src/screens/Shell.tsx`

- [ ] **Step 1: Write `webapp/package.json`**

```json
{
  "name": "feedme2-webapp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "test": "vitest run",
    "test:e2e": "playwright test --project=chromium",
    "test:e2e:ui": "playwright test --ui",
    "icons": "node scripts/generate-icons.mjs",
    "deploy": "wrangler pages deploy dist --project-name=feedme2-webapp --branch=main"
  },
  "dependencies": {
    "@feedme2/shared": "workspace:*",
    "@radix-ui/react-slot": "^1.3.3",
    "@tanstack/react-query": "^5.59.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",
    "tailwind-merge": "^3.6.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "@playwright/test": "^1.49.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.20",
    "jsdom": "^30.0.1",
    "postcss": "^8.4.49",
    "sharp": "^0.35.3",
    "tailwindcss": "^3.4.17",
    "tailwindcss-animate": "^1.0.7",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vite-plugin-pwa": "^0.21.0",
    "vitest": "~2.1.0",
    "workbox-core": "7.4.1",
    "workbox-precaching": "7.4.1",
    "workbox-routing": "7.4.1",
    "wrangler": "^4.0.0"
  }
}
```

(Dexie, driver.js, motion, react-day-picker and popover arrive with the features that need them in Phase 1. wrangler is ^4 here, unlike gigsy's ^3.90, so both packages share one major.)

- [ ] **Step 2: Copy the configs that are identical to gigsy's**

```bash
cp "$GIGSY/webapp/tsconfig.json" webapp/tsconfig.json
cp "$GIGSY/webapp/tsconfig.app.json" webapp/tsconfig.app.json
cp "$GIGSY/webapp/tsconfig.node.json" webapp/tsconfig.node.json
cp "$GIGSY/webapp/tsconfig.e2e.json" webapp/tsconfig.e2e.json
cp "$GIGSY/webapp/tailwind.config.ts" webapp/tailwind.config.ts
cp "$GIGSY/webapp/vitest.config.ts" webapp/vitest.config.ts
cp "$GIGSY/webapp/components.json" webapp/components.json
cp "$GIGSY/webapp/public/_redirects" webapp/public/_redirects
cp "$GIGSY/webapp/src/lib/utils.ts" webapp/src/lib/utils.ts
mkdir -p webapp/src/styles/tokens
cp "$GIGSY"/webapp/src/styles/tokens/*.css webapp/src/styles/tokens/
```

- [ ] **Step 3: Write `webapp/postcss.config.js`**

```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 4: Write `webapp/vite.config.ts`**

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

const pkg = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as {
  version: string;
};

/**
 * Emits /version.json = {"webapp": "<package.json version>"} into the
 * build. The running app polls it (src/lib/pwa-update-browser.ts) to
 * learn a newer build was deployed, because browsers only check for a
 * new service worker on navigation or roughly daily. Excluded from the
 * precache by the glob below — a precached version file would always
 * agree with the bundle that precached it.
 */
function versionJson(): Plugin {
  return {
    name: "feedme2-version-json",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "version.json",
        source: JSON.stringify({ webapp: pkg.version }),
      });
    },
  };
}

export default defineConfig({
  // `@/` mirrors tsconfig.app.json paths; shadcn components import
  // `@/lib/utils` verbatim, so the alias must exist in every resolver.
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  plugins: [
    react(),
    versionJson(),
    VitePWA({
      // "prompt": the app offers an update bar rather than reloading
      // under someone mid-entry.
      registerType: "prompt",
      // Registration lives in src/lib/pwa-update-browser.ts, which also
      // needs the registration object to poll for updates.
      injectRegister: null,
      // injectManifest: src/sw.ts is ours (push handlers later), so
      // precaching is our responsibility too — see sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"],
      },
      includeAssets: ["icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/favicon-16.png"],
      manifest: {
        name: "feedme2",
        short_name: "feedme2",
        description: "Household cat-feeding tracker",
        // Must match index.html's <meta name="theme-color">.
        theme_color: "#f8fafc",
        background_color: "#f8fafc",
        display: "standalone",
        start_url: "/",
        scope: "/",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  // `vite preview` serves the build WITH the real service worker — the
  // only way to exercise offline reopen locally.
  preview: {
    proxy: { "/api": { target: process.env["VITE_WORKER_ORIGIN"] ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
  server: {
    proxy: { "/api": { target: process.env["VITE_WORKER_ORIGIN"] ?? "http://127.0.0.1:8787", changeOrigin: true } },
  },
});
```

- [ ] **Step 5: Write `webapp/index.html`**

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/icons/favicon-16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/icons/apple-touch-icon.png" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="default" />
    <meta name="apple-mobile-web-app-title" content="feedme2" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#f8fafc" />
    <!--
      A FILE, not an inline script: production's CSP
      (functions/_middleware.ts) is `script-src 'self'` with no inline
      allowance. src/lib/index-html.test.ts keeps it that way.
    -->
    <script src="/theme-boot.js"></script>
    <title>feedme2</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 6: Theme boot script and theme module (gigsy's, renamed key)**

```bash
cp "$GIGSY/webapp/public/theme-boot.js" webapp/public/theme-boot.js
cp "$GIGSY/webapp/src/lib/theme.ts" webapp/src/lib/theme.ts
sed -i 's/gigsy:theme/feedme2:theme/g' webapp/public/theme-boot.js webapp/src/lib/theme.ts
grep -n "feedme2:theme" webapp/public/theme-boot.js webapp/src/lib/theme.ts
```
Expected: one hit in each file.

- [ ] **Step 7: Write `webapp/src/styles.css`**

```css
/* Design tokens — copied from gigsy's design system. The feedme2
 * palette replaces the emerald accent in Phase 1; the structure (R G B
 * triplets, data-theme on <html>, no `dark:` utilities) stays. */
@import "./styles/tokens/colors.css";
@import "./styles/tokens/typography.css";
@import "./styles/tokens/spacing.css";
@import "./styles/tokens/radius.css";
@import "./styles/tokens/elevation.css";
@import "./styles/tokens/motion.css";
@import "./styles/tokens/semantic.css";
@import "./styles/tokens/shadcn.css";

@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  /* Paint the root from the token so nothing white shows between first
     paint and React mounting on the installed PWA. */
  html {
    background-color: rgb(var(--c-slate-50));
  }
}
```

- [ ] **Step 8: Pages Functions**

```bash
mkdir -p webapp/functions/api
cp "$GIGSY/webapp/functions/_middleware.ts" webapp/functions/_middleware.ts
```

Then in `webapp/functions/_middleware.ts` replace the `CSP` array with (no Google hosts; feedme2 has no third-party scripts):

```ts
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "font-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");
```
and the Permissions-Policy line with:
```ts
  headers.set("Permissions-Policy", "camera=(self), microphone=(), geolocation=()");
```
(camera stays: the QR login lands via the phone's camera app, but a future in-app scanner would need it.)

Write `webapp/functions/api/[[path]].ts`:

```ts
// Cloudflare Pages Function: transparent proxy /api/* → the Worker.
// Keeps the SPA single-origin (no CORS preflight) and lets the Worker
// live on its own *.workers.dev domain. Override per environment with
// the WORKER_ORIGIN Pages env var.

const DEFAULT_WORKER_ORIGIN = "https://feedme2-api.atsyg-feedme.workers.dev";

interface Env {
  WORKER_ORIGIN?: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const origin = (env.WORKER_ORIGIN ?? DEFAULT_WORKER_ORIGIN).replace(/\/+$/, "");
  const incoming = new URL(request.url);
  const upstream = origin + incoming.pathname + incoming.search;

  const init: RequestInit = {
    method: request.method,
    headers: request.headers,
    body: ["GET", "HEAD"].includes(request.method) ? undefined : request.body,
    // @ts-expect-error duplex is a valid fetch init key in workerd.
    duplex: "half",
    redirect: "manual",
  };

  return fetch(upstream, init);
};
```

- [ ] **Step 9: Icons**

```bash
cp "$GIGSY/webapp/scripts/generate-icons.mjs" webapp/scripts/generate-icons.mjs
```
Replace the `markSvg` function so the mark is a cat silhouette placeholder (a filled circle head with two triangle ears, white on emerald) rather than gigsy's "G":

```js
function markSvg(size, { rounded, safe }) {
  const rx = rounded ? Math.round(size * 0.15) : 0;
  const scale = safe ? 0.8 : 1;
  const c = size / 2;
  const r = size * 0.24 * scale;          // head
  const ear = size * 0.16 * scale;        // ear height
  const earHalf = size * 0.11 * scale;    // ear half-width
  const headTop = c - r * 0.55;
  const leftEar = `${c - r * 0.75},${headTop} ${c - r * 0.75 - earHalf * 0.4},${headTop - ear} ${c - r * 0.75 + earHalf},${headTop + earHalf * 0.5}`;
  const rightEar = `${c + r * 0.75},${headTop} ${c + r * 0.75 + earHalf * 0.4},${headTop - ear} ${c + r * 0.75 - earHalf},${headTop + earHalf * 0.5}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" rx="${rx}" fill="${EMERALD}"/>
  <polygon points="${leftEar}" fill="#ffffff"/>
  <polygon points="${rightEar}" fill="#ffffff"/>
  <circle cx="${c}" cy="${c + r * 0.15}" r="${r}" fill="#ffffff"/>
</svg>`;
}
```
Then generate and check:
```bash
cd webapp && pnpm install && pnpm icons && ls public/icons
```
Expected: `apple-touch-icon.png favicon-16.png favicon-32.png icon-192-maskable.png icon-192.png icon-512-maskable.png icon-512.png`.

- [ ] **Step 10: Write the failing CSP/inline-script test** — copy gigsy's; it reads `index.html` and `_middleware.ts` as text.

```bash
cp "$GIGSY/webapp/src/lib/index-html.test.ts" webapp/src/lib/index-html.test.ts
```
No edits needed: it asserts `<script src="/theme-boot.js">`, no inline scripts, `script-src 'self'` without `unsafe-inline`, and the `#f8fafc` theme-color — all true of the files above.

- [ ] **Step 11: Write `webapp/src/components/Logo.tsx`**

```tsx
/**
 * The wordmark. It is a <h1> so tests can find it by role, and the
 * hidden console's triple-tap target — the handler is injected so the
 * component knows nothing about the console.
 */
interface Props {
  onTap?: () => void;
}

export function Logo({ onTap }: Props) {
  return (
    <h1
      data-testid="app-logo"
      onClick={onTap}
      className="select-none text-xl font-bold tracking-tight text-slate-900"
    >
      feedme2
    </h1>
  );
}
```

- [ ] **Step 12: Write `webapp/src/screens/Shell.tsx`**

```tsx
import { Logo } from "../components/Logo.tsx";
import { useConsole } from "../components/ConsoleProvider.tsx";
import { CLIENT_VERSION } from "../lib/versions.ts";

/** Phase 0 placeholder for the dashboard. Proves the shell, theme,
 * PWA and console plumbing end to end; Phase 1 replaces the body. */
export function Shell() {
  const { tapLogo } = useConsole();
  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col px-4 py-6" data-testid="shell">
      <header className="flex items-center justify-between">
        <Logo onTap={tapLogo} />
        <span className="font-mono text-xs text-slate-500" data-testid="shell-version">
          v{CLIENT_VERSION}
        </span>
      </header>
      <main className="mt-8 rounded-xl border border-slate-200 bg-white p-6 text-slate-700">
        <p>Coming in Phase 1: your cats, and a Feed button.</p>
      </main>
    </div>
  );
}
```

(`ConsoleProvider` and `versions.ts` are written in Tasks 9–10; the build is first verified at the end of Task 10.)

- [ ] **Step 13: Write `webapp/src/App.tsx`**

```tsx
import { Route, Routes } from "react-router-dom";
import { ConsoleProvider } from "./components/ConsoleProvider.tsx";
import { UpdateBar } from "./components/UpdateBar.tsx";
import { Shell } from "./screens/Shell.tsx";

export function App() {
  return (
    <ConsoleProvider>
      {/* Above the routes: a stale bundle is stale on every screen. */}
      <UpdateBar />
      <Routes>
        <Route path="*" element={<Shell />} />
      </Routes>
    </ConsoleProvider>
  );
}
```

- [ ] **Step 14: Write `webapp/src/main.tsx`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App } from "./App.tsx";
import { appLog, installGlobalErrorCapture } from "./lib/logger.ts";
import { CLIENT_VERSION } from "./lib/versions.ts";
import { startUpdateWatch } from "./lib/pwa-update-browser.ts";
import { bootTheme, followSystemTheme } from "./lib/theme.ts";
import "./styles.css";

// Uncaught errors go to the hidden console's client feed — on a phone
// there are no devtools.
installGlobalErrorCapture(appLog, window);
appLog.info("app started", { version: CLIENT_VERSION });

// public/theme-boot.js already applied the theme before first paint;
// this is the in-bundle fallback plus the OS follower for "system".
bootTheme(window, document);
followSystemTheme(window, document);

startUpdateWatch();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, networkMode: "always" },
    mutations: { networkMode: "always" },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
```

- [ ] **Step 15: Commit the scaffold** (the build is verified after Tasks 9–11 fill in the imports)

```bash
git add webapp pnpm-lock.yaml
git commit -m "feat(webapp): vite + tailwind + pwa scaffold, pages proxy, shell screen"
```

---

## Task 9: Client logger and tier versions

**Files:**
- Create: `webapp/src/lib/logger.ts`, `webapp/src/lib/logger.test.ts`
- Create: `webapp/src/lib/versions.ts`, `webapp/src/lib/versions.test.ts`

- [ ] **Step 1: Write the failing test `webapp/src/lib/logger.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { RingBuffer, type LogEntry } from "@feedme2/shared";
import { BufferSink, Logger, installGlobalErrorCapture, type LogSink } from "./logger.ts";

describe("client Logger", () => {
  it("stamps source=web and fans out", () => {
    const seen: LogEntry[] = [];
    const sink: LogSink = { write: (e) => void seen.push(e) };
    const buf = new RingBuffer<LogEntry>(5);
    const log = new Logger([sink, new BufferSink(buf)], () => 7);
    log.warn("slow", { ms: 900 });
    expect(seen).toEqual([{ ts: 7, level: "warn", source: "web", msg: "slow", data: { ms: 900 } }]);
    expect(buf.toArray()).toEqual(seen);
  });

  it("captures uncaught errors and unhandled rejections until uninstalled", () => {
    const seen: LogEntry[] = [];
    const log = new Logger([{ write: (e) => void seen.push(e) }], () => 0);
    const target = new EventTarget();
    const uninstall = installGlobalErrorCapture(log, target);

    target.dispatchEvent(Object.assign(new Event("error"), { message: "kaboom" }));
    target.dispatchEvent(Object.assign(new Event("unhandledrejection"), { reason: new Error("nope") }));
    expect(seen.map((e) => e.msg)).toEqual(["Uncaught error: kaboom", "Unhandled rejection: nope"]);

    uninstall();
    target.dispatchEvent(Object.assign(new Event("error"), { message: "after" }));
    expect(seen).toHaveLength(2);
    vi.restoreAllMocks();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd webapp && pnpm test
```
Expected: FAIL, `Cannot find module './logger.ts'` (the index-html test from Task 8 passes).

- [ ] **Step 3: Write `webapp/src/lib/logger.ts`**

```ts
/**
 * Client-side structured logging — same entry shape as the worker's
 * (shared LogEntry) so the hidden console renders both feeds in one
 * list. The singleton writes to the devtools console AND to a ring
 * buffer the console displays; Phase 1 adds the upload sink.
 */
import { RingBuffer, type LogEntry, type LogLevel } from "@feedme2/shared";

export interface LogSink {
  write(entry: LogEntry): void;
}

export class ConsoleSink implements LogSink {
  write(entry: LogEntry): void {
    const args = entry.data ? [entry.msg, entry.data] : [entry.msg];
    if (entry.level === "error") console.error(...args);
    else if (entry.level === "warn") console.warn(...args);
    else console.info(...args);
  }
}

export class BufferSink implements LogSink {
  constructor(private readonly buffer: RingBuffer<LogEntry>) {}
  write(entry: LogEntry): void {
    this.buffer.push(entry);
  }
}

export class Logger {
  constructor(
    private readonly sinks: LogSink[],
    private readonly clock: () => number = Date.now,
  ) {}

  debug(msg: string, data?: Record<string, unknown>): void {
    this.write("debug", msg, data);
  }
  info(msg: string, data?: Record<string, unknown>): void {
    this.write("info", msg, data);
  }
  warn(msg: string, data?: Record<string, unknown>): void {
    this.write("warn", msg, data);
  }
  error(msg: string, data?: Record<string, unknown>): void {
    this.write("error", msg, data);
  }

  private write(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    const entry: LogEntry = { ts: this.clock(), level, source: "web", msg, ...(data ? { data } : {}) };
    for (const sink of this.sinks) sink.write(entry);
  }
}

/**
 * Route uncaught errors + unhandled rejections into the logger so the
 * hidden console shows crashes nobody would otherwise see on a phone.
 * Returns an uninstall function.
 */
export function installGlobalErrorCapture(logger: Logger, target: EventTarget): () => void {
  const onError = (event: Event): void => {
    const message = (event as ErrorEvent).message ?? "Unknown error";
    logger.error(`Uncaught error: ${message}`);
  };
  const onRejection = (event: Event): void => {
    const reason = (event as PromiseRejectionEvent).reason;
    const message = reason instanceof Error ? reason.message : String(reason);
    logger.error(`Unhandled rejection: ${message}`);
  };
  target.addEventListener("error", onError);
  target.addEventListener("unhandledrejection", onRejection);
  return () => {
    target.removeEventListener("error", onError);
    target.removeEventListener("unhandledrejection", onRejection);
  };
}

export const clientLogBuffer = new RingBuffer<LogEntry>(200);
export const appLog = new Logger([new ConsoleSink(), new BufferSink(clientLogBuffer)]);
```

- [ ] **Step 4: Write the failing test `webapp/src/lib/versions.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { CLIENT_VERSION, fetchTierVersions } from "./versions.ts";
import pkg from "../../package.json";

const okFetch = (body: unknown): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as typeof fetch;

describe("versions", () => {
  it("CLIENT_VERSION is the package version", () => {
    expect(CLIENT_VERSION).toBe(pkg.version);
  });

  it("maps /api/version into tier versions", async () => {
    const v = await fetchTierVersions(
      okFetch({
        worker: { version: "0.1.4", env: "production" },
        schema: { version: "0000_init.sql" },
        firmware: { latest: "0.1.0" },
      }),
    );
    expect(v).toEqual({ client: pkg.version, worker: "0.1.4", schema: "0000_init.sql", firmware: "0.1.0", env: "production" });
  });

  it("degrades to nulls when the worker is unreachable or returns junk", async () => {
    const failing = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchTierVersions(failing)).toEqual({ client: pkg.version, worker: null, schema: null, firmware: null, env: null });
    expect(await fetchTierVersions(okFetch({ nope: 1 }))).toMatchObject({ worker: null });
  });
});
```

- [ ] **Step 5: Write `webapp/src/lib/versions.ts`**

```ts
/**
 * Tier versions for the hidden console. The client version is inlined
 * at build time from package.json (auto-bumped by the pre-commit
 * hook); the others come from GET /api/version and degrade to null
 * offline — the console must render without a network.
 */
import { VersionResponseSchema } from "@feedme2/shared";
import pkg from "../../package.json";

export const CLIENT_VERSION: string = pkg.version;

export interface TierVersions {
  client: string;
  worker: string | null;
  schema: string | null;
  firmware: string | null;
  env: string | null;
}

const OFFLINE: Omit<TierVersions, "client"> = { worker: null, schema: null, firmware: null, env: null };

export async function fetchTierVersions(fetchFn: typeof fetch = fetch): Promise<TierVersions> {
  try {
    const res = await fetchFn("/api/version");
    if (!res.ok) return { client: CLIENT_VERSION, ...OFFLINE };
    const parsed = VersionResponseSchema.safeParse(await res.json());
    if (!parsed.success) return { client: CLIENT_VERSION, ...OFFLINE };
    const b = parsed.data;
    return {
      client: CLIENT_VERSION,
      worker: b.worker.version,
      schema: b.schema.version,
      firmware: b.firmware.latest,
      env: b.worker.env,
    };
  } catch {
    return { client: CLIENT_VERSION, ...OFFLINE };
  }
}
```

- [ ] **Step 6: Run tests**

```bash
cd webapp && pnpm test
```
Expected: 3 files PASS.

- [ ] **Step 7: Commit**

```bash
git add webapp
git commit -m "feat(webapp): client logger with error capture, tier version fetch"
```

---

## Task 10: Hidden console (triple-tap the logo)

**Files:**
- Create: `webapp/src/lib/multi-tap.ts`, `webapp/src/lib/multi-tap.test.ts`
- Create: `webapp/src/components/LogList.tsx`, `webapp/src/components/HiddenConsole.tsx`, `webapp/src/components/ConsoleProvider.tsx`

- [ ] **Step 1: Copy gigsy's multi-tap detector and its test, verbatim**

```bash
cp "$GIGSY/webapp/src/lib/multi-tap.ts" webapp/src/lib/multi-tap.ts
cp "$GIGSY/webapp/src/lib/multi-tap.test.ts" webapp/src/lib/multi-tap.test.ts
cd webapp && pnpm test
```
Expected: 4 files PASS (the detector is pure logic: `createMultiTapDetector({taps, windowMs, onTrigger, clock})` returning `{tap(), reset()}`).

- [ ] **Step 2: Write `webapp/src/components/LogList.tsx`**

```tsx
import type { LogEntry } from "@feedme2/shared";

const LEVEL_STYLES: Record<LogEntry["level"], string> = {
  debug: "text-slate-400",
  info: "text-slate-500",
  warn: "text-amber-700",
  error: "text-red-600",
};

interface Props {
  entries: LogEntry[];
  emptyMessage: string;
}

/** One renderer for every feed: the shared LogEntry shape is the point. */
export function LogList({ entries, emptyMessage }: Props) {
  if (entries.length === 0) {
    return <p className="text-xs text-slate-500">{emptyMessage}</p>;
  }
  return (
    <ul className="space-y-1 font-mono text-xs">
      {entries.map((entry, i) => (
        <li key={`${entry.ts}-${i}`} className="flex gap-2">
          <span className="shrink-0 text-slate-400">{new Date(entry.ts).toLocaleTimeString()}</span>
          <span className="shrink-0 text-slate-400">{entry.source}</span>
          <span className={`shrink-0 uppercase ${LEVEL_STYLES[entry.level]}`}>{entry.level}</span>
          <span className="break-all text-slate-700">
            {entry.msg}
            {entry.data ? ` ${JSON.stringify(entry.data)}` : null}
          </span>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Write `webapp/src/components/HiddenConsole.tsx`**

```tsx
import { useCallback, useEffect, useState } from "react";
import type { LogEntry } from "@feedme2/shared";
import { clientLogBuffer } from "../lib/logger.ts";
import { fetchTierVersions, type TierVersions } from "../lib/versions.ts";
import { LogList } from "./LogList.tsx";

/** Data access is injected so the component stays presentational. */
export interface ConsoleDataSource {
  getVersions(): Promise<TierVersions>;
  /** null = worker unreachable (vs [] = reachable but empty). */
  getWorkerLogs(limit: number): Promise<LogEntry[] | null>;
  getClientLogs(): LogEntry[];
}

export function makeConsoleDataSource(fetchFn: typeof fetch = fetch): ConsoleDataSource {
  return {
    getVersions: () => fetchTierVersions(fetchFn),
    getWorkerLogs: async (limit) => {
      try {
        const res = await fetchFn(`/api/debug/logs?limit=${limit}`);
        if (!res.ok) return null;
        return ((await res.json()) as { entries: LogEntry[] }).entries;
      } catch {
        return null;
      }
    },
    getClientLogs: () => clientLogBuffer.toArray(),
  };
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">{title}</h3>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function VersionRow({ tier, value, testId }: { tier: string; value: string; testId: string }) {
  return (
    <div className="flex justify-between font-mono text-xs">
      <span className="text-slate-500">{tier}</span>
      <span data-testid={testId} className="text-slate-800">
        {value}
      </span>
    </div>
  );
}

interface Props {
  onClose: () => void;
  dataSource: ConsoleDataSource;
}

const WORKER_LOG_LIMIT = 100;

/** The hidden debug console — opened by 3 taps on the logo. Every
 * remote value degrades to an explicit marker so it works offline. */
export function HiddenConsole({ onClose, dataSource }: Props) {
  const [versions, setVersions] = useState<TierVersions | null>(null);
  const [workerLogs, setWorkerLogs] = useState<LogEntry[] | null>(null);
  const [clientLogs, setClientLogs] = useState<LogEntry[]>([]);

  const refresh = useCallback(async () => {
    setClientLogs(dataSource.getClientLogs());
    setVersions(await dataSource.getVersions());
    setWorkerLogs(await dataSource.getWorkerLogs(WORKER_LOG_LIMIT));
  }, [dataSource]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const unreachable = versions?.worker === null;

  return (
    <div
      data-testid="hidden-console"
      className="fixed inset-x-0 bottom-0 z-50 max-h-[75dvh] overflow-y-auto rounded-t-2xl border-t border-slate-300 bg-white p-4 shadow-2xl pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-bold text-slate-800">Debug console</h2>
        <div className="flex gap-2">
          <button type="button" onClick={() => void refresh()} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
            Refresh
          </button>
          <button type="button" data-testid="console-close" onClick={onClose} className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-600">
            Close
          </button>
        </div>
      </div>

      <Section title="Versions">
        {versions === null ? (
          <p className="text-xs text-slate-500">Loading…</p>
        ) : (
          <div className="space-y-0.5">
            <VersionRow tier="webapp" value={versions.client} testId="version-client" />
            <VersionRow tier="worker" value={versions.worker ?? "unreachable"} testId="version-worker" />
            <VersionRow tier="schema" value={versions.schema ?? (unreachable ? "unreachable" : "none applied")} testId="version-schema" />
            <VersionRow tier="firmware" value={versions.firmware ?? (unreachable ? "unreachable" : "no release")} testId="version-firmware" />
            <VersionRow tier="env" value={versions.env ?? "—"} testId="version-env" />
          </div>
        )}
      </Section>

      <Section title="Client logs">
        <div data-testid="client-logs">
          <LogList entries={clientLogs} emptyMessage="No client logs yet." />
        </div>
      </Section>

      <Section title="Worker logs">
        <div data-testid="worker-logs">
          {workerLogs === null ? (
            <p className="text-xs text-slate-500">Worker unreachable.</p>
          ) : (
            <LogList entries={workerLogs} emptyMessage="No worker logs yet." />
          )}
        </div>
      </Section>
    </div>
  );
}
```

- [ ] **Step 4: Write `webapp/src/components/ConsoleProvider.tsx`**

```tsx
import { createContext, useContext, useMemo, useState } from "react";
import { createMultiTapDetector } from "../lib/multi-tap.ts";
import { HiddenConsole, makeConsoleDataSource } from "./HiddenConsole.tsx";

interface ConsoleApi {
  /** Wire to the logo's onClick: the third rapid tap opens the console. */
  tapLogo: () => void;
  open: () => void;
  close: () => void;
}

const ConsoleContext = createContext<ConsoleApi | null>(null);

export function ConsoleProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const api = useMemo<ConsoleApi>(() => {
    const detector = createMultiTapDetector({ onTrigger: () => setOpen(true) });
    return { tapLogo: () => detector.tap(), open: () => setOpen(true), close: () => setOpen(false) };
  }, []);
  const dataSource = useMemo(() => makeConsoleDataSource(), []);

  return (
    <ConsoleContext.Provider value={api}>
      {children}
      {isOpen ? <HiddenConsole onClose={api.close} dataSource={dataSource} /> : null}
    </ConsoleContext.Provider>
  );
}

export function useConsole(): ConsoleApi {
  const ctx = useContext(ConsoleContext);
  if (ctx === null) throw new Error("useConsole must be used inside <ConsoleProvider>");
  return ctx;
}
```

- [ ] **Step 5: Typecheck** (the build still needs Task 11's UpdateBar; typecheck will name exactly those missing modules)

```bash
cd webapp && pnpm typecheck 2>&1 | grep -v "pwa-update\|UpdateBar" ; echo "---"; pnpm test
```
Expected: the only errors mention `UpdateBar.tsx` / `pwa-update-browser.ts` (written next); tests PASS.

- [ ] **Step 6: Commit**

```bash
git add webapp
git commit -m "feat(webapp): hidden console with tier versions and log feeds"
```

---

## Task 11: PWA service worker and update bar

**Files:**
- Create: `webapp/src/sw.ts`
- Create: `webapp/src/lib/pwa-update.ts`, `webapp/src/lib/pwa-update.test.ts`
- Create: `webapp/src/lib/pwa-update-browser.ts`
- Create: `webapp/src/components/UpdateBar.tsx`

- [ ] **Step 1: Write `webapp/src/sw.ts`** (gigsy's minus push handlers)

```ts
/// <reference lib="webworker" />
/**
 * The service worker. Hand-written (injectManifest) so it can host
 * custom handlers later; the cost is that precaching is our job —
 * `precacheAndRoute` below is what keeps the installed app opening
 * with no connectivity. Treat it as load-bearing.
 */
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { clientsClaim } from "workbox-core";

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<{ url: string; revision: string | null }>;
};

// A new worker waits until the page asks (via the update bar). Taking
// over at install would serve a new precache to a page still running
// the old bundle, which 404s on lazy chunks the new build dropped.
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | undefined)?.type === "SKIP_WAITING") {
    void self.skipWaiting();
  }
});

clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Client-routed URLs are not precached assets; without this fallback
// every route but "/" 404s offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html")));
```

- [ ] **Step 2: Write the failing test `webapp/src/lib/pwa-update.test.ts`**

```ts
import { describe, expect, it, vi } from "vitest";
import { createUpdateStore, isNewerBuildServed } from "./pwa-update.ts";

function make() {
  const deps = { skipWaiting: vi.fn(), reload: vi.fn() };
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
```

- [ ] **Step 3: Run it to verify it fails**

```bash
cd webapp && pnpm test
```
Expected: FAIL, `Cannot find module './pwa-update.ts'`.

- [ ] **Step 4: Write `webapp/src/lib/pwa-update.ts`**

```ts
/**
 * Whether a newer build is waiting, and what to do about it.
 *
 * The app is a PWA people leave open. The browser looks for a new
 * sw.js on navigation or roughly daily, and even then the running page
 * keeps its old bundle until a reload. Decisions live here, DOM-free
 * and unit-tested; pwa-update-browser.ts is the glue.
 */
import { compareVersions } from "@feedme2/shared";

/** `dismissed` is "not now"; a newer build clears it. */
export type UpdateState = "idle" | "ready" | "dismissed";

export interface UpdateStoreDeps {
  skipWaiting: () => void;
  reload: () => void;
}

export interface UpdateStore {
  subscribe(listener: () => void): () => void;
  getSnapshot(): UpdateState;
  /** A new worker is installed and waiting. */
  markReady(): void;
  dismiss(): void;
  apply(): void;
  /** The active worker changed. */
  onControllerChange(): void;
}

export function createUpdateStore(deps: UpdateStoreDeps): UpdateStore {
  let state: UpdateState = "idle";
  let applying = false;
  let reloaded = false;
  const listeners = new Set<() => void>();

  function set(next: UpdateState): void {
    if (next === state) return;
    state = next;
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => state,
    markReady: () => set("ready"),
    dismiss: () => set("dismissed"),
    apply() {
      if (state !== "ready" || applying) return;
      applying = true;
      deps.skipWaiting();
    },
    onControllerChange() {
      // Fires on the very first install too, and in every open tab
      // when any one of them applies — reload only the tab that asked.
      if (!applying || reloaded) return;
      reloaded = true;
      deps.reload();
    },
  };
}

/**
 * /version.json (emitted at build, never precached) says which webapp
 * version the server currently serves. Strictly newer than the running
 * bundle means "ask the service worker to look for an update now",
 * for browsers that would otherwise not check for a day (spec §4.5).
 */
export function isNewerBuildServed(served: string | null | undefined, running: string): boolean {
  if (typeof served !== "string" || served.length === 0) return false;
  return compareVersions(served, running) > 0;
}

/** Poll cadence for /version.json while the tab is visible. */
export const VERSION_POLL_MS = 10 * 60 * 1000;
```

- [ ] **Step 5: Write `webapp/src/lib/pwa-update-browser.ts`**

```ts
/**
 * The browser half of self-update: registration, update checks, and
 * the events that drive the store. Deliberately logic-free — every
 * decision lives in pwa-update.ts.
 */
import { createUpdateStore, isNewerBuildServed, VERSION_POLL_MS, type UpdateStore } from "./pwa-update.ts";
import { appLog } from "./logger.ts";
import { CLIENT_VERSION } from "./versions.ts";

let waiting: ServiceWorker | null = null;
let registration: ServiceWorkerRegistration | null = null;

export const updateStore: UpdateStore = createUpdateStore({
  skipWaiting: () => waiting?.postMessage({ type: "SKIP_WAITING" }),
  reload: () => window.location.reload(),
});

/** Installed while another worker controls the page = an update. The
 * same state with no controller is the first install: not news. */
function offerIfUpdate(worker: ServiceWorker | null): void {
  if (worker === null || navigator.serviceWorker.controller === null) return;
  waiting = worker;
  updateStore.markReady();
}

async function servedVersion(): Promise<string | null> {
  try {
    const res = await fetch(`/version.json?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    return ((await res.json()) as { webapp?: string }).webapp ?? null;
  } catch {
    return null;
  }
}

async function checkNow(): Promise<void> {
  if (registration === null) return;
  if (isNewerBuildServed(await servedVersion(), CLIENT_VERSION)) {
    appLog.info("newer build served, checking service worker");
  }
  // Cheap and idempotent; run it on every visibility change regardless,
  // the version poll only adds the log line above.
  void registration.update();
}

/** Start listening. A no-op where service workers are unavailable. */
export function startUpdateWatch(): void {
  if (!("serviceWorker" in navigator)) return;

  navigator.serviceWorker.addEventListener("controllerchange", () => updateStore.onControllerChange());

  void navigator.serviceWorker
    .register("/sw.js", { scope: "/" })
    .then((reg) => {
      registration = reg;
      offerIfUpdate(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const installing = reg.installing;
        if (installing === null) return;
        installing.addEventListener("statechange", () => {
          if (installing.state === "installed") offerIfUpdate(installing);
        });
      });
    })
    .catch((error: unknown) => {
      appLog.warn("service worker registration failed", { error: String(error) });
    });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void checkNow();
  });
  window.setInterval(() => {
    if (document.visibilityState === "visible") void checkNow();
  }, VERSION_POLL_MS);
}
```

- [ ] **Step 6: Write `webapp/src/components/UpdateBar.tsx`** (gigsy's, unchanged apart from the comment)

```tsx
/**
 * "A new version is ready." Shown rather than acted on: reloading
 * under someone loses what they were entering. Dismiss means "not
 * now" — a newer build asks again. Rendered at the app root.
 */
import { useSyncExternalStore } from "react";
import { updateStore } from "../lib/pwa-update-browser.ts";

export function UpdateBar() {
  const state = useSyncExternalStore(
    (listener) => updateStore.subscribe(listener),
    () => updateStore.getSnapshot(),
    () => "idle" as const,
  );

  if (state !== "ready") return null;

  return (
    <div
      role="status"
      data-testid="update-bar"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex max-w-lg items-center gap-3">
        <p className="min-w-0 flex-1 text-sm text-slate-700">A new version is ready.</p>
        <button
          type="button"
          data-testid="update-bar-reload"
          onClick={() => updateStore.apply()}
          className="shrink-0 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update"
          data-testid="update-bar-dismiss"
          onClick={() => updateStore.dismiss()}
          className="shrink-0 rounded-xl px-2 py-2 text-sm text-slate-500 transition-colors hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Full webapp verification: tests, typecheck, build, and a dev run against the local worker**

```bash
cd webapp && pnpm test && pnpm typecheck && pnpm build && ls dist/version.json dist/sw.js dist/manifest.webmanifest
```
Expected: 5 test files PASS; tsc silent; build succeeds; the three files exist. Then, in two terminals:

```bash
pnpm --filter feedme2-backend dev
```
```bash
pnpm --filter feedme2-webapp dev
```
Open http://localhost:5173, tap the wordmark three times: the console shows `webapp 0.1.x`, `worker 0.1.x`, `schema 0000_init.sql`, `firmware no release`, `env development`, a client log line `app started`, and worker `request` lines.

- [ ] **Step 8: Commit**

```bash
git add webapp
git commit -m "feat(webapp): service worker, update bar, served-version poll"
```

---

## Task 12: Playwright e2e for the shell, console and update bar

**Files:**
- Create: `webapp/playwright.config.ts`, `webapp/e2e/smoke.spec.ts`, `webapp/e2e/hidden-console.spec.ts`

- [ ] **Step 1: Write `webapp/playwright.config.ts`**

```ts
import { defineConfig, devices } from "@playwright/test";

// Defaults to production; override with E2E_BASE_URL=http://localhost:5173
// (with `pnpm dev` running). CI points this at the per-PR Pages preview
// and at a local stack.
const baseURL = process.env["E2E_BASE_URL"] ?? "https://feedme2-webapp.pages.dev";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false, // specs will share one D1 from Phase 1 on
  forbidOnly: !!process.env["CI"],
  retries: process.env["CI"] ? 2 : 0,
  workers: 1,
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL, trace: "retain-on-failure", actionTimeout: 10_000 },
  projects: [
    {
      // Phones first: the suite runs at a handset profile.
      name: "chromium",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
```

- [ ] **Step 2: Write `webapp/e2e/smoke.spec.ts`**

```ts
import { test, expect } from "@playwright/test";

test("the shell loads with the wordmark and its version", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/feedme2/);
  await expect(page.getByRole("heading", { name: "feedme2" })).toBeVisible();
  await expect(page.getByTestId("shell-version")).toContainText(/v\d+\.\d+\.\d+/);
});

test("client-routed URLs are served by the SPA fallback", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByTestId("shell")).toBeVisible();
});

/**
 * A false "update available" trains people to dismiss the bar, so the
 * real one gets dismissed too. First install must not raise it.
 */
test("no update bar on an ordinary load, nor after a reload", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("shell")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);

  await page.reload();
  await expect(page.getByTestId("shell")).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByTestId("update-bar")).toHaveCount(0);
});
```

- [ ] **Step 3: Write `webapp/e2e/hidden-console.spec.ts`**

```ts
import { test, expect, type Page } from "@playwright/test";

async function openConsole(page: Page) {
  const logo = page.getByRole("heading", { name: "feedme2" });
  await logo.click();
  await logo.click();
  await logo.click();
  return page.getByTestId("hidden-console");
}

test("3 taps on the logo open the hidden console", async ({ page }) => {
  await page.goto("/");
  await expect(await openConsole(page)).toBeVisible();
});

test("fewer than 3 taps keep the console hidden", async ({ page }) => {
  await page.goto("/");
  const logo = page.getByRole("heading", { name: "feedme2" });
  await logo.click();
  await logo.click();
  await expect(page.getByTestId("hidden-console")).toHaveCount(0);
});

test("console shows every tier version, never blank", async ({ page }) => {
  await page.goto("/");
  await openConsole(page);
  await expect(page.getByTestId("version-client")).toContainText(/\d+\.\d+\.\d+/);
  await expect(page.getByTestId("version-worker")).not.toBeEmpty();
  await expect(page.getByTestId("version-schema")).not.toBeEmpty();
  await expect(page.getByTestId("version-firmware")).not.toBeEmpty();
});

test("console shows the client startup line and the worker feed", async ({ page }) => {
  await page.goto("/");
  await openConsole(page);
  await expect(page.getByTestId("client-logs")).toContainText("app started");
  await expect(page.getByTestId("worker-logs")).toBeVisible();
});

test("console closes via its close button", async ({ page }) => {
  await page.goto("/");
  const panel = await openConsole(page);
  await page.getByTestId("console-close").click();
  await expect(panel).toHaveCount(0);
});
```

- [ ] **Step 4: Run against the local stack** (worker and vite dev from Task 11 Step 7 still running)

```bash
cd webapp && pnpm exec playwright install --with-deps chromium && E2E_BASE_URL=http://localhost:5173 pnpm test:e2e
```
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add webapp
git commit -m "test(webapp): e2e for shell, hidden console and update bar"
```

---

## Task 13: Firmware project skeleton, version header, native tests

Ported from howler: same board, same pins, same LVGL pin and SIMD-strip workaround, same partition table.

**Files:**
- Create: `firmware/platformio.ini`, `firmware/.gitignore`, `firmware/partitions/default_16MB.csv`, `firmware/include/lv_conf.h`
- Create: `firmware/scripts/strip_lvgl_simd.py`, `firmware/scripts/merge_simulator_bin.py`
- Create: `firmware/src/application/Version.h`, `firmware/src/domain/Version.h`
- Create: `firmware/test/test_domain/runner.cpp`, `firmware/test/test_domain/test_version.cpp`

- [ ] **Step 1: Copy the proven build scripts, partition table and LVGL config**

```bash
mkdir -p firmware/scripts firmware/partitions firmware/include firmware/src/application firmware/src/domain firmware/test/test_domain
cp "$HOWLER/firmware/scripts/strip_lvgl_simd.py" firmware/scripts/
cp "$HOWLER/firmware/scripts/merge_simulator_bin.py" firmware/scripts/
cp "$HOWLER/firmware/partitions/default_16MB.csv" firmware/partitions/
cp "$HOWLER/firmware/include/lv_conf.h" firmware/include/lv_conf.h
sed -i 's/Howler/feedme2/g; s/howler/feedme2/g' firmware/include/lv_conf.h
```

- [ ] **Step 2: Write `firmware/.gitignore`**

```gitignore
.pio
.vscode/.browse.c_cpp.db*
.vscode/c_cpp_properties.json
.vscode/launch.json
.vscode/ipch
serial.log
# OTA signing material (Phase 3) — never committed.
scripts/secrets/
src/application/SigningPublicKey.h
```

- [ ] **Step 3: Write `firmware/platformio.ini`**

```ini
; Elecrow CrowPanel ESP32 Rotary Display 1.28" — round 240x240 GC9A01 LCD,
; rotary encoder + push button, CST816D capacitive touch, 5-LED WS2812
; ring under the bezel. ESP32-S3R8V (16 MB flash, 8 MB OPI PSRAM).
; Pin map and TFT_eSPI flags inherited verbatim from howler/feedme.
;
; Envs: crowpanel → real HW (GC9A01); simulator → Wokwi (ILI9341 stand-in);
;       native → host Unity tests; spike-sleep → Phase 0 bench spike only.

[common]
platform = espressif32@^6.9.0
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200

board_build.mcu = esp32s3
board_build.f_cpu = 240000000L
board_build.flash_size = 16MB
board_build.partitions = partitions/default_16MB.csv
board_build.filesystem = littlefs
; ESP32-S3R8V ships 8 MB OPI PSRAM. Wokwi can't service OPI flash bus
; mode, so [env:simulator] overrides this back to qio_qspi.
board_build.arduino.memory_type = qio_opi

; The spike lives under src/spike/ and is compiled only by its own env.
build_src_filter = +<*> -<spike/>

build_unflags =
    -std=gnu++11
build_flags =
    -std=gnu++17
    -DBOARD_HAS_PSRAM
    -DARDUINO_USB_MODE=1
    -DARDUINO_USB_CDC_ON_BOOT=1
    ; ── TFT_eSPI via build flags — no User_Setup.h fork ──
    -DUSER_SETUP_LOADED=1
    -DTFT_WIDTH=240
    -DTFT_HEIGHT=240
    ; CrowPanel: DC=3 (not 8), BL=46, MISO unused. GPIO 1 must be
    ; driven HIGH from setup() to power the LCD's 3.3 V rail.
    -DTFT_MOSI=11
    -DTFT_MISO=-1
    -DTFT_SCLK=10
    -DTFT_CS=9
    -DTFT_DC=3
    -DTFT_RST=14
    -DTFT_BL=46
    -DTFT_BACKLIGHT_ON=HIGH
    -DTFT_RGB_ORDER=TFT_RGB
    -DUSE_HSPI_PORT
    -DSPI_READ_FREQUENCY=20000000
    -DLOAD_GLCD=1
    -DLOAD_FONT2=1
    -DLOAD_FONT4=1
    -DLOAD_GFXFF=1
    -DSMOOTH_FONT=1
    -DLV_CONF_INCLUDE_SIMPLE
    ; Silences TFT_eSPI's `#warning TOUCH_CS pin not defined` only.
    -Wno-cpp
    -I include
    -I src

lib_deps =
    bodmer/TFT_eSPI@^2.5.43
    ; 9.0.0 is the last release before lv_blend_helium.S (ARM SIMD);
    ; PIO's LDF compiles every source and the asm fails on xtensa.
    lvgl/lvgl@9.0.0
    bblanchon/ArduinoJson@^7.2.0
    adafruit/Adafruit NeoPixel@^1.12.0

[env:crowpanel]
extends = common
extra_scripts = pre:scripts/strip_lvgl_simd.py
upload_speed = 921600
board_upload.flash_size   = 16MB
board_upload.maximum_size = 16777216
build_flags =
    ${common.build_flags}
    -DGC9A01_DRIVER=1
    -DSPI_FREQUENCY=80000000
    -DFEEDME2_BACKEND_URL='"https://feedme2-api.atsyg-feedme.workers.dev"'

[env:simulator]
extends = common
extra_scripts =
    pre:scripts/strip_lvgl_simd.py
    post:scripts/merge_simulator_bin.py
board_build.arduino.memory_type = qio_qspi   ; Wokwi can't service OPI flash
build_unflags =
    ${common.build_unflags}
    -DARDUINO_USB_MODE=1
    -DARDUINO_USB_CDC_ON_BOOT=1
build_flags =
    ${common.build_flags}
    -UARDUINO_USB_MODE
    -UARDUINO_USB_CDC_ON_BOOT
    -DARDUINO_USB_MODE=0
    -DARDUINO_USB_CDC_ON_BOOT=0
    -DSPI_FREQUENCY=40000000
    -DILI9341_DRIVER=1      ; Wokwi has no GC9A01 part
    -DSIMULATOR=1

; Phase 0 bench spike (docs/spikes/2026-09-deep-sleep-touch-wake.md).
; SPIKE_HOLD_LCD_RAIL=1 keeps GPIO 1 high through deep sleep; build
; and flash both values and record which one the touch wakes from.
[env:spike-sleep]
extends = env:crowpanel
build_src_filter = +<spike/sleep_touch/>
build_flags =
    ${env:crowpanel.build_flags}
    -DSPIKE_HOLD_LCD_RAIL=0

; Host-side Unity tests of the pure domain + application layers.
[env:native]
platform = native
test_framework = unity
test_build_src = yes
build_flags =
    -std=gnu++17
    -I src
    -I test
    -DUNITY_INCLUDE_DOUBLE
build_src_filter =
    +<domain/>
    +<application/>
test_filter = test_*
```

- [ ] **Step 4: Write `firmware/src/application/Version.h`**

```cpp
#pragma once

// Firmware version stamp (spec §6.1). Surfaced in About, in the
// heartbeat, and in the OTA check. Auto-bumped by the pre-commit hook
// (scripts/bump_versions.py rewrites ONLY the quoted string) and
// enforced by scripts/check_version_bump.py. Format: MAJOR.MINOR.PATCH.

namespace feedme2::application {

constexpr const char* kFirmwareVersion = "0.1.0";

}  // namespace feedme2::application
```

- [ ] **Step 5: Write the failing native test `firmware/test/test_domain/test_version.cpp`**

```cpp
#include <unity.h>

#include "domain/Version.h"

using feedme2::domain::compareVersions;

namespace {
int sgn(int v) { return (v > 0) - (v < 0); }
}  // namespace

void test_version_equal() {
    TEST_ASSERT_EQUAL(0, compareVersions("1.0.0", "1.0.0"));
}

void test_version_numeric_ordering_beats_lexicographic() {
    TEST_ASSERT_EQUAL(1, sgn(compareVersions("1.10.0", "1.2.0")));
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("0.9.0", "0.10.0")));
}

void test_version_missing_segments_treated_as_zero() {
    TEST_ASSERT_EQUAL(0, compareVersions("1.4", "1.4.0"));
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("1.4", "1.4.1")));
}

void test_version_prerelease_sorts_before_release() {
    TEST_ASSERT_EQUAL(-1, sgn(compareVersions("1.4.2-rc1", "1.4.2")));
    TEST_ASSERT_EQUAL(1, sgn(compareVersions("1.4.2", "1.4.2-rc1")));
}
```

- [ ] **Step 6: Write `firmware/test/test_domain/runner.cpp`**

```cpp
// Single Unity entry point. Each test file declares `void test_*()`
// functions; they are forward-declared here so a missing test is a
// link error rather than a silently uncalled function.
#include <unity.h>

// test_version.cpp
void test_version_equal();
void test_version_numeric_ordering_beats_lexicographic();
void test_version_missing_segments_treated_as_zero();
void test_version_prerelease_sorts_before_release();

extern "C" void setUp(void) {}
extern "C" void tearDown(void) {}

int main(int, char**) {
    UNITY_BEGIN();
    RUN_TEST(test_version_equal);
    RUN_TEST(test_version_numeric_ordering_beats_lexicographic);
    RUN_TEST(test_version_missing_segments_treated_as_zero);
    RUN_TEST(test_version_prerelease_sorts_before_release);
    return UNITY_END();
}
```

- [ ] **Step 7: Run to verify it fails**

```bash
cd firmware && pio test -e native
```
Expected: compile error, `domain/Version.h: No such file or directory`. (First run installs the native toolchain; PlatformIO Core must be on PATH — `pip install platformio` if not.)

- [ ] **Step 8: Write `firmware/src/domain/Version.h`** (mirrors `shared/src/compare-versions.ts`)

```cpp
#pragma once

// Pure semver-style version compare — the C++ mirror of
// shared/src/compare-versions.ts. Per-segment numeric compare when
// both sides are digits; a non-numeric tail ("1.4.2-rc1") sorts BEFORE
// the bare numeric form. No Arduino includes: host-tested.

#include <cstdlib>
#include <string>
#include <vector>

namespace feedme2::domain {

/// Negative if a < b, 0 if equal, positive if a > b.
inline int compareVersions(const std::string& a, const std::string& b) {
    auto split = [](const std::string& s, std::vector<std::string>& out) {
        out.clear();
        std::string cur;
        for (char c : s) {
            if (c == '.') { out.push_back(cur); cur.clear(); }
            else cur.push_back(c);
        }
        out.push_back(cur);
    };
    auto isNumeric = [](const std::string& s) {
        if (s.empty()) return false;
        for (char c : s) if (c < '0' || c > '9') return false;
        return true;
    };

    std::vector<std::string> pa, pb;
    split(a, pa);
    split(b, pb);
    const size_t len = pa.size() > pb.size() ? pa.size() : pb.size();
    for (size_t i = 0; i < len; ++i) {
        const std::string sa = i < pa.size() ? pa[i] : std::string("0");
        const std::string sb = i < pb.size() ? pb[i] : std::string("0");
        const bool aNum = isNumeric(sa);
        const bool bNum = isNumeric(sb);
        if (aNum && bNum) {
            const long na = std::strtol(sa.c_str(), nullptr, 10);
            const long nb = std::strtol(sb.c_str(), nullptr, 10);
            if (na != nb) return na < nb ? -1 : 1;
        } else if (aNum != bNum) {
            return aNum ? 1 : -1;
        } else {
            const int cmp = sa.compare(sb);
            if (cmp != 0) return cmp < 0 ? -1 : 1;
        }
    }
    return 0;
}

}  // namespace feedme2::domain
```

- [ ] **Step 9: Run native tests**

```bash
cd firmware && pio test -e native
```
Expected: `4 Tests 0 Failures 0 Ignored`.

- [ ] **Step 10: Commit**

```bash
git add firmware
git commit -m "feat(firmware): platformio project, version header, native test runner"
```

---

## Task 14: Boot firmware, simulator input channel, Wokwi scenario

The device boots, powers the LCD, draws the version with LVGL, prints a machine-readable boot line, and (simulator only) accepts input events on the serial port because Wokwi's KY-040 part has no scriptable control.

**Files:**
- Create: `firmware/src/domain/SimInput.h`, `firmware/test/test_domain/test_sim_input.cpp`
- Modify: `firmware/test/test_domain/runner.cpp`
- Create: `firmware/src/main.cpp`
- Create: `firmware/wokwi.toml`, `firmware/diagram.json`, `firmware/wokwi/boot.scenario.yaml`

- [ ] **Step 1: Write the failing test `firmware/test/test_domain/test_sim_input.cpp`**

```cpp
#include <unity.h>

#include "domain/SimInput.h"

using feedme2::domain::SimEvent;
using feedme2::domain::parseSimCommand;
using feedme2::domain::simEventName;

void test_sim_input_parses_known_commands() {
    TEST_ASSERT_EQUAL(SimEvent::Press, parseSimCommand("press"));
    TEST_ASSERT_EQUAL(SimEvent::DoubleTap, parseSimCommand("double"));
    TEST_ASSERT_EQUAL(SimEvent::LongPress, parseSimCommand("long"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCW, parseSimCommand("cw"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCCW, parseSimCommand("ccw"));
    TEST_ASSERT_EQUAL(SimEvent::Touch, parseSimCommand("touch"));
}

void test_sim_input_is_case_insensitive_and_trims() {
    TEST_ASSERT_EQUAL(SimEvent::Press, parseSimCommand("  PRESS\r"));
    TEST_ASSERT_EQUAL(SimEvent::RotateCW, parseSimCommand("Cw \n"));
}

void test_sim_input_unknown_is_none() {
    TEST_ASSERT_EQUAL(SimEvent::None, parseSimCommand(""));
    TEST_ASSERT_EQUAL(SimEvent::None, parseSimCommand("jump"));
}

void test_sim_input_names_round_trip() {
    TEST_ASSERT_EQUAL_STRING("RotateCW", simEventName(SimEvent::RotateCW));
    TEST_ASSERT_EQUAL_STRING("Press", simEventName(SimEvent::Press));
    TEST_ASSERT_EQUAL_STRING("None", simEventName(SimEvent::None));
}
```

Add to `runner.cpp` (declarations block and RUN_TEST block):
```cpp
// test_sim_input.cpp
void test_sim_input_parses_known_commands();
void test_sim_input_is_case_insensitive_and_trims();
void test_sim_input_unknown_is_none();
void test_sim_input_names_round_trip();
```
```cpp
    RUN_TEST(test_sim_input_parses_known_commands);
    RUN_TEST(test_sim_input_is_case_insensitive_and_trims);
    RUN_TEST(test_sim_input_unknown_is_none);
    RUN_TEST(test_sim_input_names_round_trip);
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd firmware && pio test -e native
```
Expected: compile error, `domain/SimInput.h` missing.

- [ ] **Step 3: Write `firmware/src/domain/SimInput.h`**

```cpp
#pragma once

// Serial input channel for the Wokwi simulator (spec §5.7). Wokwi's
// KY-040 part exposes no scriptable control, so under -DSIMULATOR=1
// main.cpp reads one command per line from Serial and turns it into
// the same input event a knob or touch would produce. Scenarios
// (firmware/wokwi/*.scenario.yaml) drive it with `write-serial`.

#include <cctype>
#include <string>

namespace feedme2::domain {

enum class SimEvent { None, Press, DoubleTap, LongPress, RotateCW, RotateCCW, Touch };

inline SimEvent parseSimCommand(const std::string& raw) {
    std::string s;
    for (char c : raw) {
        if (std::isspace(static_cast<unsigned char>(c))) continue;
        s.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(c))));
    }
    if (s == "press") return SimEvent::Press;
    if (s == "double") return SimEvent::DoubleTap;
    if (s == "long") return SimEvent::LongPress;
    if (s == "cw") return SimEvent::RotateCW;
    if (s == "ccw") return SimEvent::RotateCCW;
    if (s == "touch") return SimEvent::Touch;
    return SimEvent::None;
}

inline const char* simEventName(SimEvent e) {
    switch (e) {
        case SimEvent::Press: return "Press";
        case SimEvent::DoubleTap: return "DoubleTap";
        case SimEvent::LongPress: return "LongPress";
        case SimEvent::RotateCW: return "RotateCW";
        case SimEvent::RotateCCW: return "RotateCCW";
        case SimEvent::Touch: return "Touch";
        case SimEvent::None: break;
    }
    return "None";
}

}  // namespace feedme2::domain
```

- [ ] **Step 4: Run native tests**

```bash
cd firmware && pio test -e native
```
Expected: `8 Tests 0 Failures 0 Ignored`.

- [ ] **Step 5: Write `firmware/src/main.cpp`**

```cpp
// feedme2 firmware entry point — Phase 0: boot, power the LCD rail,
// bring up LVGL over TFT_eSPI, show the version, print a
// machine-readable boot line. Phase 2 replaces the body with the
// ScreenManager and application services.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <lvgl.h>

#include <string>

#include "application/Version.h"
#include "domain/SimInput.h"

namespace {

// CrowPanel quirk: GPIO 1 must be driven HIGH to power the LCD's 3.3 V
// rail before TFT_eSPI is initialised. GPIO 2 does the same for the
// LED ring (unused in Phase 0, left low).
constexpr int LCD_POWER_PIN = 1;

TFT_eSPI tft;

// Partial render: 40 lines of 240 px at 16 bpp.
constexpr uint32_t kBufLines = 40;
lv_color_t g_drawBuf[240 * kBufLines];

lv_obj_t* g_status = nullptr;

void flushCb(lv_display_t* disp, const lv_area_t* area, uint8_t* pxMap) {
    const uint32_t w = static_cast<uint32_t>(area->x2 - area->x1 + 1);
    const uint32_t h = static_cast<uint32_t>(area->y2 - area->y1 + 1);
    tft.startWrite();
    tft.setAddrWindow(area->x1, area->y1, w, h);
    tft.pushColors(reinterpret_cast<uint16_t*>(pxMap), w * h, true);
    tft.endWrite();
    lv_display_flush_ready(disp);
}

void buildScreen() {
    lv_obj_t* scr = lv_screen_active();
    lv_obj_set_style_bg_color(scr, lv_color_hex(0x1a1226), 0);

    lv_obj_t* title = lv_label_create(scr);
    lv_label_set_text_fmt(title, "feedme2\n%s", feedme2::application::kFirmwareVersion);
    lv_obj_set_style_text_color(title, lv_color_hex(0xf6f1e6), 0);
    lv_obj_set_style_text_align(title, LV_TEXT_ALIGN_CENTER, 0);
    lv_obj_align(title, LV_ALIGN_CENTER, 0, -16);

    g_status = lv_label_create(scr);
    lv_label_set_text(g_status, "ready");
    lv_obj_set_style_text_color(g_status, lv_color_hex(0x9c97a4), 0);
    lv_obj_align(g_status, LV_ALIGN_CENTER, 0, 32);
}

#if SIMULATOR
std::string g_line;

// One command per line on Serial → input event. Echoed as
// `[feedme2] input=<Name>` so a Wokwi scenario can assert on it.
void pollSimInput() {
    while (Serial.available() > 0) {
        const char c = static_cast<char>(Serial.read());
        if (c != '\n') {
            if (g_line.size() < 32) g_line.push_back(c);
            continue;
        }
        const auto ev = feedme2::domain::parseSimCommand(g_line);
        g_line.clear();
        const char* name = feedme2::domain::simEventName(ev);
        Serial.printf("[feedme2] input=%s\n", name);
        if (g_status != nullptr) lv_label_set_text(g_status, name);
    }
}
#endif

}  // namespace

void setup() {
    Serial.begin(115200);

    pinMode(LCD_POWER_PIN, OUTPUT);
    digitalWrite(LCD_POWER_PIN, HIGH);
    delay(50);

    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    pinMode(TFT_BL, OUTPUT);
    digitalWrite(TFT_BL, TFT_BACKLIGHT_ON);

    lv_init();
    lv_tick_set_cb([]() -> uint32_t { return millis(); });
    lv_display_t* disp = lv_display_create(240, 240);
    lv_display_set_flush_cb(disp, flushCb);
    lv_display_set_buffers(disp, g_drawBuf, nullptr, sizeof(g_drawBuf), LV_DISPLAY_RENDER_MODE_PARTIAL);

    buildScreen();
    lv_timer_handler();

    Serial.printf("[feedme2] boot ok fw=%s heap=%u\n",
                  feedme2::application::kFirmwareVersion,
                  static_cast<unsigned>(ESP.getFreeHeap()));
}

void loop() {
    lv_timer_handler();
#if SIMULATOR
    pollSimInput();
#endif
    delay(5);
}
```

- [ ] **Step 6: Write `firmware/wokwi.toml`**

```toml
[wokwi]
version = 1
firmware = ".pio/build/simulator/firmware-merged.bin"
elf      = ".pio/build/simulator/firmware.elf"
```

- [ ] **Step 7: Write `firmware/diagram.json`**

```json
{
  "version": 1,
  "author": "feedme2",
  "editor": "wokwi",
  "parts": [
    { "type": "board-esp32-s3-devkitc-1", "id": "esp", "top": 0, "left": 0, "attrs": { "psramType": "quad" } },
    { "type": "wokwi-ili9341", "id": "lcd", "top": -100, "left": 200, "attrs": { "rotation": "0" } },
    { "type": "wokwi-ky-040", "id": "enc", "top": 100, "left": 200 }
  ],
  "connections": [
    [ "esp:11", "lcd:MOSI", "green", [] ],
    [ "esp:10", "lcd:SCK",  "yellow", [] ],
    [ "esp:9",  "lcd:CS",   "purple", [] ],
    [ "esp:3",  "lcd:DC",   "orange", [] ],
    [ "esp:14", "lcd:RST",  "white",  [] ],
    [ "esp:46", "lcd:LED",  "red",    [] ],
    [ "esp:GND.1", "lcd:GND", "black", [] ],
    [ "esp:3V3", "lcd:VCC",  "red",    [] ],

    [ "esp:45", "enc:CLK", "green", [] ],
    [ "esp:42", "enc:DT",  "yellow", [] ],
    [ "esp:41", "enc:SW",  "purple", [] ],
    [ "esp:GND.2", "enc:GND", "black", [] ],
    [ "esp:3V3", "enc:VCC", "red", [] ]
  ]
}
```

- [ ] **Step 8: Write `firmware/wokwi/boot.scenario.yaml`**

```yaml
name: 'feedme2 boot and serial input channel'
version: 1
author: 'feedme2'
steps:
  - wait-serial: '[feedme2] boot ok'
  - write-serial: "cw\n"
  - wait-serial: '[feedme2] input=RotateCW'
  - write-serial: "press\n"
  - wait-serial: '[feedme2] input=Press'
  - write-serial: "jump\n"
  - wait-serial: '[feedme2] input=None'
```

- [ ] **Step 9: Build both device envs**

```bash
cd firmware && pio run -e crowpanel && pio run -e simulator && ls .pio/build/simulator/firmware-merged.bin
```
Expected: both builds succeed; the merged image exists. First build downloads the toolchain and libraries (minutes).

- [ ] **Step 10: Run the Wokwi scenario locally** (needs `wokwi-cli` and a `WOKWI_CLI_TOKEN`; skip if absent — CI runs it in Task 17)

```bash
cd firmware && wokwi-cli --timeout 20000 --scenario wokwi/boot.scenario.yaml .
```
Expected: the scenario passes with all three `input=` lines seen.

- [ ] **Step 11: Flash and check on the bench** (needs the CrowPanel on USB; skip if it is not connected — the hardware check is repeated in Task 20)

```bash
cd firmware && pio run -e crowpanel -t upload && pio device monitor
```
Expected: the screen shows `feedme2` and the version on the aubergine background; the monitor prints `[feedme2] boot ok fw=0.1.x`.

- [ ] **Step 12: Commit**

```bash
git add firmware
git commit -m "feat(firmware): boot screen, simulator serial input channel, wokwi scenario"
```

---

## Task 15: Deploy workflow

**Files:**
- Create: `.github/workflows/deploy.yml`

- [ ] **Step 1: Write `.github/workflows/deploy.yml`**

```yaml
name: Deploy

# Tests every tier a change touches; deploys backend (D1 migrations +
# Worker) and webapp (Pages) on push to main; builds firmware and runs
# it in Wokwi on PRs. Firmware is never flashed from CI.
#
# Required secrets (scripts/setup-secrets.local.ps1 -GitHub):
#   CLOUDFLARE_API_KEY     — Cloudflare API *token* with Workers, D1 and
#                            Pages edit scopes (mapped to CLOUDFLARE_API_TOKEN)
#   CLOUDFLARE_ACCOUNT_ID  — 32-char hex from the dashboard sidebar
#   WOKWI_CLI_TOKEN        — optional; the HIL-2 job skips without it

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
  workflow_dispatch:

concurrency:
  group: deploy-${{ github.ref }}
  cancel-in-progress: true

jobs:
  changes:
    name: Detect changes
    runs-on: ubuntu-latest
    outputs:
      backend:  ${{ steps.filter.outputs.backend }}
      webapp:   ${{ steps.filter.outputs.webapp }}
      firmware: ${{ steps.filter.outputs.firmware }}
      shared:   ${{ steps.filter.outputs.shared }}
    steps:
      - uses: actions/checkout@v4
      - uses: dorny/paths-filter@v3
        id: filter
        with:
          filters: |
            backend:
              - 'backend/**'
              - 'shared/**'
            webapp:
              - 'webapp/**'
              - 'shared/**'
            firmware:
              - 'firmware/**'
              - 'fixtures/**'
            shared:
              - 'shared/**'

  shared-test:
    name: Shared test + typecheck
    needs: changes
    if: needs.changes.outputs.shared == 'true'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: shared } }
    steps:
      - uses: actions/checkout@v4
      # pnpm version comes from packageManager in root package.json;
      # setting `version:` here would clash with it.
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm typecheck
      - run: pnpm test

  backend-test:
    name: Backend test + typecheck
    needs: changes
    if: needs.changes.outputs.backend == 'true'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm typecheck
      - run: pnpm test

  backend-deploy:
    name: Backend deploy
    needs: [changes, backend-test]
    if: |
      (github.event_name == 'push' && needs.changes.outputs.backend == 'true') ||
      github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: backend } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - name: Apply D1 migrations
        env:
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_KEY }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: pnpm db:migrate:remote
      - name: Deploy Worker
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken:  ${{ secrets.CLOUDFLARE_API_KEY }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: backend
          command: deploy

  webapp-build:
    name: Webapp test + typecheck + build
    needs: changes
    if: needs.changes.outputs.webapp == 'true'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: webapp } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build

  # PRs: deploy this branch to a Pages preview so the smoke e2e runs
  # against the code under review.
  webapp-preview-deploy:
    name: Webapp preview deploy (PR)
    needs: [changes, webapp-build]
    if: github.event_name == 'pull_request' && needs.changes.outputs.webapp == 'true'
    runs-on: ubuntu-latest
    outputs:
      preview_url: ${{ steps.deploy.outputs.deployment-url }}
    defaults: { run: { working-directory: webapp } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm build
      - name: Deploy to Pages (branch preview)
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken:  ${{ secrets.CLOUDFLARE_API_KEY }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: webapp
          command: pages deploy dist --project-name=feedme2-webapp --branch=${{ github.head_ref }} --commit-dirty=true

  webapp-e2e-preview:
    name: Webapp E2E (preview smoke)
    needs: [changes, webapp-preview-deploy]
    if: github.event_name == 'pull_request' && needs.changes.outputs.webapp == 'true'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: webapp } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm exec playwright install --with-deps chromium
      - name: Run E2E against branch preview
        env:
          E2E_BASE_URL: ${{ needs.webapp-preview-deploy.outputs.preview_url }}
        run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report-preview
          path: webapp/playwright-report
          retention-days: 7

  # The whole suite against a hermetic local stack (wrangler dev + a
  # local D1 + vite). Nothing here touches production data.
  webapp-e2e-full:
    name: Webapp E2E (full stack)
    needs: changes
    if: >-
      github.event_name == 'pull_request' &&
      (needs.changes.outputs.webapp == 'true' || needs.changes.outputs.backend == 'true')
    runs-on: ubuntu-latest
    env:
      WRANGLER_SEND_METRICS: 'false'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
      - run: pnpm exec playwright install --with-deps chromium
        working-directory: webapp
      - name: Local worker config
        working-directory: backend
        run: cp .dev.vars.example .dev.vars
      - name: Migrate the local D1
        working-directory: backend
        run: pnpm exec wrangler d1 migrations apply feedme2-db --local
      - name: Start the worker
        working-directory: backend
        # Restart loop + health watchdog: wrangler dev has been seen to
        # go silent minutes into a run (gigsy, 2026-09-18/19). Playwright's
        # CI retries turn a five-second outage into a pass.
        run: |
          export WRANGLER_SEND_METRICS=false
          nohup sh -c 'until pnpm exec wrangler dev --port 8787; do
            echo "[ci] $(date -u +%T) wrangler dev exited with $?; restarting"; sleep 2
          done' > /tmp/wrangler.log 2>&1 &
          nohup sh -c 'fails=0; while true; do
            sleep 5
            if curl -sf -m 5 http://127.0.0.1:8787/api/health > /dev/null; then fails=0; continue; fi
            fails=$((fails + 1)); echo "[watchdog] $(date -u +%T) health miss $fails"
            if [ "$fails" -ge 3 ]; then
              pkill -x workerd || true
              pkill -f "^node .*wrangler.* dev" || true
              fails=0
            fi
          done' > /tmp/watchdog.log 2>&1 &
          for _ in $(seq 1 90); do
            curl -sf http://127.0.0.1:8787/api/health > /dev/null && exit 0
            sleep 1
          done
          echo "::error::worker never came up"; cat /tmp/wrangler.log; exit 1
      - name: Start the webapp
        working-directory: webapp
        run: |
          nohup pnpm dev --port 5192 --host 127.0.0.1 > /tmp/vite.log 2>&1 &
          for _ in $(seq 1 60); do
            curl -sf http://127.0.0.1:5192 > /dev/null && exit 0
            sleep 1
          done
          echo "::error::vite never came up"; cat /tmp/vite.log; exit 1
      - name: Run the full E2E suite
        working-directory: webapp
        env:
          E2E_BASE_URL: http://127.0.0.1:5192
        run: pnpm test:e2e
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report-full
          path: webapp/playwright-report
          retention-days: 7
      - name: Server logs on failure
        if: failure()
        run: |
          tail -n 100 /tmp/wrangler.log /tmp/vite.log /tmp/watchdog.log || true
          for f in "$HOME"/.config/.wrangler/logs/*.log; do [ -f "$f" ] && { echo "--- $f"; tail -n 200 "$f"; }; done || true

  webapp-deploy:
    name: Webapp deploy
    needs: [changes, webapp-build]
    if: |
      (github.event_name == 'push' && needs.changes.outputs.webapp == 'true') ||
      github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: webapp } }
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'pnpm' }
      - run: pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm build
      - name: Deploy to Cloudflare Pages
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken:  ${{ secrets.CLOUDFLARE_API_KEY }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          workingDirectory: webapp
          command: pages deploy dist --project-name=feedme2-webapp --branch=main

  firmware-build:
    name: Firmware native tests + builds
    needs: changes
    if: needs.changes.outputs.firmware == 'true' || github.event_name == 'workflow_dispatch'
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: firmware } }
    outputs:
      sim_built: ${{ steps.simbuild.outputs.ok }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.11' }
      - run: pip install --upgrade platformio
      - uses: actions/cache@v4
        with:
          path: |
            ~/.platformio/.cache
            firmware/.pio
          key: ${{ runner.os }}-pio-${{ hashFiles('firmware/platformio.ini') }}
          restore-keys: ${{ runner.os }}-pio-
      - name: Native domain + application tests (HIL-1)
        run: pio test -e native
      - name: Build (crowpanel)
        run: pio run -e crowpanel
      - name: Build (simulator — Wokwi)
        id: simbuild
        run: |
          pio run -e simulator
          echo "ok=true" >> "$GITHUB_OUTPUT"
      - name: Upload simulator artifacts
        if: steps.simbuild.outputs.ok == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: firmware-simulator
          path: |
            firmware/.pio/build/simulator/firmware.elf
            firmware/.pio/build/simulator/firmware-merged.bin
            firmware/diagram.json
            firmware/wokwi.toml
            firmware/wokwi/boot.scenario.yaml
          retention-days: 1

  firmware-hil2:
    name: Firmware HIL-2 (Wokwi scenario)
    needs: firmware-build
    if: needs.firmware-build.outputs.sim_built == 'true'
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      # The artifact keeps the `firmware/...` subtree; downloading to the
      # workspace root recreates it where wokwi-cli expects it.
      - uses: actions/download-artifact@v4
        with:
          name: firmware-simulator
          path: .
      # `secrets.*` cannot be read in a job-level `if:`; the env
      # round-trip is the standard workaround.
      - name: Check WOKWI_CLI_TOKEN presence
        id: tok
        env:
          T: ${{ secrets.WOKWI_CLI_TOKEN }}
        run: |
          if [ -z "$T" ]; then
            echo "::warning::WOKWI_CLI_TOKEN not set — HIL-2 will skip"
            echo "have=false" >> "$GITHUB_OUTPUT"
          else
            echo "have=true" >> "$GITHUB_OUTPUT"
          fi
        shell: bash
      - name: HIL-2 boot + input scenario (Wokwi)
        if: steps.tok.outputs.have == 'true'
        uses: wokwi/wokwi-ci-action@v1
        with:
          token: ${{ secrets.WOKWI_CLI_TOKEN }}
          path: firmware
          timeout: 20000
          scenario: wokwi/boot.scenario.yaml
          serial_log_file: firmware/serial.log
      - name: Upload serial log
        if: always() && steps.tok.outputs.have == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: hil2-serial-log
          path: firmware/serial.log
          retention-days: 7
          if-no-files-found: ignore
```

- [ ] **Step 2: Validate the YAML parses**

```bash
python -c "import yaml,sys; yaml.safe_load(open('.github/workflows/deploy.yml')); print('ok')"
```
Expected: `ok` (`pip install pyyaml` if missing).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci: deploy workflow for shared, backend, webapp, firmware and wokwi"
```

---

## Task 16: Workstation scripts (deploy, secrets)

**Files:**
- Create: `scripts/deploy.sh`, `scripts/deploy.ps1`, `scripts/setup-secrets.ps1`

- [ ] **Step 1: Write `scripts/deploy.sh`**

```bash
#!/usr/bin/env bash
# Workstation deploy helper. CI handles main-branch deploys; this is
# for one-offs. Firmware needs the board on USB.
#
# Usage:
#   ./scripts/deploy.sh --backend
#   ./scripts/deploy.sh --webapp
#   ./scripts/deploy.sh --firmware
#   ./scripts/deploy.sh --all        # backend + webapp (not firmware)
set -euo pipefail
cd "$(dirname "$0")/.."

do_backend=0; do_webapp=0; do_firmware=0
[[ $# -eq 0 ]] && { echo "usage: $0 [--backend] [--webapp] [--firmware] [--all]"; exit 1; }
for arg in "$@"; do
  case "$arg" in
    --backend)  do_backend=1 ;;
    --webapp)   do_webapp=1 ;;
    --firmware) do_firmware=1 ;;
    --all)      do_backend=1; do_webapp=1 ;;
    *) echo "unknown arg: $arg" >&2; exit 1 ;;
  esac
done

if [[ $do_backend -eq 1 ]]; then
  echo "── backend ──"
  pnpm --filter feedme2-backend db:migrate:remote
  pnpm --filter feedme2-backend deploy
fi
if [[ $do_webapp -eq 1 ]]; then
  echo "── webapp ──"
  pnpm --filter feedme2-webapp build
  pnpm --filter feedme2-webapp deploy
fi
if [[ $do_firmware -eq 1 ]]; then
  echo "── firmware (USB) ──"
  (cd firmware && pio run -e crowpanel -t upload)
fi
```

- [ ] **Step 2: Write `scripts/deploy.ps1`**

```powershell
#!/usr/bin/env pwsh
# Workstation deploy helper (PowerShell). CI handles main-branch
# deploys; this is for one-offs. Firmware needs the board on USB.
#
# Usage:
#   ./scripts/deploy.ps1 -Backend
#   ./scripts/deploy.ps1 -Webapp
#   ./scripts/deploy.ps1 -Firmware
#   ./scripts/deploy.ps1 -All        # backend + webapp (not firmware)
[CmdletBinding()]
param(
    [switch]$Backend,
    [switch]$Webapp,
    [switch]$Firmware,
    [switch]$All
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')

if ($All) { $Backend = $true; $Webapp = $true }
if (-not ($Backend -or $Webapp -or $Firmware)) {
    Write-Error 'Pick at least one: -Backend, -Webapp, -Firmware, or -All'
}

if ($Backend) {
    Write-Host '-- backend --' -ForegroundColor Cyan
    pnpm --filter feedme2-backend db:migrate:remote
    pnpm --filter feedme2-backend deploy
}
if ($Webapp) {
    Write-Host '-- webapp --' -ForegroundColor Cyan
    pnpm --filter feedme2-webapp build
    pnpm --filter feedme2-webapp deploy
}
if ($Firmware) {
    Write-Host '-- firmware (USB) --' -ForegroundColor Cyan
    Push-Location firmware
    try { pio run -e crowpanel -t upload } finally { Pop-Location }
}
```

- [ ] **Step 3: Write `scripts/setup-secrets.ps1`** — copy gigsy's and edit the four blocks below; everything else (placeholder detection, key generation, `gh secret set` and `wrangler secret put` loops, dry-run) stays as is.

```bash
cp "$GIGSY/scripts/setup-secrets.ps1" scripts/setup-secrets.ps1
```

Edit 1 — the `.SYNOPSIS`/`.NOTES` header: replace `Gigsy` with `feedme2`, delete the Google/Gemini/Anthropic "where each value comes from" lines, and add:
```
    WOKWI_CLI_TOKEN         wokwi.com -> account -> CI tokens (optional; HIL-2
                            skips without it)
```

Edit 2 — the FILL ME IN block becomes:
```powershell
$GitHubSecrets = [ordered]@{
    CLOUDFLARE_API_KEY    = '<cloudflare-api-token-workers+d1+pages-edit>'
    CLOUDFLARE_ACCOUNT_ID = '<cloudflare-account-id-32-hex>'
    WOKWI_CLI_TOKEN       = '<optional-wokwi-ci-token>'
}

$WorkerSecrets = [ordered]@{
    AUTH_SECRET = 'GENERATE'   # HS256 signing key (Phase 1 house tokens)
}
```

Edit 3 — the `-Provision` block becomes:
```powershell
if ($Provision) {
    Write-Host '-- provision (one-time) --' -ForegroundColor Cyan
    if ($DryRun) {
        Write-Host '  [dry-run] wrangler d1 create feedme2-db'
        Write-Host '  [dry-run] wrangler r2 bucket create feedme2-firmware'
        Write-Host '  [dry-run] wrangler pages project create feedme2-webapp --production-branch=main'
    } else {
        Push-Location backend
        try {
            pnpm exec wrangler d1 create feedme2-db
            pnpm exec wrangler r2 bucket create feedme2-firmware
            pnpm exec wrangler pages project create feedme2-webapp --production-branch=main
        } finally { Pop-Location }
        Write-Host ''
        Write-Host 'NOW: paste the printed database_id into backend/wrangler.toml' -ForegroundColor Yellow
    }
}
```

Edit 4 — the Cloudflare section title: `'-- Cloudflare Worker secrets (feedme2-api) --'`. Also delete the `New-VapidKeyPair` function and the `GENERATE_VAPID` branch of `Resolve-SecretValue` (no push in feedme2 yet).

- [ ] **Step 4: Dry-run to prove it parses**

```bash
pwsh -File scripts/setup-secrets.ps1 -All -DryRun
```
Expected: three `[dry-run] gh secret set` lines (all skipped as placeholders with warnings) and `AUTH_SECRET - generating random 32-byte key` followed by a `[dry-run] wrangler secret put AUTH_SECRET` line.

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/deploy.sh
git add scripts
git commit -m "chore(scripts): deploy helpers and secrets bootstrap"
```

---

## Task 17: GitHub repo, secrets, Pages project, first deploy

These steps create external resources and need Andrey's credentials. Do them in this order; never print a secret value.

- [ ] **Step 1: Create the private GitHub repo and push the branch** (confirm with Andrey before running; the global rule is private-by-default)

```bash
gh repo create a-tsygankov/feedme2 --private --source=. --remote=origin --push
git push -u origin feat/phase0-foundation
```

- [ ] **Step 2: Fill the local secrets file**

```bash
cp scripts/setup-secrets.ps1 scripts/setup-secrets.local.ps1
```
Then Andrey edits `scripts/setup-secrets.local.ps1`: `CLOUDFLARE_API_KEY` and `CLOUDFLARE_ACCOUNT_ID` are the same values as in `C:/Workspaces/gigsy/scripts/setup-secrets.local.ps1` (same account); `WOKWI_CLI_TOKEN` from wokwi.com if wanted. The file is gitignored; an agent must not read it aloud or copy values into any output.

- [ ] **Step 3: Create the Pages project and set every secret**

```bash
pwsh -File scripts/setup-secrets.local.ps1 -Provision -DryRun
```
(D1 and R2 already exist from Task 4; running `-Provision` for real would fail on the duplicate D1. Create only the Pages project by hand:)
```bash
cd backend && pnpm exec wrangler pages project create feedme2-webapp --production-branch=main
```
Then:
```bash
pwsh -File scripts/setup-secrets.local.ps1 -All
```
Expected: `set CLOUDFLARE_API_KEY`, `set CLOUDFLARE_ACCOUNT_ID`, (`set WOKWI_CLI_TOKEN`), `set AUTH_SECRET`.

- [ ] **Step 4: First deploy from the workstation** (so the preview e2e in the PR has a production worker to proxy to)

```bash
pwsh -File scripts/deploy.ps1 -All
```
Expected: migration `0000_init.sql` applied remotely; Worker at `https://feedme2-api.atsyg-feedme.workers.dev`; Pages at `https://feedme2-webapp.pages.dev`.

- [ ] **Step 5: Verify production end to end**

```bash
curl -s https://feedme2-api.atsyg-feedme.workers.dev/api/version
curl -s https://feedme2-webapp.pages.dev/api/version
curl -s https://feedme2-webapp.pages.dev/version.json
cd webapp && pnpm test:e2e
```
Expected: both `/api/version` calls return the same JSON with `"schema":{"version":"0000_init.sql"}` and `"env":"production"`; `version.json` shows the webapp version; the e2e suite passes against production (the default `E2E_BASE_URL`).

- [ ] **Step 6: Record the URLs and the D1 id in `handoff.md`** (the table already lists them; confirm they match and add the D1 id) and commit

```bash
git add handoff.md
git commit -m "docs: handoff with live resources"
```

---

## Task 18: Deep-sleep touch-wake bench spike

Answers spec Q2 (is the CST816D on the always-on rail or the GPIO 1-switched rail?) and proves `ext0` wake on GPIO 5. Needs the CrowPanel on USB and a finger; nothing else in Phase 0 depends on the result, but Phase 3's power tiers do.

**Files:**
- Create: `firmware/src/spike/sleep_touch/main.cpp`
- Create: `docs/spikes/2026-09-deep-sleep-touch-wake.md`

- [ ] **Step 1: Write `firmware/src/spike/sleep_touch/main.cpp`**

```cpp
// Phase 0 spike: can a touch on the CST816D wake the ESP32-S3 from deep
// sleep, and does the touch controller survive the LCD rail (GPIO 1)
// going low? Build with -DSPIKE_HOLD_LCD_RAIL=0 and =1 (platformio.ini
// [env:spike-sleep]) and record both runs in
// docs/spikes/2026-09-deep-sleep-touch-wake.md.
//
// Sequence per boot:
//   1. print boot count + wake cause (RTC memory survives deep sleep)
//   2. power the LCD, show the boot count
//   3. for 10 s, print the touch INT level once a second — touching the
//      screen while awake should show it pulsing low
//   4. GC9A01 sleep-in, backlight off, optionally hold GPIO 1 high
//   5. arm ext0 wake on GPIO 5 low + a 60 s timer backstop; deep sleep
// A TIMER wake means touch did not wake the chip within a minute.

#include <Arduino.h>
#include <TFT_eSPI.h>
#include <driver/gpio.h>
#include <driver/rtc_io.h>
#include <esp_sleep.h>

#ifndef SPIKE_HOLD_LCD_RAIL
#define SPIKE_HOLD_LCD_RAIL 0
#endif

namespace {
constexpr gpio_num_t kLcdPower = GPIO_NUM_1;
constexpr gpio_num_t kTouchInt = GPIO_NUM_5;
constexpr int kBacklight = TFT_BL;

RTC_DATA_ATTR uint32_t g_bootCount = 0;
TFT_eSPI tft;

const char* causeName(esp_sleep_wakeup_cause_t c) {
    switch (c) {
        case ESP_SLEEP_WAKEUP_EXT0: return "EXT0 (touch)";
        case ESP_SLEEP_WAKEUP_TIMER: return "TIMER (touch did NOT wake)";
        case ESP_SLEEP_WAKEUP_UNDEFINED: return "power-on/reset";
        default: return "other";
    }
}
}  // namespace

void setup() {
    Serial.begin(115200);
    delay(300);
    ++g_bootCount;
    const auto cause = esp_sleep_get_wakeup_cause();
    Serial.printf("[spike] boot #%u cause=%s hold_rail=%d\n",
                  static_cast<unsigned>(g_bootCount), causeName(cause), SPIKE_HOLD_LCD_RAIL);

#if SPIKE_HOLD_LCD_RAIL
    // Release the hold from the previous sleep so we can drive the pin.
    gpio_hold_dis(kLcdPower);
#endif
    pinMode(kLcdPower, OUTPUT);
    digitalWrite(kLcdPower, HIGH);
    delay(50);
    tft.init();
    tft.setRotation(0);
    tft.fillScreen(TFT_BLACK);
    pinMode(kBacklight, OUTPUT);
    digitalWrite(kBacklight, TFT_BACKLIGHT_ON);
    tft.setTextDatum(MC_DATUM);
    tft.setTextColor(TFT_WHITE, TFT_BLACK);
    tft.drawString("sleep spike", 120, 90, 4);
    tft.drawString(String("boot ") + g_bootCount, 120, 130, 4);
    tft.drawString(causeName(cause), 120, 165, 2);

    pinMode(kTouchInt, INPUT_PULLUP);
    for (int s = 10; s > 0; --s) {
        Serial.printf("[spike] awake %2d s, touch INT=%d (touch the screen: expect 0 pulses)\n",
                      s, digitalRead(kTouchInt));
        delay(1000);
    }

    // Panel to sleep-in (0x10) so a held rail costs microamps, not mA.
    tft.writecommand(0x10);
    delay(120);
    digitalWrite(kBacklight, TFT_BACKLIGHT_ON == HIGH ? LOW : HIGH);

#if SPIKE_HOLD_LCD_RAIL
    gpio_hold_en(kLcdPower);
    gpio_deep_sleep_hold_en();
    Serial.println("[spike] GPIO1 held HIGH through sleep");
#else
    digitalWrite(kLcdPower, LOW);
    Serial.println("[spike] GPIO1 driven LOW (LCD rail off)");
#endif

    rtc_gpio_pullup_en(kTouchInt);
    rtc_gpio_pulldown_dis(kTouchInt);
    esp_sleep_enable_ext0_wakeup(kTouchInt, 0);
    esp_sleep_enable_timer_wakeup(60ULL * 1000000ULL);
    Serial.println("[spike] deep sleep now — touch the screen within 60 s");
    Serial.flush();
    esp_deep_sleep_start();
}

void loop() {}
```

- [ ] **Step 2: Write the report template `docs/spikes/2026-09-deep-sleep-touch-wake.md`**

```markdown
# Spike: deep-sleep touch wake on the CrowPanel 1.28"

Question (spec §0 Q2, §5.5): can a CST816D touch (INT on GPIO 5) wake the
ESP32-S3 from deep sleep, and is the touch controller powered from the
always-on 3V3 rail or from the GPIO 1-switched LCD rail?

Firmware: `firmware/src/spike/sleep_touch/main.cpp`, env `spike-sleep`.

## Procedure
1. `cd firmware && pio run -e spike-sleep -t upload && pio device monitor`
2. While awake (10 s), touch the screen: the `touch INT=` line should show `0` pulses.
3. Wait for `deep sleep now`, then touch the screen. Read the next boot's `cause=`.
4. Edit `platformio.ini` `[env:spike-sleep]` to `-DSPIKE_HOLD_LCD_RAIL=1`, repeat 1–3.
5. If a USB power meter is available, note the sleeping current for each run.

## Results
| Run | INT pulses while awake | Wake cause after touch | Sleep current |
|---|---|---|---|
| hold_rail=0 | | | |
| hold_rail=1 | | | |

## Conclusion
(Which rail powers the touch controller; whether ext0 wake works; which of the
§5.5 fallbacks Phase 3 must take.)
```

- [ ] **Step 3: Build the spike env** (compiles without hardware; the bench run is Andrey's)

```bash
cd firmware && pio run -e spike-sleep
```
Expected: build succeeds.

- [ ] **Step 4: Bench run** — Andrey follows the Procedure and fills in Results and Conclusion. If the board is not available, leave the tables empty and note the date it was deferred.

- [ ] **Step 5: Commit**

```bash
git add firmware/src/spike docs/spikes
git commit -m "spike(firmware): deep-sleep touch-wake bench firmware and report"
```

---

## Task 19: Full local verification

- [ ] **Step 1: Full local verification**

```bash
pnpm install && pnpm typecheck && pnpm test && python -m unittest discover -s scripts && (cd firmware && pio test -e native && pio run -e crowpanel && pio run -e simulator)
```
Expected: every step green. `pnpm test` runs shared, backend and webapp unit suites.

- [ ] **Step 2: Confirm the hook bumped versions along the way**

```bash
git log --oneline | head -20 && grep '"version"' webapp/package.json backend/package.json && grep kFirmwareVersion firmware/src/application/Version.h
```
Expected: versions above `0.1.0` for every tier that was touched after its creation commit.

---

## Task 20: PR and CI

- [ ] **Step 1: Open the PR**

```bash
gh pr create --base main --head feat/phase0-foundation --title "Phase 0: foundation" --body "$(cat <<'EOF'
Monorepo, four-tier versioning with auto-bump hook and CI gate, worker with /api/version and /api/debug/logs, PWA shell with update bar and hidden console, firmware skeleton with Wokwi scenario, deploy workflow, secrets script, deep-sleep spike.

Spec: docs/superpowers/specs/2026-09-20-feedme2-design.md
Plan: docs/superpowers/plans/2026-09-20-phase0-foundation.md

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Watch CI**

Expected green jobs: `Verify patch bump`, `Shared test + typecheck`, `Backend test + typecheck`, `Webapp test + typecheck + build`, `Webapp preview deploy (PR)`, `Webapp E2E (preview smoke)`, `Webapp E2E (full stack)`, `Firmware native tests + builds`, `Firmware HIL-2 (Wokwi scenario)` (or a warning-skip without the token). Fix anything red on the branch; the plan's own steps are the reference for what each job runs.

- [ ] **Step 3: Merge and confirm the main-branch deploys**

After merge, `Backend deploy` and `Webapp deploy` run. Re-run Task 17 Step 5's curls; then update `handoff.md` → Phase 0 complete, Phase 1 next.

---

## Self-review against the spec

- §2 layout: Tasks 1, 2, 4, 8, 13 create every listed directory except `assets/cats/`, `fixtures/`, `tools/device-sim/` (Phases 1–2 content; `fixtures/` is already matched by the version rules).
- §3.3 `/api/version` with worker/schema/firmware: Task 6. `/api/debug/logs`: Task 7 (auth deferred to Phase 1, stated).
- §4.5 update bar + served-version poll: Task 11. §4.6 console with all tier versions and both feeds: Task 10 (device feed and persistence are Phase 1, per the spec's phase table).
- §5.7 Wokwi with serial input channel: Task 14. Native tests: Tasks 13–14.
- §5.5 spike: Task 18. §6.1 four tiers + `shared/` rule: Task 3. §6.2 workflows: Tasks 3 and 15. §6.3 scripts: Task 16. §6.4 secrets: Tasks 16–17. §6.5 resources: Tasks 4 and 17.
- Types: `LogEntry` (`ts, level, source, msg, data?, deviceId?, clientId?`) is the one shape used by shared, both loggers, `LogList` and the debug route; `TierVersions` has `client, worker, schema, firmware, env` in `versions.ts`, `HiddenConsole` and its test; `Tier.read/write` names match between `version_rules.py`, `bump_versions.py` and the tests; `feedme2::domain::compareVersions` and `SimEvent`/`parseSimCommand`/`simEventName` match between headers, tests and `main.cpp`.
