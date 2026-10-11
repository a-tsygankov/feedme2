// Rendered to static markup: @testing-library is not a dependency, and the ring is pure.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HungerRing } from "./HungerRing.tsx";

const render = (ratio: number, level: Parameters<typeof HungerRing>[0]["level"] = "content") =>
  renderToStaticMarkup(<HungerRing ratio={ratio} level={level} />);
const offset = (html: string) => /stroke-dashoffset="([^"]+)"/.exec(html)?.[1];
const hasProgress = (html: string) => html.includes('data-testid="hunger-ring-progress"');

describe("HungerRing", () => {
  it.each([
    [0, "0"],
    [0.5, "0.5"],
    [-0.5, "0"], // clock skew: a future lastFedAt must not overfill
  ])("ratio %s draws the arc with offset %s", (ratio, expected) => {
    const html = render(ratio);
    expect(hasProgress(html)).toBe(true);
    expect(offset(html)).toBe(expected);
    expect(html).toContain('pathLength="1"');
    expect(html).toContain('stroke-dasharray="1"');
  });

  it.each([1, 1.5, Infinity, NaN])("ratio %s draws no progress arc at all", (ratio) => {
    const html = render(ratio);
    expect(hasProgress(html)).toBe(false);
    expect(offset(html)).toBeUndefined();
  });

  it("is an image named by the hunger level, with children outside the svg", () => {
    const html = renderToStaticMarkup(<HungerRing ratio={0.2} level="very_hungry"><b data-testid="kid" /></HungerRing>);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Very hungry"');
    expect(html).not.toContain("aria-hidden");
    expect(html.indexOf("</svg>")).toBeLessThan(html.indexOf('data-testid="kid"'));
  });

  it("pulses only the starving arc, and only when motion is allowed", () => {
    expect(render(0.2, "starving")).toContain("motion-safe:animate-pulse");
    expect(render(0.2, "hungry")).not.toContain("animate-pulse");
  });

  it("scales the stroke with the size but never below 3 px", () => {
    const stroke = (size: number) => /stroke-width="(\d+)"/.exec(renderToStaticMarkup(<HungerRing ratio={0.5} level="fed" size={size} />))?.[1];
    expect(stroke(30)).toBe("3");
    expect(stroke(120)).toBe("8");
    expect(stroke(240)).toBe("16");
  });
});
