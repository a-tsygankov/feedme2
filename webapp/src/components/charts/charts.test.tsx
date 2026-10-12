// @vitest-environment jsdom
// No testing-library in this repo (and Phase 4 adds no dependency): drive the real DOM with react-dom/client inside
// act(), with the three queries the plan's test needs written out below.
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarChart } from "./BarChart.tsx";
import { FeedingChart } from "./FeedingChart.tsx";
import { Heatmap } from "./Heatmap.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let mount: Root;
beforeEach(() => {
  const host = document.createElement("div");
  document.body.append(host);
  mount = createRoot(host);
});
afterEach(() => {
  act(() => mount.unmount());
  document.body.innerHTML = "";
});

const render = (node: ReactNode) => act(() => mount.render(node));
const byTestId = (id: string) => {
  const el = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  if (!el) throw new Error(`no element with data-testid="${id}"`);
  return el;
};
const hasText = (text: string) => [...document.body.querySelectorAll("*")].some((el) => el.textContent === text && el.children.length === 0);
/** The visible bars of one column: the transparent full-height hit area is not a bar. */
const bars = (key: string) => byTestId(`bar-${key}`).querySelectorAll('rect:not([fill="transparent"])');
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
const keyDown = (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })); });

const series = [{ id: "a", label: "Mochi", color: "#4CAF50" }, { id: "b", label: "Luna", color: "#2196F3" }];
const points = [
  { key: "2026-03-01", label: "1", values: { a: 2, b: 3 } },
  { key: "2026-03-02", label: "2", values: { a: 1, b: 0 } },
  { key: "2026-03-03", label: "3", values: {} },
];

describe("BarChart", () => {
  it("stacks series and scales to the tallest column", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} height={100} testId="c" />);
    const first = bars("2026-03-01");
    expect(first).toHaveLength(2);
    const heights = [...first].map((r) => Number(r.getAttribute("height")));
    expect(heights.reduce((a, b) => a + b, 0)).toBeCloseTo(100 * 0.9, 0); // tallest column fills the plot (10% headroom)
    expect(bars("2026-03-03")).toHaveLength(0);
    expect(byTestId("c").innerHTML).not.toMatch(/NaN|Infinity/);
  });
  it("is reachable without sight: a data table with every value", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} testId="c" />);
    const tables = byTestId("c").querySelectorAll("table");
    expect(tables).toHaveLength(1);
    expect(tables[0]!.querySelectorAll("tr")).toHaveLength(1 + points.length);
    expect(tables[0]!.textContent).toContain("Mochi");
  });
  it("drills on click and on Enter", () => {
    const onSelect = vi.fn();
    render(<BarChart title="Feedings" series={series} points={points} format={String} onSelect={onSelect} testId="c" />);
    expect(byTestId("bar-2026-03-01").getAttribute("role")).toBe("button");
    expect(byTestId("bar-2026-03-01").getAttribute("tabindex")).toBe("0");
    click(byTestId("bar-2026-03-01"));
    keyDown(byTestId("bar-2026-03-02"), "Enter");
    expect(onSelect.mock.calls).toEqual([["2026-03-01"], ["2026-03-02"]]);
  });
  it("drills on Space", () => {
    const onSelect = vi.fn();
    render(<BarChart title="Feedings" series={series} points={points} format={String} onSelect={onSelect} testId="c" />);
    keyDown(byTestId("bar-2026-03-03"), " ");
    expect(onSelect.mock.calls).toEqual([["2026-03-03"]]);
  });
  it("shows keyboard focus on a drill column, even an empty one (WCAG 2.4.7)", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} onSelect={() => {}} testId="c" />);
    const col = byTestId("bar-2026-03-03");
    expect(col.getAttribute("tabindex")).toBe("0");
    expect(col.getAttribute("class")).toMatch(/\bgroup\b/);
    // The full-height hit rect is the focus indicator: it is there even when the column has no bars.
    const hit = col.querySelector('rect[fill="transparent"]')!;
    expect(hit.getAttribute("class")).toContain("group-focus-visible:fill-slate-200");
    expect(hit.getAttribute("class")).toContain("group-focus-visible:stroke-emerald-500");
  });
  it("names the drillable plot as a group", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} onSelect={() => {}} testId="c" />);
    const svg = byTestId("c").querySelector("svg")!;
    expect(svg.getAttribute("role")).toBe("group");
    expect(svg.getAttribute("aria-label")).toBe("Feedings");
  });
  it("puts each axis label under its own column", () => {
    // flex justify-between spread the shown labels evenly, so in a 31-day month "29" landed under day 31.
    const month = Array.from({ length: 31 }, (_, i) => ({ key: `d${i}`, label: String(i + 1), values: { a: 1 } }));
    render(<BarChart title="Feedings" series={series} points={month} format={String} testId="c" />);
    const label = [...byTestId("c").querySelectorAll<HTMLElement>("span")].find((el) => el.textContent === "29")!;
    expect(parseFloat(label.style.left)).toBeCloseTo((28.5 / 31) * 100, 2);
  });
  it("renders at the height it is given", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} height={100} testId="c" />);
    expect(byTestId("c").querySelector("svg")!.style.height).toBe("100px");
  });
  it("treats non-finite values as zero", () => {
    render(
      <BarChart
        title="Feedings" series={series} format={String} testId="c"
        points={[{ key: "x", label: "1", values: { a: NaN, b: 2 } }, { key: "y", label: "2", values: { a: Infinity } }]}
      />,
    );
    expect(byTestId("c").innerHTML).not.toMatch(/NaN|Infinity/);
    expect(bars("x")).toHaveLength(1);
    expect(bars("y")).toHaveLength(0);
  });
  it("is not a button when it cannot drill", () => {
    render(<BarChart title="Feedings" series={series} points={points} format={String} testId="c" />);
    expect(byTestId("bar-2026-03-01").getAttribute("role")).toBeNull();
  });
  it("shows the empty state when there is nothing to draw", () => {
    render(<BarChart title="Feedings" series={series} points={[points[2]!]} format={String} testId="c" />);
    expect(hasText("No feedings in this range")).toBe(true);
  });
  it("shows the empty state when every value is NaN", () => {
    render(<BarChart title="Feedings" series={series} points={[{ key: "x", label: "1", values: { a: NaN } }]} format={String} testId="c" />);
    expect(hasText("No feedings in this range")).toBe(true);
  });
});

