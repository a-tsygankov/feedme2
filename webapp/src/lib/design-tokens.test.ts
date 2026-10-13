/**
 * Adherence tests for the design-token layer (src/styles/tokens/).
 *
 * Started for Phase 5b's help tours: the tour popover (styles/help.css)
 * draws on its own surface so a walkthrough is never mistaken for the
 * app it is walking through. semantic.css has no dark block — every
 * alias resolves through a --c-* triplet that colors.css re-points under
 * [data-theme="dark"] — so "defined in dark" means every palette step a
 * help alias references has a dark value, and "legible" means that dark
 * value is not the card surface it sits on. Ported in spirit from
 * gigsy's webapp/src/lib/design-tokens.test.ts.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const tokensDir = fileURLToPath(new URL("../styles/tokens/", import.meta.url));
const DARK = '[data-theme="dark"]';

/** Variables declared in `css`, comments stripped first so prose that
 *  mentions a name is never read as a declaration. */
function vars(css: string): Record<string, string> {
  const code = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out: Record<string, string> = {};
  for (const [, name, value] of code.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    if (name !== undefined && value !== undefined) out[name] = value.trim();
  }
  return out;
}

const colors = readFileSync(tokensDir + "colors.css", "utf8");
const darkAt = colors.indexOf(DARK);
const lightPalette = vars(colors.slice(0, darkAt));
const darkPalette = vars(colors.slice(darkAt));
const semantic = vars(readFileSync(tokensDir + "semantic.css", "utf8"));

/** The --c-* steps an alias resolves through. */
const refs = (value: string) => [...value.matchAll(/var\((--c-[\w-]+)\)/g)].map((m) => m[1]!);

const HELP_TOKENS = ["--surface-help", "--border-help"] as const;

describe("help surface tokens", () => {
  it("colors.css has a dark block to re-point the palette", () => {
    expect(darkAt).toBeGreaterThan(-1);
  });

  it.each(HELP_TOKENS)("%s is defined and resolves in light", (token) => {
    const value = semantic[token];
    expect(value, `missing ${token}`).toBeDefined();
    const steps = refs(value!);
    expect(steps.length, `${token} references no palette step`).toBeGreaterThan(0);
    for (const step of steps) {
      expect(lightPalette[step], `${token}: ${step} has no light value`).toBeDefined();
    }
  });

  it.each(HELP_TOKENS)("%s resolves in dark", (token) => {
    // One missing dark step is one popover rendering light-on-dark.
    for (const step of refs(semantic[token] ?? "")) {
      expect(darkPalette[step], `${token}: ${step} has no dark value`).toBeDefined();
    }
  });

  /**
   * The whole point of the help surface is that it is NOT the card
   * surface. Aliasing them to the same step would leave every tour
   * looking like one more panel of the screen, with nothing failing to
   * say so — in either theme.
   */
  it("the help surface is distinguishable from the card and app surfaces", () => {
    expect(semantic["--surface-help"]).not.toBe(semantic["--surface-card"]);
    expect(semantic["--surface-help"]).not.toBe(semantic["--bg-app"]);
    expect(semantic["--border-help"]).not.toBe(semantic["--border-default"]);
  });

  it("the help surface does not collapse into the card surface in dark", () => {
    const [help] = refs(semantic["--surface-help"] ?? "");
    const [card] = refs(semantic["--surface-card"] ?? "");
    expect(help && card, "help or card surface resolves through no step").toBeTruthy();
    expect(darkPalette[help!]).not.toBe(darkPalette[card!]);
    expect(lightPalette[help!]).not.toBe(lightPalette[card!]);
  });

  it("the tour popover draws itself on the help surface", () => {
    // Driver.js paints its arrow as four one-sided borders, so an
    // overlooked side leaves a card-white spike on a tinted popover.
    // Comments stripped first — help.css explains why it is NOT on
    // --surface-card, and the explanation is not a declaration.
    const help = readFileSync(
      fileURLToPath(new URL("../styles/help.css", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    expect(help).not.toContain("--surface-card");
    expect(help.match(/var\(--surface-help\)/g)?.length).toBe(5); // body + 4 arrow sides
    expect(help).toContain(".feedme2-help-popover.driver-popover");
  });

  // driver.css loads AFTER help.css and styles the close button's
  // `:hover, :focus` as #2d2d2d at (0,2,0). A `:focus-visible` rule alone
  // does not cover a focus the browser decides not to show as visible
  // (a mouse or programmatic focus), so driver's dark grey won there and
  // the focused Close went near-invisible on the dark help surface.
  it("the focused Close button keeps a token colour that beats driver's", () => {
    const help = readFileSync(
      fileURLToPath(new URL("../styles/help.css", import.meta.url)),
      "utf8",
    ).replace(/\/\*[\s\S]*?\*\//g, "");
    const rules = [...help.matchAll(/([^{}]+)\{([^}]*)\}/g)].map((m) => ({
      selectors: m[1]!.split(",").map((sel) => sel.trim()),
      body: m[2]!,
    }));
    const focus = rules.find((r) =>
      r.selectors.includes(".feedme2-help-popover .driver-popover-close-btn:focus"),
    );
    expect(focus, "no plain :focus rule for the close button").toBeDefined();
    expect(focus!.body).toMatch(/(^|[;\s])color:\s*var\(--text-strong\)/);
  });

  it("the main stylesheet imports help.css", () => {
    const main = readFileSync(fileURLToPath(new URL("../styles.css", import.meta.url)), "utf8");
    expect(main).toContain('@import "./styles/help.css";');
  });
});
