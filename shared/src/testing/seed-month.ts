/**
 * March 2026 in Europe/Berlin, the spec's Phase 4 exit fixture (spec §7: "e2e over a seeded month").
 * Includes the spring-forward day (2026-03-29, 23 h). Mochi eats at 07:30 and 19:00 (40 g); Luna at
 * 07:00, 13:00 and 20:00 (30 g) except 2026-03-15 20:00, which is missing, so Luna's longest gap is
 * 13:00 on the 15th to 07:00 on the 16th (18 h). Totals: 62 + 92 = 154 feedings, 5 240 g.
 */
import { addDays, midnightMs, type DateKey } from "../zone.ts";
import type { ReportFeeding } from "../reports.ts";

export const SEED_TZ = "Europe/Berlin";
export const SEED_FROM: DateKey = "2026-03-01";
export const SEED_TO: DateKey = "2026-03-31";

/**
 * Cat and feeding ids are global primary keys in D1, so a suite that seeds the same database
 * twice (e2e reruns) passes a fresh 8-hex `salt`; ids stay valid lowercase v4 UUIDs.
 */
export const randomSalt = (): string => Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, "0");

export interface SeedCat { id: string; name: string; color: string }

/** A tuple, so SEED_CATS[0] and [1] type as defined under noUncheckedIndexedAccess. */
export function seedMonth(salt = "5eed0000"): { cats: [SeedCat, SeedCat]; feedings: ReportFeeding[] } {
  const cats: [SeedCat, SeedCat] = [
    { id: `${salt}-0000-4000-8000-000000000001`, name: "Mochi", color: "#4CAF50" },
    { id: `${salt}-0000-4000-8000-000000000002`, name: "Luna", color: "#2196F3" },
  ];
  return { cats, feedings: buildFeedings(salt, cats[0].id, cats[1].id) };
}

/** Default-salt views for the pure tests. */
export const SEED_CATS = seedMonth().cats;
export const seedMonthFeedings = (): ReportFeeding[] => seedMonth().feedings;

// A function declaration, not a const: SEED_CATS above runs seedMonth() at module load (hoisting).
function at(day: DateKey, h: number, mi: number): number {
  // Local wall time on `day`; none of the seed times fall in a DST gap (02:00–03:00).
  const mid = midnightMs(day, SEED_TZ);
  const guess = mid + (h * 60 + mi) * 60_000;
  const next = midnightMs(addDays(day, 1), SEED_TZ);
  // After a spring-forward the wall clock runs one hour ahead of mid + elapsed.
  return next - mid === 23 * 3_600_000 && h >= 3 ? guess - 3_600_000 : guess;
}

function buildFeedings(salt: string, mochi: string, luna: string): ReportFeeding[] {
  const out: ReportFeeding[] = [];
  let n = 0;
  for (let i = 0; i < 31; i++) {
    const day = addDays(SEED_FROM, i);
    const push = (catId: string, h: number, mi: number, amountMg: number) =>
      out.push({ id: `${salt}-0001-4000-8000-${String(++n).padStart(12, "0")}`, catId, fedAt: at(day, h, mi), amountMg });
    push(mochi, 7, 30, 40_000);
    push(mochi, 19, 0, 40_000);
    push(luna, 7, 0, 30_000);
    push(luna, 13, 0, 30_000);
    if (day !== "2026-03-15") push(luna, 20, 0, 30_000);
  }
  return out;
}
