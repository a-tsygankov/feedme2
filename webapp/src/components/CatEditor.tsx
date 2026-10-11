import { useState } from "react";
import { AvatarPoseSchema, CAT_COLORS, type Cat, type CatColor, type CatCreate, type CatPatch } from "@feedme2/shared";
import { POSE_LABELS } from "../lib/pose.ts";
import { catSaveError, colorName, defaultColor, parseHours } from "../lib/cat-editor.ts";
import { Button } from "./Button.tsx";
import { CatFigure } from "./CatFigure.tsx";
import { Field } from "./Field.tsx";
import { Sheet } from "./Sheet.tsx";

interface Props {
  cat: Cat | null;
  defaultHungryAfterSec: number;
  /** Colours the other cats already use: the default skips them and their swatches are marked. */
  takenColors: readonly string[];
  onClose: () => void;
  onSave: (input: CatCreate | { id: string; patch: CatPatch }) => Promise<void>;
}

export function CatEditor({ cat, defaultHungryAfterSec, takenColors, onClose, onSave }: Props) {
  // Once per editor instance, not per tap: if the create reached the server but the response was lost,
  // the retry re-sends the same id and the server's idempotent create absorbs it instead of adding a second cat.
  const [newId] = useState(() => crypto.randomUUID());
  const [name, setName] = useState(cat?.name ?? "");
  const [color, setColor] = useState<CatColor>(cat?.color ?? defaultColor(takenColors));
  const [pose, setPose] = useState(cat?.avatarPose ?? "C2");
  // A string, so clearing the box to retype does not snap to 0 and a half-typed "1." survives.
  const [hours, setHours] = useState(String((cat?.hungryAfterSec ?? defaultHungryAfterSec) / 3600));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  const [hoursError, setHoursError] = useState<string | undefined>(undefined);

  async function save() {
    setError(null); setNameError(undefined); setHoursError(undefined);
    const trimmed = name.trim();
    const h = parseHours(hours);
    if (trimmed.length === 0) { setNameError("Give the cat a name."); return; }
    if (h === null) { setHoursError("Hungry-after must be between 1 and 24 hours."); return; }
    setBusy(true);
    try {
      const hungryAfterSec = Math.round(h * 3600);
      if (cat) await onSave({ id: cat.id, patch: { name: trimmed, color, avatarPose: pose, hungryAfterSec } });
      else await onSave({ id: newId, name: trimmed, color, avatarPose: pose, hungryAfterSec });
      onClose();
    } catch (err) {
      const e = catSaveError(err, cat === null);
      if (e.field === "name") setNameError(e.message);
      else if (e.field === "hours") setHoursError(e.message);
      else setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={cat ? `Edit ${cat.name}` : "Add a cat"} onClose={onClose} testId="cat-editor" dismissable={!busy}>
      <div className="space-y-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} error={nameError} data-testid="cat-name" />
        <div>
          <span className="text-sm font-medium text-slate-700">Colour</span>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="cat-colors">
            {CAT_COLORS.map((c) => {
              const taken = takenColors.includes(c) && c !== cat?.color;
              return (
                <button key={c} type="button" aria-label={`${colorName(c)}${taken ? " (used by another cat)" : ""}`} aria-pressed={color === c}
                  title={taken ? "Used by another cat" : colorName(c)} onClick={() => setColor(c)}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-4 text-lg font-bold ${color === c ? "border-slate-900" : "border-transparent"} ${taken ? "opacity-50" : ""}`}
                  // Swatch colours are data, fixed hex values: the check mark is white on all of them in both themes.
                  style={{ backgroundColor: c, color: "#fff" }}>
                  {color === c ? "✓" : ""}
                </button>
              );
            })}
          </div>
        </div>
        <div>
          <span className="text-sm font-medium text-slate-700">Avatar</span>
          <div className="mt-2 flex flex-wrap gap-3" data-testid="cat-poses">
            {AvatarPoseSchema.options.map((p) => (
              <button key={p} type="button" aria-label={POSE_LABELS[p]} aria-pressed={pose === p} onClick={() => setPose(p)}
                className={`min-h-[44px] min-w-[44px] rounded-xl border-2 p-1 ${pose === p ? "border-emerald-600" : "border-transparent"}`}>
                <CatFigure pose={p} color={color} size={56} />
              </button>
            ))}
          </div>
        </div>
        <Field label="Hungry after (hours)" type="number" inputMode="decimal" min={1} max={24} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} error={hoursError} data-testid="cat-hungry-after" />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <Button className="w-full" onClick={() => void save()} disabled={busy} data-testid="cat-save">{cat ? "Save" : "Add cat"}</Button>
      </div>
    </Sheet>
  );
}
