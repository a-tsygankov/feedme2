/**
 * The list of help topics. Semantic buttons and a real text input, so
 * the whole thing works from a keyboard.
 *
 * Does not render `unavailable` itself — a failed scenario can have
 * navigated the user off whatever screen this menu lives on before it
 * fails, so that message is HelpUnavailableBanner's job, rendered by
 * HelpProvider at the app root instead. See that file's doc comment.
 *
 * Secondary text is slate-600 rather than the slate-500 the rest of the
 * app uses for the same job. This menu's home, HelpSheet, sits on
 * --surface-help, where slate-500 measures 4.19:1 and misses the 4.5
 * small text needs.
 *
 * Ported from gigsy. feedme2's form controls carry their own label
 * (Select) or have a labelled sibling (Field), so the search box is the
 * bare Input and the variant picker passes its label to Select rather
 * than wrapping it in one.
 */
import { useMemo, useState } from "react";
import { Button } from "../../components/Button.tsx";
import { Input } from "../../components/Input.tsx";
import { Select } from "../../components/Select.tsx";
import { detectHelpEnvironment } from "../environment.ts";
import { helpScenarios } from "../registry.ts";
import type { HelpCategory, HelpEnvironment, HelpScenario, HelpVariant } from "../types.ts";
import { useHelp } from "./HelpProvider.tsx";

/** Key order is section order in the menu (see `groupScenarios`): the
 *  first-run topics, then the daily work — the cats and what was fed,
 *  then the reports over it — then the feeder, and only then
 *  configuration. Installing comes last because it is about the browser,
 *  not the app. Exported so HelpMenu.test.ts can pin both the order and
 *  the wording. */
export const CATEGORY_LABELS: Record<HelpCategory, string> = {
  "getting-started": "Getting started",
  cats: "Cats and feeding",
  reports: "Reports",
  devices: "Devices",
  settings: "Settings",
  installation: "Install the app",
};

/** `query` is expected pre-trimmed — callers normalize once, at the
 *  point they also decide what counts as "no query". */
export function matches(scenario: HelpScenario, query: string): boolean {
  if (query === "") return true;
  const haystack = `${scenario.title} ${scenario.description ?? ""}`;
  return haystack.toLowerCase().includes(query.toLowerCase());
}

export interface HelpMenuGroup {
  category: HelpCategory;
  scenarios: HelpScenario[];
}

/** Matching scenarios, grouped and ordered.
 *
 *  Section order follows `CATEGORY_LABELS`' own key order, not first
 *  occurrence in `scenarios` — deriving order from the array would
 *  silently follow registration order the moment a `getting-started`
 *  scenario is added after `settings` ones, since both already exist
 *  today and happen to agree by accident.
 *
 *  One pass to bucket, one pass over the (fixed, small) category list
 *  to assemble the result — replaces what used to be a filter, a `Set`
 *  for category discovery, and a second filter per category.
 *
 *  `scenarios` defaults to the real registry but takes a parameter so
 *  ordering and matching can be tested against a small fixture instead
 *  of whatever happens to be registered today — the same reason
 *  `TourRenderer.ts`'s `expandBranch` takes `steps` rather than reading
 *  a module-level list. */
export function groupScenarios(
  query: string,
  scenarios: HelpScenario[] = helpScenarios,
): HelpMenuGroup[] {
  const q = query.trim();
  const byCategory = new Map<HelpCategory, HelpScenario[]>();
  for (const scenario of scenarios) {
    if (!matches(scenario, q)) continue;
    const bucket = byCategory.get(scenario.category);
    if (bucket === undefined) byCategory.set(scenario.category, [scenario]);
    else bucket.push(scenario);
  }
  return (Object.keys(CATEGORY_LABELS) as HelpCategory[])
    .map((category) => ({ category, scenarios: byCategory.get(category) ?? [] }))
    .filter((group) => group.scenarios.length > 0);
}

/** Which variant a scenario's picker should show first.
 *
 *  The detected environment, but only when the scenario actually offers
 *  it — a scenario is free to skip an environment entirely, and a wrong
 *  (or absent) user-agent guess must never be a dead end. `fallback`
 *  covers both cases, and validate.ts already guarantees every scenario
 *  with variants has one. Exported and pure so it is tested without
 *  mounting anything (see HelpMenu.test.ts, next to `matches` and
 *  `groupScenarios`). */
