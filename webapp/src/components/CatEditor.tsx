import { useState } from "react";
import { AvatarPoseSchema, CAT_COLORS, type Cat, type CatColor, type CatCreate, type CatPatch } from "@feedme2/shared";
import { POSE_LABELS } from "../lib/pose.ts";
import { Button } from "./Button.tsx";
import { CatFigure } from "./CatFigure.tsx";
import { Field } from "./Field.tsx";
import { Sheet } from "./Sheet.tsx";

interface Props {
  cat: Cat | null;
  defaultHungryAfterSec: number;
  onClose: () => void;
  onSave: (input: CatCreate | { id: string; patch: CatPatch }) => Promise<void>;
}

export function CatEditor({ cat, defaultHungryAfterSec, onClose, onSave }: Props) {
  const [name, setName] = useState(cat?.name ?? "");
  const [color, setColor] = useState<CatColor>(cat?.color ?? CAT_COLORS[0]);
  const [pose, setPose] = useState(cat?.avatarPose ?? "C2");
  const [hours, setHours] = useState((cat?.hungryAfterSec ?? defaultHungryAfterSec) / 3600);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (name.trim().length === 0) { setError("Give the cat a name."); return; }
    if (!Number.isFinite(hours) || hours < 1 || hours > 24) { setError("Hungry-after must be between 1 and 24 hours."); return; }
    setBusy(true);
    try {
      const hungryAfterSec = Math.round(hours * 3600);
      if (cat) await onSave({ id: cat.id, patch: { name: name.trim(), color, avatarPose: pose, hungryAfterSec } });
      else await onSave({ id: crypto.randomUUID(), name: name.trim(), color, avatarPose: pose, hungryAfterSec });
      onClose();
    } catch (err) {
      setError(`Could not save: ${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet title={cat ? `Edit ${cat.name}` : "Add a cat"} onClose={onClose} testId="cat-editor">
      <div className="space-y-4">
        <Field label="Name" value={name} onChange={(e) => setName(e.target.value)} maxLength={32} data-testid="cat-name" />
        <div>
          <span className="text-sm font-medium text-slate-700">Colour</span>
          <div className="mt-2 flex flex-wrap gap-2" data-testid="cat-colors">
            {CAT_COLORS.map((c) => (
              <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)}
                className={`h-9 w-9 rounded-full border-4 ${color === c ? "border-slate-900" : "border-transparent"}`} style={{ backgroundColor: c }} />
            ))}
          </div>
        </div>
        <div>
          <span className="text-sm font-medium text-slate-700">Avatar</span>
          <div className="mt-2 flex flex-wrap gap-3" data-testid="cat-poses">
            {AvatarPoseSchema.options.map((p) => (
              <button key={p} type="button" aria-label={POSE_LABELS[p]} aria-pressed={pose === p} onClick={() => setPose(p)}
                className={`rounded-xl border-2 p-1 ${pose === p ? "border-emerald-600" : "border-transparent"}`}>
                <CatFigure pose={p} color={color} size={56} />
              </button>
            ))}
          </div>
        </div>
        <Field label="Hungry after (hours)" type="number" min={1} max={24} step={0.5} value={hours} onChange={(e) => setHours(Number(e.target.value))} data-testid="cat-hungry-after" />
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <Button className="w-full" onClick={() => void save()} disabled={busy} data-testid="cat-save">{cat ? "Save" : "Add cat"}</Button>
      </div>
    </Sheet>
  );
}
