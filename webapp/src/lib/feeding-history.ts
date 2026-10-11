import type { InfiniteData } from "@tanstack/react-query";
import type { Feeding, FeedingCreate, FeedingPatch, FeedingsPage, FoodUnit } from "@feedme2/shared";

const MINUTE_MS = 60_000;

/**
 * The edit sheet's datetime-local input has minute precision, so saving an
 * untouched time would silently drop the seconds (and shift the feeding in the
 * history ordering). When the edited time is in the same minute as the
 * original, the user did not change it: keep the original exactly.
 */
export function keepFedAtIfSameMinute(editedFedAt: number, originalFedAt: number): number {
  return Math.floor(editedFedAt / MINUTE_MS) === Math.floor(originalFedAt / MINUTE_MS) ? originalFedAt : editedFedAt;
}

/**
 * Replace (or, with null, drop) one feeding in an infinite history cache, so
 * an edit made offline shows immediately. Pages that do not hold the feeding
 * are returned as-is.
 */
export function replaceFeeding(data: InfiniteData<FeedingsPage> | undefined, id: string, next: Feeding | null): InfiniteData<FeedingsPage> | undefined {
  if (!data) return data;
  return {
    ...data,
    pages: data.pages.map((page) => {
      if (!page.items.some((x) => x.id === id)) return page;
      const items = next === null
        ? page.items.filter((x) => x.id !== id)
        : page.items.map((x) => (x.id === id ? next : x)).sort((a, b) => b.fedAt - a.fedAt || (a.id < b.id ? 1 : -1));
      return { ...page, items };
    }),
  };
}

/** Wall-clock time in the house's timezone, so every phone shows the same feeding time. */
export function formatFedAt(ms: number, timeZone: string, locale?: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date(ms));
}

/**
 * The minimal PATCH for an edit. Resending untouched fields rewrote the stored
 * entered text and the exact feeding time (the input has minute precision), so
 * only what the user changed goes out. Empty means nothing to save.
 */
export function editPatch(original: Feeding, item: FeedingCreate): FeedingPatch {
  const patch: FeedingPatch = {};
  if (item.catId !== original.catId) patch.catId = item.catId;
  const fedAt = keepFedAtIfSameMinute(item.fedAt, original.fedAt);
  if (fedAt !== original.fedAt) patch.fedAt = fedAt;
  // The server wants the three amount fields as one unit, and only when the amount really changed.
  if (item.amountMg !== original.amountMg) {
    patch.amountMg = item.amountMg;
    patch.enteredUnit = item.enteredUnit;
    patch.enteredValue = item.enteredValue;
  }
  const note = item.note ?? null;
  if (note !== original.note) patch.note = note;
  return patch;
}

/** The feeding as it will look once `patch` is applied (for the optimistic cache). */
export function applyPatch(original: Feeding, patch: FeedingPatch): Feeding {
  const next: Feeding = { ...original };
  if (patch.catId !== undefined) next.catId = patch.catId;
  if (patch.fedAt !== undefined) next.fedAt = patch.fedAt;
  if (patch.amountMg !== undefined) next.amountMg = patch.amountMg;
  if (patch.enteredUnit !== undefined) next.enteredUnit = patch.enteredUnit;
  if (patch.enteredValue !== undefined) next.enteredValue = patch.enteredValue;
  if (patch.note !== undefined) next.note = patch.note;
  return next;
}

/** "entered as" text, only when it was entered in a different unit than the one shown. */
export function enteredAsText(f: Feeding, displayUnit: FoodUnit): string | null {
  return f.enteredUnit === displayUnit ? null : `${f.enteredValue} ${f.enteredUnit}`;
}
