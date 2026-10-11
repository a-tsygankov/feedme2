import { CAT_COLORS, MAX_CATS, type CatColor } from "@feedme2/shared";

const NAMES: Record<CatColor, string> = {
  "#4CAF50": "Green", "#2196F3": "Blue", "#E91E63": "Pink", "#8B4513": "Brown",
  "#FF9800": "Orange", "#9C27B0": "Purple", "#00BCD4": "Cyan", "#607D8B": "Slate",
};

/** Screen readers announced the swatches as hex codes; they need names. */
export const colorName = (c: CatColor): string => NAMES[c];

/** A new cat starts on a colour no other cat uses, so the dashboard tells them apart at a glance. */
export function defaultColor(taken: readonly string[]): CatColor {
  return CAT_COLORS.find((c) => !taken.includes(c)) ?? CAT_COLORS[0];
}

/** Hours from the text field (kept as a string so a half-typed "1." survives); null when unusable or outside 1–24. */
export function parseHours(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 24 ? n : null;
}

export interface CatSaveError { field: "name" | "hours" | null; message: string }

/** Duck-typed so this module does not import the api client (it reads storage at import time). */
export function catSaveError(err: unknown, isNew: boolean): CatSaveError {
  if ((err as { name?: unknown } | null)?.name === "NetworkError") return { field: null, message: "Check your connection." };
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 409 && isNew) return { field: null, message: `You already have ${MAX_CATS} cats.` };
  if (status === 404) return { field: null, message: "That cat was removed on another phone." };
  if (status === 400) {
    const issues = (err as { body?: { issues?: Array<{ path?: unknown }> } | null }).body?.issues;
    const path = Array.isArray(issues) ? issues[0]?.path : undefined;
    const first = Array.isArray(path) ? (path as unknown[])[0] : undefined;
    if (first === "name") return { field: "name", message: "Check the name: 1 to 32 characters." };
    if (first === "hungryAfterSec") return { field: "hours", message: "Hungry-after must be between 1 and 24 hours." };
    return { field: null, message: "Check the values and try again." };
  }
  return { field: null, message: "Couldn't save. Try again." };
}
