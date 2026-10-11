import { useEffect, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CanFractionStepSchema, FoodUnitSchema, MAX_CATS, type Cat, type CatCreate, type CatPatch } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { Button } from "../components/Button.tsx";
import { Field } from "../components/Field.tsx";
import { Select } from "../components/Select.tsx";
import { CatEditor } from "../components/CatEditor.tsx";
import { CatFigure } from "../components/CatFigure.tsx";
import { useHouse, usePatchHouse } from "../hooks/use-house.ts";
import { catsKey, useCatMutations, useCats } from "../hooks/use-cats.ts";
import { api } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { moveCat, orderChanges } from "../lib/cat-order.ts";
import {
  CAN_PRESETS, canSizeMgFromGrams, deleteCatOutcome, formFromSettings, pinChangeFailure, pinChangeSuccess, pinFormError,
  presetForMg, settingsPatchFromForm, type SettingsErrors, type SettingsForm,
} from "../lib/settings-form.ts";

/** Free-text numeric fields and the timezone: held as typed until blur, then validated and saved. */
type Draft = Partial<Pick<SettingsForm, "hungryAfterHours" | "canSizeGrams" | "sleepTimeoutSec" | "syncIntervalHours" | "timezone">>;
const DRAFT_KEYS = ["hungryAfterHours", "canSizeGrams", "sleepTimeoutSec", "syncIntervalHours", "timezone"] as const;

// Same list the browser's own pickers use; older engines lack supportedValuesOf, so the field degrades to free text.
const TIMEZONES: string[] = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];

