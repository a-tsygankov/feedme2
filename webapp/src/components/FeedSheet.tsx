import { useState, type ReactNode } from "react";
import type { Cat, FeedingCreate, House } from "@feedme2/shared";
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
}

const FALLBACK_MG = 40_000;
const AGO = [0, 5, 15, 30] as const;

export function FeedSheet({ house, cats, initialCatId, onClose, onSubmit }: Props) {
  const s = house.settings;
  const [catId, setCatId] = useState(initialCatId);
  const selected = cats.filter((c) => catId === undefined || c.id === catId);
  const first = selected[0];
  const [mg, setMg] = useState(first?.defaultAmountMg ?? FALLBACK_MG);
  const [agoMin, setAgoMin] = useState<number>(0);
  const [customTime, setCustomTime] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const fedAt = customTime ? new Date(customTime).getTime() : Date.now() - agoMin * 60_000;

  async function submit() {
    setBusy(true);
    const { enteredUnit, enteredValue } = textForMg(mg, s.foodUnit, s);
    const items: FeedingCreate[] = selected.map((c) => ({
      id: crypto.randomUUID(), catId: c.id, fedAt,
      amountMg: catId === undefined ? (c.defaultAmountMg ?? mg) : mg,
      enteredUnit, enteredValue, ...(note.trim() ? { note: note.trim() } : {}),
    }));
    await onSubmit(items);
    setBusy(false);
    onClose();
  }

  return (
    <Sheet title={catId === undefined ? "Feed everyone" : `Feed ${first?.name ?? ""}`} onClose={onClose} testId="feed-sheet">
      {cats.length > 1 ? (
        <div className="mb-4 flex flex-wrap gap-2" data-testid="feed-cat-chips">
          <Chip active={catId === undefined} onClick={() => setCatId(undefined)}>All cats</Chip>
          {cats.map((c) => <Chip key={c.id} active={catId === c.id} onClick={() => { setCatId(c.id); setMg(c.defaultAmountMg ?? FALLBACK_MG); }}>{c.name}</Chip>)}
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
      <Button className="mt-4 w-full" onClick={() => void submit()} disabled={busy || selected.length === 0} data-testid="feed-submit">Log feeding</Button>
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
