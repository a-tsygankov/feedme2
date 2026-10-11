import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
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
  const [params, setParams] = useSearchParams();
  const pairParam = params.get("pair");
  const root = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState(() => codeFromParam(pairParam));
  const [pairName, setPairName] = useState("");
  const [pairError, setPairError] = useState<string | null>(null);
  const [pairOk, setPairOk] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [rowError, setRowError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const list = devices.data ?? [];

  // Arriving from the QR link: fill the code straight away...
  useEffect(() => {
    const fromLink = codeFromParam(pairParam);
    if (fromLink) setCode(fromLink);
  }, [pairParam]);

  // ...but scroll only once the list has settled: scrolling while the devices query is pending lands short, because the
  // content above the section is still changing height. Once per link, so a later refetch does not yank the page back.
  const settled = !devices.isPending;
  const scrolledFor = useRef<string | null>(null);
  useEffect(() => {
    const fromLink = codeFromParam(pairParam);
    if (!settled || !fromLink || scrolledFor.current === fromLink) return;
    scrolledFor.current = fromLink;
    // jsdom has no scrollIntoView; a mounted test with ?pair= must not throw.
    const el = root.current?.closest("section");
    if (el && typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "start" });
  }, [settled, pairParam]);

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
      onSuccess: ({ device }) => {
        setPairOk(`Paired ${device.name}`); setCode(""); setPairName("");
        // A reload must not re-prefill a code that is now used.
        setParams({}, { replace: true });
      },
      onError: (err) => setPairError(pairErrorMessage(err)),
    });
  }

  function saveRename() {
    if (!renaming) return;
    const name = renaming.name.trim();
    if (!name || mut.rename.isPending) return;
    setRowError(null);
    if (name === list.find((d) => d.id === renaming.id)?.name) { setRenaming(null); return; }
    mut.rename.mutate({ id: renaming.id, patch: { name } }, {
      onSuccess: () => setRenaming(null),
      onError: () => setRowError("Couldn't rename the device. Try again."),
    });
  }

  function cancelRename() {
    setRenaming(null);
    setRowError(null);
  }

  function onRenameKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); saveRename(); }
    else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
  }

  function forget(d: Device) {
    if (armed !== d.id) { setArmed(d.id); return; }
    setArmed(null);
    setRowError(null);
    mut.forget.mutate(d.id, { onError: () => setRowError("Couldn't forget the device. Try again.") });
  }

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
                  <Field label="Device name" value={renaming.name} maxLength={32} onChange={(e) => setRenaming({ id: d.id, name: e.target.value })} data-testid="device-name-input"
                    autoFocus onKeyDown={onRenameKey} />
                  <div className="flex gap-2">
                    <Button onClick={saveRename} disabled={!renaming.name.trim() || mut.rename.isPending}>Save</Button>
                    <Button variant="ghost" onClick={cancelRename}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="truncate font-medium text-slate-900" data-testid="device-name">{d.name}</p>
                  <p className="text-xs text-slate-500">{deviceStatusLine(d, now)}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Button variant="secondary" aria-label={`Rename ${d.name}`} data-testid="device-rename" onClick={() => { setRowError(null); setRenaming({ id: d.id, name: d.name }); }}>Rename</Button>
                    <Button variant={armed === d.id ? "danger" : "ghost"} aria-label={armed === d.id ? `Really forget ${d.name}?` : `Forget ${d.name}`} data-testid="device-forget"
                      disabled={mut.forget.isPending} onClick={() => forget(d)}>{armed === d.id ? "Really forget?" : "Forget"}</Button>
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
        <Field label="Code shown on the device" value={code} inputMode="numeric" pattern="\d{6}" maxLength={6} autoComplete="off" data-testid="pair-code"
          error={pairError ?? undefined} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "")); setPairOk(null); }} />
        <Field label="Device name (optional)" value={pairName} maxLength={32} data-testid="pair-name" onChange={(e) => setPairName(e.target.value)} />
        <Button type="submit" disabled={!PAIR_CODE_RE.test(code) || mut.confirmPair.isPending} data-testid="pair-submit">Pair</Button>
        {/* Always mounted: a live region that appears together with its text is often not announced. */}
        <p className="text-sm text-slate-600 empty:hidden" role="status" data-testid="pair-success">{pairOk}</p>
      </form>
    </div>
  );
}
