import { useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Cat, Feeding, FeedingCreate, House } from "@feedme2/shared";
import { buildFeedItems, fedAtFrom, localInputValue, timeProblem } from "../lib/feed-items.ts";
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

const INPUT = "min-h-[44px] rounded-xl border border-slate-300 bg-white px-3 text-base text-slate-900";

export function FeedSheet({ house, cats, initialCatId, onClose, onSubmit, editing }: Props) {
  const s = house.settings;
  const [catId, setCatId] = useState(initialCatId);
  const selected = cats.filter((c) => catId === undefined || c.id === catId);
  const first = selected[0];
  const [mg, setMg] = useState(editing?.amountMg ?? first?.defaultAmountMg ?? FALLBACK_MG);
  const [agoMin, setAgoMin] = useState<number>(0);
  const [customTime, setCustomTime] = useState(editing ? localInputValue(editing.fedAt) : "");
  const [note, setNote] = useState(editing?.note ?? "");
  // The time input holds minutes, so round-tripping an untouched edit through it loses the seconds (and, around a DST
  // change, can land an hour off). Until the user picks a time, an edit keeps editing.fedAt exactly.
  const [timeTouched, setTimeTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // One id per cat for the life of the sheet: if onSubmit succeeded server-side but the response was lost, the retry
  // re-sends the same ids and the server's idempotent create absorbs it instead of logging a second feeding.
  const idCache = useRef(new Map<string, string>());
  const idFor = (id: string) => {
    if (editing) return editing.id;
    let v = idCache.current.get(id);
    if (v === undefined) { v = crypto.randomUUID(); idCache.current.set(id, v); }
    return v;
  };

  // Render-time clock is only for the picker's `max` and the inline hint; submit() re-reads the clock itself.
  const renderNow = Date.now();
  const keepTime = editing !== undefined && !timeTouched;
  const problem = customTime && !keepTime ? timeProblem(fedAtFrom({ customTime, agoMin, now: renderNow }), renderNow) : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    // Read at tap time, not render time: a sheet left open for ten minutes must not log "Now" as ten minutes ago.
    const now = Date.now();
    const fedAt = keepTime ? editing.fedAt : fedAtFrom({ customTime, agoMin, now });
    const bad = keepTime ? null : timeProblem(fedAt, now);
    if (bad) { setError(bad); return; }
    setBusy(true);
    setError(null);
    try {
      await onSubmit(buildFeedItems({ cats, catId, mg, fedAt, unit: s.foodUnit, settings: s, note, ids: idFor }));
      onClose();
    } catch {
      setError("Couldn't log the feeding. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const shownError = problem ?? error;
  return (
    <Sheet title={editing ? "Edit feeding" : catId === undefined ? "Feed everyone" : `Feed ${first?.name ?? ""}`} onClose={onClose} testId="feed-sheet" dismissable={!busy}>
      <form onSubmit={(e) => void submit(e)} noValidate>
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
        <div className="mt-4 flex flex-wrap items-center gap-2" data-testid="feed-time-chips">
          {AGO.map((m) => <Chip key={m} active={!customTime && agoMin === m} onClick={() => { setTimeTouched(true); setCustomTime(""); setAgoMin(m); setError(null); }}>{m === 0 ? "Now" : `${m} min ago`}</Chip>)}
          {/* Active exactly when the picker holds a value; clearing the picker hands the highlight back to the last ago chip. */}
          <Chip active={customTime !== ""} onClick={() => { if (!customTime) { setTimeTouched(true); setCustomTime(localInputValue(Date.now())); setError(null); } }}>Custom</Chip>
          <input type="datetime-local" aria-label="Custom time" value={customTime} max={localInputValue(renderNow)}
            onChange={(e) => { setTimeTouched(true); setCustomTime(e.target.value); setError(null); }} className={INPUT} data-testid="feed-custom-time" />
        </div>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Note" maxLength={200}
          className={`mt-4 block w-full py-2 ${INPUT}`} data-testid="feed-note" />
        {shownError ? <p className="mt-3 text-sm text-red-600" role="alert" data-testid="feed-error">{shownError}</p> : null}
        <Button type="submit" className="mt-4 w-full" disabled={busy || selected.length === 0 || problem !== null} data-testid="feed-submit">
          {editing ? "Save changes" : "Log feeding"}
        </Button>
      </form>
    </Sheet>
  );
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={`min-h-[44px] rounded-full border px-3 py-1.5 text-sm ${active ? "border-emerald-600 bg-emerald-50 text-emerald-700" : "border-slate-300 text-slate-600"}`}>
      {children}
    </button>
  );
}
