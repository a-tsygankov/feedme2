import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { CanFractionStepSchema, FoodUnitSchema, MAX_CATS, type Cat, type CatCreate, type CatPatch } from "@feedme2/shared";
import { AppHeader } from "../components/AppHeader.tsx";
import { TabBar } from "../components/TabBar.tsx";
import { Button } from "../components/Button.tsx";
import { Field } from "../components/Field.tsx";
import { Select } from "../components/Select.tsx";
import { CatEditor } from "../components/CatEditor.tsx";
import { CatFigure } from "../components/CatFigure.tsx";
import { useHouse, usePatchHouse } from "../hooks/use-house.ts";
import { useCatMutations, useCats } from "../hooks/use-cats.ts";
import { api, ApiError } from "../lib/api-client.ts";
import { authStore } from "../lib/auth-store.ts";
import { CAN_PRESETS, formFromSettings, settingsPatchFromForm, type SettingsForm } from "../lib/settings-form.ts";

export function Settings() {
  const house = useHouse();
  const patchHouse = usePatchHouse();
  const cats = useCats();
  const catMut = useCatMutations();
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Cat | null | "new">(null);
  const [pinForm, setPinForm] = useState({ current: "", next: "" });
  const [pinMsg, setPinMsg] = useState<string | null>(null);

  if (!house.data) return <p className="p-4 text-sm text-slate-500">Loading…</p>;
  const h = house.data;
  const settings = h.settings;
  const form: SettingsForm = formFromSettings(settings);

  function apply(partial: Partial<SettingsForm>) {
    const patch = settingsPatchFromForm({ ...form, ...partial }, settings);
    // The server rejects an empty patch, so an untouched field must not send anything.
    if (Object.keys(patch).length > 0) patchHouse.mutate(patch);
  }

  async function saveCat(input: CatCreate | { id: string; patch: CatPatch }) {
    if ("patch" in input) await catMut.patch.mutateAsync(input);
    else await catMut.create.mutateAsync(input);
  }

  async function changePin() {
    try {
      await api.changePin(pinForm.current, pinForm.next);
      setPinMsg("PIN changed. Other phones must sign in again.");
      setPinForm({ current: "", next: "" });
    } catch (err) {
      setPinMsg(err instanceof ApiError && err.status === 401 ? "Current PIN is wrong." : "Could not change the PIN.");
    }
  }

  async function signOut() {
    const refresh = authStore.getRefreshToken();
    try { if (refresh) await api.logout(refresh); } catch { /* signing out anyway */ }
    authStore.signOut();
    navigate("/login", { replace: true });
  }

  const preset = CAN_PRESETS.find((p) => p.mg === settings.canSizeMg);

  return (
    <div className="mx-auto min-h-dvh max-w-lg pb-24" data-testid="settings">
      <AppHeader />
      <main className="space-y-8 px-4">
        {patchHouse.isError ? <p className="text-sm text-red-600" role="alert">Could not save that setting. Check the value and try again.</p> : null}
        <Section title="House">
          <Field label="House name" defaultValue={h.name} maxLength={32} data-testid="house-name"
            onBlur={(e) => { const name = e.target.value.trim(); if (name && name !== h.name) patchHouse.mutate({ name }); }} />
          <div className="mt-4 space-y-2">
            <Field label="Current PIN" type="password" inputMode="numeric" value={pinForm.current} onChange={(e) => setPinForm({ ...pinForm, current: e.target.value })} />
            <Field label="New PIN" type="password" inputMode="numeric" value={pinForm.next} onChange={(e) => setPinForm({ ...pinForm, next: e.target.value })} />
            <Button variant="secondary" onClick={() => void changePin()} disabled={!pinForm.current || !pinForm.next}>Change PIN</Button>
            {pinMsg ? <p className="text-sm text-slate-600">{pinMsg}</p> : null}
          </div>
        </Section>

        <Section title="Units">
          <Select label="Food unit" value={settings.foodUnit} data-testid="food-unit" onChange={(e) => apply({ foodUnit: FoodUnitSchema.parse(e.target.value) })}
            options={[{ value: "g", label: "Grams" }, { value: "oz", label: "Ounces" }, { value: "can", label: "Cans" }]} />
          <Select label="Can size" value={preset ? String(preset.mg) : "custom"} data-testid="can-size"
            onChange={(e) => { if (e.target.value !== "custom") apply({ canSizeGrams: Number(e.target.value) / 1000 }); }}
            options={[...CAN_PRESETS.map((p) => ({ value: String(p.mg), label: p.label })), { value: "custom", label: `Custom (${settings.canSizeMg / 1000} g)` }]} />
          <Field label="Custom can size (grams)" type="number" min={10} max={1000} defaultValue={settings.canSizeMg / 1000} data-testid="can-size-grams"
            onBlur={(e) => apply({ canSizeGrams: Number(e.target.value) })} />
          <Select label="Can fraction step" value={settings.canFractionStep} data-testid="can-step" onChange={(e) => apply({ canFractionStep: CanFractionStepSchema.parse(e.target.value) })}
            options={[{ value: "1/4", label: "¼ can" }, { value: "1/3", label: "⅓ can" }, { value: "1/2", label: "½ can" }]} />
          <Select label="Gram step" value={String(settings.gramStep)} onChange={(e) => apply({ gramStep: Number(e.target.value) as 1 | 5 | 10 })}
            options={[{ value: "1", label: "1 g" }, { value: "5", label: "5 g" }, { value: "10", label: "10 g" }]} />
          <Select label="Ounce step" value={String(settings.ozStepHundredths)} onChange={(e) => apply({ ozStepHundredths: Number(e.target.value) as 25 | 50 })}
            options={[{ value: "25", label: "¼ oz" }, { value: "50", label: "½ oz" }]} />
        </Section>

        <Section title="Defaults and device">
          <Field label="Hungry after (hours, new cats)" type="number" min={1} max={24} step={0.5} defaultValue={form.hungryAfterHours} onBlur={(e) => apply({ hungryAfterHours: Number(e.target.value) })} />
          <Field label="Timezone" defaultValue={settings.timezone} onBlur={(e) => apply({ timezone: e.target.value.trim() })} hint={`This phone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`} />
          <Field label="Device sleep timeout (seconds)" type="number" min={60} max={3600} step={30} defaultValue={settings.sleepTimeoutSec} onBlur={(e) => apply({ sleepTimeoutSec: Number(e.target.value) })} />
          <Field label="Device sync interval (hours)" type="number" min={1} max={24} defaultValue={settings.syncIntervalSec / 3600} onBlur={(e) => apply({ syncIntervalSec: Number(e.target.value) * 3600 })} />
        </Section>

        <Section title="Cats" id="cats">
          <ul className="space-y-2" data-testid="cat-list">
            {cats.data?.map((c, i, all) => (
              <li key={c.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2" data-testid="cat-row">
                <CatFigure pose={c.avatarPose} color={c.color} size={40} />
                <span className="flex-1 truncate font-medium text-slate-900">{c.name}</span>
                <Button variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => catMut.patch.mutate({ id: c.id, patch: { sortOrder: i - 1 } })}>↑</Button>
                <Button variant="ghost" aria-label="Move down" disabled={i === all.length - 1} onClick={() => catMut.patch.mutate({ id: c.id, patch: { sortOrder: i + 1 } })}>↓</Button>
                <Button variant="secondary" onClick={() => setEditing(c)} data-testid="cat-edit">Edit</Button>
                <Button variant="ghost" aria-label={`Remove ${c.name}`} disabled={all.length <= 1} data-testid="cat-remove"
                  onClick={() => { if (confirm(`Remove ${c.name}? Feedings are kept.`)) catMut.remove.mutate(c.id); }}>✕</Button>
              </li>
            ))}
          </ul>
          <Button className="mt-3" onClick={() => setEditing("new")} disabled={(cats.data?.length ?? 0) >= MAX_CATS} data-testid="cat-add">Add a cat</Button>
        </Section>

        <Section title="Session">
          <Button variant="secondary" onClick={() => void signOut()} data-testid="sign-out">Sign out</Button>
        </Section>
      </main>
      {editing !== null ? (
        <CatEditor cat={editing === "new" ? null : editing} defaultHungryAfterSec={settings.hungryAfterSecDefault} onClose={() => setEditing(null)} onSave={saveCat} />
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
