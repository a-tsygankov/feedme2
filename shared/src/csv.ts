/** CSV for exports (spec §1.3 "CSV export"). RFC 4180 quoting plus gigsy's formula-injection guard. */
import type { FoodUnit } from "./api.ts";
import { fromMg } from "./units.ts";
import { dateKeyOf, zonedParts } from "./zone.ts";

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(v: string | number | null): string {
  if (v === null) return "";
  if (typeof v === "number") return String(v);
  // A spreadsheet runs a cell starting with these as a formula; the apostrophe makes it text.
  const s = FORMULA_START.test(v) ? `'${v}` : v;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows: Array<Array<string | number | null>>): string => rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

export const FEEDINGS_CSV_HEADERS = ["date", "time", "cat", "amount", "unit", "grams", "entered_value", "entered_unit", "source", "note"] as const;

export interface CsvFeeding { fedAt: number; catName: string; amountMg: number; enteredUnit: FoodUnit; enteredValue: string; source: "device" | "web"; note: string | null }

export function feedingCsvRow(f: CsvFeeding, tz: string, unit: FoodUnit, canSizeMg: number): Array<string | number | null> {
  const p = zonedParts(f.fedAt, tz);
  const time = `${String(p.h).padStart(2, "0")}:${String(p.mi).padStart(2, "0")}`;
  return [
    dateKeyOf(f.fedAt, tz), time, f.catName,
    Math.round(fromMg(f.amountMg, unit, canSizeMg) * 100) / 100, unit,
    Math.round(f.amountMg) / 1000, f.enteredValue, f.enteredUnit, f.source, f.note,
  ];
}
