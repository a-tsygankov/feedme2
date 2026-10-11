import { useState, type ReactNode } from "react";
import type { Cat, Feeding, FeedingCreate, House } from "@feedme2/shared";
import { textForMg } from "../lib/amount-stepper.ts";
import { AmountStepper } from "./AmountStepper.tsx";
import { Button } from "./Button.tsx";
import { Sheet } from "./Sheet.tsx";

interface Props {
  house: House;
  cats: Cat[];
  /** undefined = "Feed all" */
  initialCatId: string | undefined;
  onClose: () => void;
  onSubmit: (items: FeedingCreate[]) => Promise<void> | void;
  /** Edit mode: one existing feeding, so no "All cats" and the item keeps its id. */
  editing?: Feeding;
}

const FALLBACK_MG = 40_000;
const AGO = [0, 5, 15, 30] as const;

/** datetime-local wants local wall-clock time, which toISOString() (UTC) would shift. */
function localInputValue(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function FeedSheet({ house, cats, initialCatId, onClose, onSubmit, editing }: Props) {
  const s = house.settings;
  const [catId, setCatId] = useState(initialCatId);
  const selected = cats.filter((c) => catId === undefined || c.id === catId);
  const first = selected[0];
  const [mg, setMg] = useState(editing?.amountMg ?? first?.defaultAmountMg ?? FALLBACK_MG);
  const [agoMin, setAgoMin] = useState<number>(0);
  const [customTime, setCustomTime] = useState(editing ? localInputValue(editing.fedAt) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  const [busy, setBusy] = useState(false);

  const fedAt = customTime ? new Date(customTime).getTime() : Date.now() - agoMin * 60_000;

  async function submit() {
    setBusy(true);
    const { enteredUnit, enteredValue } = textForMg(mg, s.foodUnit, s);
    const items: FeedingCreate[] = selected.map((c) => ({
      id: editing?.id ?? crypto.randomUUID(), catId: c.id, fedAt,
      amountMg: catId === undefined ? (c.defaultAmountMg ?? mg) : mg,
      enteredUnit, enteredValue, ...(note.trim() ? { note: note.trim() } : {}),
    }));
    await onSubmit(items);
    setBusy(false);
    onClose();
  }

  return (
    <Sheet title={editing ? "Edit feeding" : catId === undefined ? "Feed everyone" : `Feed ${first?.name ?? ""}`} onClose={onClose} testId="feed-sheet">
      {cats.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="feed-cat-chips">
          {editing ? null : <Chip active={catId === undefined} onClick={() => setCatId(undefined)}>All cats</Chip>}
          {/* Editing keeps the recorded amount when the cat is switched. */}
          {cats.map((c) => <Chip key={c.id} active={catId === c.id} onClick={() => { setCatId(c.id); if (!editing) setMg(c.defaultAmountMg ?? FALLBACK_MG); }}>{c.name}</Chip>)}
        </div>
      ) : null}
      {catId === undefined ? (
        <p className="text-sm text-slate-600">Each cat gets its usual amount.</p>
      ) : (
        <AmountStepper mg={mg} unit={s.foodUnit} settings={s} onChange={setMg} />
      )}
      <div className="mt-4 flex flex-wrap gap-2" data-testid="feed-time-chips">
        {AGO.map((m) => <Chip key={m} active={!customTime && agoMin === m} onClick={() => { setCustomTime(""); setAgoMin(m); }}>{m === 0 ? "Now" : `${m} min ago`}</Chip>)}
        <input type="datetime-local" aria-label="Custom time" value={customTime} onChange={(e) => setCustomTime(e.target.value)} className="rounded-xl border border-slate-300 px-2 text-sm" />
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" maxLength={200}
        className="mt-4 block w-full rounded-xl border border-slate-300 px-3 py-2 text-sm" data-testid="feed-note" />
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy || selected.length === 0} data-testid="feed-submit">{editing ? "Save changes" : "Log feeding"}</Button>
    </Sheet>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`rounded-full border px-3 py-1.5 text-sm ${active ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600"}`}>
      {children}
    </button>
  );
}