export function initialVariant(
  detected: HelpEnvironment,
  variants: HelpVariant[],
): HelpEnvironment {
  return variants.some((v) => v.environment === detected) ? detected : "fallback";
}

/** A non-executable scenario has no tour to run — this is what selecting
 *  one shows instead. The detected variant is only ever a starting
 *  point: the picker is a real `<select>`, so a wrong guess costs one
 *  click, never the instructions themselves. */
function VariantPicker({
  scenario,
  onBack,
}: {
  scenario: HelpScenario;
  onBack: () => void;
}) {
  const variants = scenario.variants ?? [];
  // Read once per scenario selection, not on every render — the UA
  // itself never changes mid-session.
  const detected = useMemo(() => detectHelpEnvironment(), []);
  const [environment, setEnvironment] = useState<HelpEnvironment>(() =>
    initialVariant(detected, variants),
  );
  const variant = variants.find((v) => v.environment === environment);

  return (
    <div className="space-y-3" data-testid="help-variant-container">
      <Button variant="ghost" onClick={onBack}>
        ← Back to help topics
      </Button>

      <p className="text-sm font-semibold text-slate-900">{scenario.title}</p>
      {scenario.description !== undefined && (
        <p className="text-xs text-slate-600">{scenario.description}</p>
      )}

      <Select
        label="Your device and browser"
        data-testid="help-variant-picker"
        value={environment}
        onChange={(e) => setEnvironment(e.target.value as HelpEnvironment)}
        options={variants.map((v) => ({ value: v.environment, label: v.label }))}
      />

      {variant !== undefined && (
        <ol className="list-decimal space-y-2 pl-5 text-xs text-slate-700">
          {variant.steps.map((step, index) => (
            <li key={index}>
              {step.title !== undefined && (
                <p className="font-semibold text-slate-900">{step.title}</p>
              )}
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function HelpMenu() {
  const { startScenario } = useHelp();
  const [query, setQuery] = useState("");
  // The one scenario currently showing its variant picker in place of
  // the topic list, or null when the list itself is showing. A
  // non-executable scenario has no tour to hand to `startScenario`, so
  // picking one switches this instead of calling it.
  const [variantScenario, setVariantScenario] = useState<HelpScenario | null>(
    null,
  );

  const grouped = useMemo(() => groupScenarios(query), [query]);

  if (variantScenario !== null) {
    return (
      <VariantPicker
        scenario={variantScenario}
        onBack={() => setVariantScenario(null)}
      />
    );
  }

  return (
    <div className="space-y-3 py-3">
      <Input
        type="search"
        value={query}
        aria-label="Search help topics"
        placeholder="Search help"
        data-testid="help-search"
        onChange={(e) => setQuery(e.target.value)}
      />

      {/* Two different empties: nothing registered at all is not a
          search that missed, and saying "matches" would blame a query
          nobody typed. */}
      {helpScenarios.length === 0 ? (
        <p className="text-xs text-slate-600" data-testid="help-empty">
          No help topics yet.
        </p>
      ) : (
        grouped.length === 0 && (
          <p className="text-xs text-slate-600">No help topic matches that.</p>
        )
      )}

      {grouped.map(({ category, scenarios }) => (
        <div key={category} className="space-y-1">
          <p className="text-xs font-semibold text-slate-600">
            {CATEGORY_LABELS[category]}
          </p>
          {scenarios.map((scenario) => (
            <Button
              key={scenario.id}
              variant="ghost"
              // Full width and left-aligned: a topic list reads down its
              // left edge. feedme2's Button has no `block` prop (gigsy's
              // does); `cn` merges these after the base classes.
              className="block w-full text-left"
              data-testid={`help-start-${scenario.id}`}
              onClick={() =>
                scenario.executable === false
                  ? setVariantScenario(scenario)
                  : void startScenario(scenario.id)
              }
            >
              {scenario.title}
            </Button>
          ))}
        </div>
      ))}
    </div>
  );
}
