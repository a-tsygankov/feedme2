import { describe, expect, it } from "vitest";
import { csvCell, feedingCsvRow, FEEDINGS_CSV_HEADERS, toCsv } from "./csv.ts";

describe("csv", () => {
  it("quotes only when needed and keeps numbers bare", () => {
    expect(csvCell("Mochi")).toBe("Mochi");
    expect(csvCell('say "hi", ok')).toBe('"say ""hi"", ok"');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(-3.5)).toBe("-3.5");
    expect(csvCell(null)).toBe("");
  });
  it("defuses spreadsheet formulas", () => {
    expect(csvCell("=HYPERLINK(\"x\")")).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell("+1")).toBe("'+1");
    expect(csvCell("-1")).toBe("'-1");
    expect(csvCell("@cmd")).toBe("'@cmd");
  });
  it("joins with CRLF and ends with one", () => {
    expect(toCsv([["a", 1], ["b", null]])).toBe("a,1\r\nb,\r\n");
  });
  it("renders a feeding in the house zone and unit", () => {
    const row = feedingCsvRow(
      { fedAt: Date.UTC(2026, 2, 28, 23, 5), catName: "Mochi", amountMg: 77_961, enteredUnit: "can", enteredValue: "1/2", source: "device", note: null },
      "Europe/Berlin", "can", 155_922,
    );
    expect(row).toEqual(["2026-03-29", "00:05", "Mochi", 0.5, "can", 77.961, "1/2", "can", "device", null]);
    expect(FEEDINGS_CSV_HEADERS).toHaveLength(row.length);
  });
});
