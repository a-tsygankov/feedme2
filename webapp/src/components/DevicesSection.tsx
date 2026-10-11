import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { PAIR_CODE_RE, type Device } from "@feedme2/shared";
import { useDeviceMutations, useDevices } from "../hooks/use-devices.ts";
import { useNow } from "../hooks/use-now.ts";
import { deviceStatusLine, pairErrorMessage } from "../lib/devices-ui.ts";
import { Button } from "./Button.tsx";
import { Field } from "./Field.tsx";

/** The device's QR links to /settings?pair=123456; anything that is not exactly six digits is ignored. */
function codeFromParam(raw: string | null): string {
  return raw !== null && PAIR_CODE_RE.test(raw) ? raw : "";
}

/** Body of the Settings "Devices" section (the heading and anchor live in Settings). */
export function DevicesSection() {
  const devices = useDevices();
  const mut = useDeviceMutations();
  const now = useNow();
  const [params] = useSearchParams();
  const pairParam = params.get("pair");
  const root = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(() => codeFromParam(pairParam));
  const [pairName, setPairName] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairOk, setPairOk] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);

  // Arriving from the QR link: fill the code and bring the section into view (a phone opens Settings at the top).
  useEffect(() => {
    const fromLink = codeFromParam(pairParam);
    if (!fromLink) return;
    setCode(fromLink);
    // jsdom has no scrollIntoView; a mounted test with ?pair= must not throw.
    const el = root.current?.closest("section");
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [pairParam]);

  // Two-tap forget, same pattern as deleting a cat: the armed state reverts so a stray later tap cannot confirm it.
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(t);
  }, [armed]);

  function submitPair(e: FormEvent) {
    e.preventDefault();
    if (!PAIR_CODE_RE.test(code) || mut.confirmPair.isPending) return;
    setPairError(null);
    setPairOk(null);
    const name = pairName.trim();
    mut.confirmPair.mutate(name ? { pairCode: code, name } : { pairCode: code }, {
      onSuccess: ({ device }) => { setPairOk(`Paired ${device.name}`); setCode(""); setPairName(""); },
      onError: (err) => setPairError(pairErrorMessage(err)),
    });
  }

  function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name) return;
    setRowError(null);
    mut.rename.mutate({ id: renaming.id, patch: { name } }, {
      onSuccess: () => setRenaming(null),
      onError: () => setRowError("Couldn't rename the device. Try again."),
    });
  }

  function forget(d: Device) {
    if (armed !== d.id) { setArmed(d.id); return; }
    setArmed(null);
    setRowError(null);
    mut.forget.mutate(d.id, { onError: () => setRowError("Couldn't forget the device. Try again.") });
  }

  const list = devices.data ?? [];
  return (
    <div ref={root} className="space-y-4" data-testid="devices">
      {devices.isError && !devices.data ? <p className="text-sm text-red-600" role="alert">Couldn't load the devices.</p> : null}
      {devices.data && list.length === 0 ? <p className="text-sm text-slate-500">No devices paired yet.</p> : null}
      {list.length > 0 ? (
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.id} className="rounded-xl border border-slate-200 bg-white p-3" data-testid="device-row">
              {renaming?.id === d.id ? (
                <div className="space-y-2">
                  <Field label="Device name" value={renaming.name} maxLength={32} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} data-testid="device-name-input" />
                  <div className="flex gap-2">
                    <Button onClick={saveRename} disabled={!renaming.name.trim() || mut.rename.isPending}>Save</Button>
                    <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="truncate font-medium text-slate-900" data-testid="device-name">{d.name}</p>
                  <p className="text-xs text-slate-500">{deviceStatusLine(d, now)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" aria-label={`Rename ${d.name}`} data-testid="device-rename" onClick={() => { setRowError(null); setRenaming({ id: d.id, name: d.name }); }}>Rename</Button>
                    <Button variant={armed === d.id ? "danger" : "ghost"} aria-label={armed === d.id ? `Really forget ${d.name}?` : `Forget ${d.name}`} data-testid="device-forget"
                      onClick={() => forget(d)}>{armed === d.id ? "Really forget?" : "Forget"}</Button>
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {rowError ? <p className="text-sm text-red-600" role="alert">{rowError}</p> : null}

      <form className="space-y-2" onSubmit={submitPair} noValidate>
        <h3 className="text-sm font-medium text-slate-700">Pair a device</h3>
        <Field label="Code shown on the device" value={code} inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="one-time-code" data-testid="pair-code"
          onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setPairOk(null); }} />
        <Field label="Device name (optional)" value={pairName} maxLength={32} data-testid="pair-name" onChange={(e) => setPairName(e.target.value)} />
        <Button type="submit" disabled={!PAIR_CODE_RE.test(code) || mut.confirmPair.isPending} data-testid="pair-submit">Pair</Button>
        {pairError ? <p className="text-sm text-red-600" role="alert" data-testid="pair-error">{pairError}</p> : null}
        {pairOk ? <p className="text-sm text-slate-600" role="status" data-testid="pair-success">{pairOk}</p> : null}
      </form>
    </div>
  );
}