/** The heatmap's data cells; every cell also has a sunken track rect behind it. */
const cellRects = (id: string) => byTestId(id).querySelectorAll("svg rect:not([data-track])");

describe("Heatmap", () => {
  it("draws 168 cells with opacity by count", () => {
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    cells[0]![7] = 4; cells[6]![19] = 2;
    render(<Heatmap title="By hour" cells={cells} testId="h" />);
    const rects = cellRects("h");
    expect(rects).toHaveLength(168);
    expect(Number(rects[7]!.getAttribute("fill-opacity"))).toBe(1);
    // Floor 0.15 (was 0.08, ~1.2:1 in dark mode): 0.15 + 0.85 * 2/4.
    expect(Number(rects[6 * 24 + 19]!.getAttribute("fill-opacity"))).toBeCloseTo(0.575, 3);
    expect(Number(rects[0]!.getAttribute("fill-opacity"))).toBe(0);
  });
  it("draws a sunken track behind every cell so empty hours still read as a grid", () => {
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    cells[0]![0] = 1;
    render(<Heatmap title="By hour" cells={cells} testId="h" />);
    const tracks = byTestId("h").querySelectorAll("svg rect[data-track]");
    expect(tracks).toHaveLength(168);
    expect(tracks[0]!.getAttribute("fill")).toBe("rgb(var(--c-slate-200))");
  });
  it("treats non-finite counts as zero", () => {
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(0));
    cells[0]![0] = NaN; cells[0]![1] = Infinity; cells[0]![2] = 2;
    render(<Heatmap title="By hour" cells={cells} testId="h" />);
    expect(byTestId("h").innerHTML).not.toMatch(/NaN|Infinity/);
    expect(Number(cellRects("h")[2]!.getAttribute("fill-opacity"))).toBe(1);
    render(<Heatmap title="By hour" cells={Array.from({ length: 7 }, () => new Array<number>(24).fill(NaN))} testId="h" />);
    expect(hasText("No feedings in this range")).toBe(true);
  });
  it("is empty when every cell is zero", () => {
    render(<Heatmap title="By hour" cells={Array.from({ length: 7 }, () => new Array<number>(24).fill(0))} testId="h" />);
    expect(hasText("No feedings in this range")).toBe(true);
  });
});

describe("FeedingChart", () => {
  it("switches on kind", () => {
    render(<FeedingChart kind="bars" title="Feedings" series={series} points={points} format={String} testId="c" />);
    expect(byTestId("c").querySelectorAll("[data-testid^='bar-']")).toHaveLength(points.length);
    const cells = Array.from({ length: 7 }, () => new Array<number>(24).fill(1));
    render(<FeedingChart kind="heatmap" title="By hour" cells={cells} testId="h" />);
    expect(cellRects("h")).toHaveLength(168);
  });
});