export function Settings() {
  const house = useHouse();
  const patchHouse = usePatchHouse();
  const cats = useCats();
  const catMut = useCatMutations();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [editing, setEditing] = useState<Cat | null | "new">(null);
  const [pinForm, setPinForm] = useState({ current: "", next: "", confirm: "" });
  const [pinMsg, setPinMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [pinBusy, setPinBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<SettingsErrors>({});
  const [nameError, setNameError] = useState<string | undefined>(undefined);
  /** null = follow the stored size (custom when it matches no preset); the "Custom" option sets true. */
  const [customCan, setCustomCan] = useState<boolean | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [catError, setCatError] = useState<string | null>(null);
  const [reordering, setReordering] = useState(false);

  const ready = !!house.data;
  // "/settings#cats" (the empty dashboard's "Add a cat") must land on the cats section, but the section only exists
  // once the house has loaded, so the browser's own anchor jump cannot do it.
  useEffect(() => {
    if (!ready || !location.hash) return;
    document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, location.hash]);

  // Two-tap delete: the "Really delete?" state reverts on its own so a stray tap later cannot confirm it.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  if (!house.data) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  const h = house.data;
  const settings = h.settings;
  const form: SettingsForm = { ...formFromSettings(settings), ...draft };
  const catList = cats.data ?? [];

  // One source of truth for the can size: the grams text being typed if it is valid, else the stored value.
  const canMg = (draft.canSizeGrams !== undefined ? canSizeMgFromGrams(draft.canSizeGrams) : null) ?? settings.canSizeMg;
  const customMode = customCan ?? !presetForMg(canMg);
  const preset = presetForMg(canMg);

  /** Validate everything, save what is valid and show an inline error for what is not. */
  function commit(partial: Partial<SettingsForm> = {}) {
    const { patch, errors: errs } = settingsPatchFromForm({ ...form, ...partial }, settings);
    setErrors(errs);
    const typed: Draft = {};
    for (const k of DRAFT_KEYS) if (k in partial) (typed as Record<string, string>)[k] = partial[k] as string;
    if (Object.keys(typed).length > 0) setDraft((d) => ({ ...d, ...typed }));
    // Once saved (or unchanged) a field shows the stored value again; one with an error keeps what was typed.
    const settle = () => setDraft((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k in errs)) as Draft);
    // The server rejects an empty patch, so an untouched field must not send anything.
    if (Object.keys(patch).length > 0) patchHouse.mutate(patch, { onSuccess: settle });
    else settle();
  }

  function type(k: keyof Draft, value: string) {
    setDraft((d) => ({ ...d, [k]: value }));
  }

  function saveName(raw: string) {
    const name = raw.trim();
    if (name.length < 2) { setNameError("At least 2 characters."); return; }
    setNameError(undefined);
    if (name !== h.name) patchHouse.mutate({ name });
  }

  async function saveCat(input: CatCreate | { id: string; patch: CatPatch }) {
    if ("patch" in input) await catMut.patch.mutateAsync(input);
    else await catMut.create.mutateAsync(input);
  }

  async function reorder(id: string, dir: -1 | 1) {
    const after = moveCat(catList, id, dir);
    // Writing every cat whose position changed (not just the moved one) is what keeps two cats from sharing a slot.
    const changes = orderChanges(catList, after);
    if (changes.length === 0) return;
    setReordering(true);
    setCatError(null);
    try {
      for (const c of changes) await catMut.patch.mutateAsync({ id: c.id, patch: { sortOrder: c.sortOrder } });
    } catch {
      setCatError("Couldn't reorder the cats. Try again.");
    } finally {
      await qc.invalidateQueries({ queryKey: catsKey });
      setReordering(false);
    }
  }

  function remove(c: Cat) {
    if (armed !== c.id) { setArmed(c.id); return; }
    setArmed(null);
    setCatError(null);
    catMut.remove.mutate(c.id, {
      onError: (err) => {
        const outcome = deleteCatOutcome(err);
        // Already gone (another phone got there first): the list just needs to catch up.
        if (outcome.kind === "gone") void qc.invalidateQueries({ queryKey: catsKey });
        else setCatError(outcome.message);
      },
    });
  }

  async function changePin() {
    const problem = pinFormError(pinForm.current, pinForm.next, pinForm.confirm);
    if (problem) { setPinMsg({ text: problem, ok: false }); return; }
    setPinBusy(true);
    try {
      const res = await api.changePin(pinForm.current, pinForm.next);
      // 200 carries this phone's fresh tokens; an older server answered 204 with no body.
      const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
      const outcome = pinChangeSuccess(res.status, body);
      if (outcome.tokens) authStore.applyTokens(outcome.tokens);
      setPinMsg({ text: outcome.message, ok: true });
      setPinForm({ current: "", next: "", confirm: "" });
    } catch (err) {
      setPinMsg({ text: pinChangeFailure(err), ok: false });
    } finally {
      setPinBusy(false);
    }
  }

  async function signOut() {
    const refresh = authStore.getRefreshToken();
    try { if (refresh) await api.logout(refresh); } catch { /* signing out anyway */ }
    authStore.signOut();
    navigate("/login", { replace: true });
  }

  const unit = settings.foodUnit;
  const takenColors = catList.filter((c) => editing === "new" || c.id !== editing?.id).map((c) => c.color);
  const atMax = catList.length >= MAX_CATS;
  const onlyOne = catList.length <= 1;

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="settings">
      <AppHeader />
      <main className="space-y-8 px-4">
        <p className="min-h-5 text-xs text-slate-500" role="status" aria-live="polite" data-testid="save-state">
          {patchHouse.isPending ? "Saving…" : patchHouse.isSuccess ? "Saved" : ""}
        </p>
        {patchHouse.isError ? <p className="text-sm text-red-600" role="alert">Could not save that setting. Check the value and try again.</p> : null}
        <Section title="House">
          <Field label="House name" defaultValue={h.name} maxLength={32} error={nameError} data-testid="house-name" onBlur={(e) => saveName(e.target.value)} />
          <div className="mt-4 space-y-2">
            <Field label="Current PIN" type="password" inputMode="numeric" autoComplete="current-password" value={pinForm.current} onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })} />
            <Field label="New PIN" type="password" inputMode="numeric" autoComplete="new-password" hint="4 to 12 digits" value={pinForm.next} onChange={(e) => setPinForm({ ...pinForm, next: e.target.value })} />
            <Field label="Confirm new PIN" type="password" inputMode="numeric" autoComplete="new-password" value={pinForm.confirm} onChange={(e) => setPinForm({ ...pinForm, confirm: e.target.value })} />
            <Button variant="secondary" onClick={() => void changePin()} disabled={pinBusy || !pinForm.current || !pinForm.next || !pinForm.confirm}>Change PIN</Button>
            {pinMsg ? <p className={`text-sm ${pinMsg.ok ? "text-slate-600" : "text-red-600"}`} role={pinMsg.ok ? "status" : "alert"}>{pinMsg.text}</p> : null}
          </div>
        </Section>

        <Section title="Units">
          <Select label="Food unit" value={unit} data-testid="food-unit" onChange={(e) => patchHouse.mutate({ foodUnit: FoodUnitSchema.parse(e.target.value) })}
            options={[{ value: "g", label: "Grams" }, { value: "oz", label: "Ounces" }, { value: "can", label: "Cans" }]} />
          {/* Only the controls the chosen unit actually uses. */}
          {unit === "g" ? (
            <Select label="Gram step" value={String(form.gramStep)} onChange={(e) => commit({ gramStep: Number(e.target.value) as 1 | 5 | 10 })}
              options={[{ value: "1", label: "1 g" }, { value: "5", label: "5 g" }, { value: "10", label: "10 g" }]} />
          ) : null}
          {unit === "oz" ? (
            <Select label="Ounce step" value={String(form.ozStepHundredths)} onChange={(e) => commit({ ozStepHundredths: Number(e.target.value) as 25 | 50 })}
              options={[{ value: "25", label: "¼ oz" }, { value: "50", label: "½ oz" }]} />
          ) : null}
          {unit === "can" ? (
            <>
              <Select label="Can size" value={customMode ? "custom" : String(preset?.mg ?? "custom")} data-testid="can-size"
                onChange={(e) => {
                  if (e.target.value === "custom") {
                    setCustomCan(true);
                    // After React has rendered the grams field.
                    requestAnimationFrame(() => document.getElementById("can-size-grams")?.focus());
                    return;
                  }
                  setCustomCan(false);
                  commit({ canSizeGrams: String(Number(e.target.value) / 1000) });
                }}
                options={[...CAN_PRESETS.map((p) => ({ value: String(p.mg), label: p.label })), { value: "custom", label: `Custom (${canMg / 1000} g)` }]} />
              {customMode ? (
                <Field id="can-size-grams" label="Custom can size (grams)" type="number" inputMode="decimal" min={10} max={1000} step="any" value={form.canSizeGrams} error={errors.canSizeGrams}
                  data-testid="can-size-grams" onChange={(e) => type("canSizeGrams", e.target.value)} onBlur={() => commit()} />
              ) : null}
              <Select label="Can fraction step" value={settings.canFractionStep} data-testid="can-step" onChange={(e) => patchHouse.mutate({ canFractionStep: CanFractionStepSchema.parse(e.target.value) })}
                options={[{ value: "1/4", label: "¼ can" }, { value: "1/3", label: "⅓ can" }, { value: "1/2", label: "½ can" }]} />
            </>
          ) : null}
        </Section>

        <Section title="Defaults and device">
          <Field label="Hungry after (hours, new cats)" type="number" inputMode="decimal" min={1} max={24} step="any" value={form.hungryAfterHours} error={errors.hungryAfterHours}
            onChange={(e) => type("hungryAfterHours", e.target.value)} onBlur={() => commit()} />
          <Field label="Timezone" list={TIMEZONES.length > 0 ? "timezones" : undefined} autoCapitalize="none" autoCorrect="off" spellCheck={false} value={form.timezone} error={errors.timezone}
            onChange={(e) => type("timezone", e.target.value)} onBlur={() => commit()} hint={`This phone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} />
          {TIMEZONES.length > 0 ? <datalist id="timezones">{TIMEZONES.map((tz) => <option key={tz} value={tz} />)}</datalist> : null}
          <Field label="Device sleep timeout (seconds)" type="number" inputMode="numeric" min={60} max={3600} step={1} value={form.sleepTimeoutSec} error={errors.sleepTimeoutSec}
            onChange={(e) => type("sleepTimeoutSec", e.target.value)} onBlur={() => commit()} />
          <Field label="Device sync interval (hours)" type="number" inputMode="decimal" min={1} max={24} step="any" value={form.syncIntervalHours} error={errors.syncIntervalHours}
            onChange={(e) => type("syncIntervalHours", e.target.value)} onBlur={() => commit()} />
        </Section>

        <Section title="Cats" id="cats">
          <ul className="space-y-2" data-testid="cat-list">
            {catList.map((c, i, all) => (
              <li key={c.id} className="rounded-xl border border-slate-200 bg-white p-2" data-testid="cat-row">
                {/* Two lines: at 375 px a single row left the name about 30 px. */}
                <div className="flex items-center gap-3">
                  <CatFigure pose={c.avatarPose} color={c.color} size={40} />
                  <span className="min-w-0 flex-1 truncate font-medium text-slate-900">{c.name}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="ghost" aria-label={`Move ${c.name} up`} disabled={i === 0 || reordering} onClick={() => void reorder(c.id, -1)}>↑</Button>
                  <Button variant="ghost" aria-label={`Move ${c.name} down`} disabled={i === all.length - 1 || reordering} onClick={() => void reorder(c.id, 1)}>↓</Button>
                  <Button variant="secondary" onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} data-testid="cat-edit">Edit</Button>
                  <Button variant={armed === c.id ? "danger" : "ghost"} aria-label={armed === c.id ? `Really delete ${c.name}?` : `Delete ${c.name}`} disabled={onlyOne} data-testid="cat-remove"
                    onClick={() => remove(c)}>{armed === c.id ? "Really delete?" : "Delete"}</Button>
                </div>
              </li>
            ))}
          </ul>
          {catError ? <p className="text-sm text-red-600" role="alert">{catError}</p> : null}
          {onlyOne && catList.length === 1 ? <p className="text-xs text-slate-500">A house keeps at least one cat, so the last one can't be deleted. Feedings are kept when a cat is deleted.</p> : null}
          <Button className="mt-3" onClick={() => setEditing("new")} disabled={atMax} data-testid="cat-add">Add a cat</Button>
          {atMax ? <p className="text-xs text-slate-500">A house can have up to {MAX_CATS} cats.</p> : null}
        </Section>

        <Section title="Session">
          <Button variant="secondary" onClick={() => void signOut()} data-testid="sign-out">Sign out</Button>
        </Section>
      </main>
      {editing !== null ? (
        <CatEditor cat={editing === "new" ? null : editing} defaultHungryAfterSec={settings.hungryAfterSecDefault} takenColors={takenColors} onClose={() => setEditing(null)} onSave={saveCat} />
      ) : null}
      <TabBar />
    </div>
  );
}

function Section({ title, id, children }: { title: string; id?: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>
      {children}
    </section>
  );
}
