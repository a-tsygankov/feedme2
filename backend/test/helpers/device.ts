import { SELF, env } from "cloudflare:test";
import { PairCheckResponseSchema, PairStartResponseSchema } from "@feedme2/shared";
import { signup } from "./api.ts";

let n = 0;
export function newDeviceId(): string {
  return (++n).toString(16).padStart(4, "0") + crypto.randomUUID().replace(/-/g, "").slice(4);
}

/** Pairs a fresh device to the given (or a fresh) house through the real routes. */
export async function pairDevice(house?: Awaited<ReturnType<typeof signup>>, name = "Kitchen") {
  const s = house ?? (await signup());
  const deviceId = newDeviceId();
  const start = PairStartResponseSchema.parse(
    await (await SELF.fetch("http://feedme2/api/pair/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId, hwModel: "device-sim", fwVersion: "0.2.0" }) })).json(),
  );
  const confirm = await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: start.pairCode, name }) });
  if (confirm.status !== 201) throw new Error(`confirm failed: ${confirm.status} ${await confirm.text()}`);
  const check = PairCheckResponseSchema.parse(
    await (await SELF.fetch("http://feedme2/api/pair/check", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ deviceId }) })).json(),
  );
  if (check.status !== "confirmed") throw new Error(`check: ${check.status}`);
  const fetchDevice = (path: string, init: RequestInit = {}) =>
    SELF.fetch(`http://feedme2${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${check.deviceToken}`, ...(init.headers ?? {}) } });
  return { house: s, deviceId, token: check.deviceToken, fetchDevice };
}

export { env };
