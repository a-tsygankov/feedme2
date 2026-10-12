import { SELF, env } from "cloudflare:test";
import { PairCheckResponseSchema, PairStartResponseSchema } from "@feedme2/shared";
import { signup } from "./api.ts";

let n = 0;
export function newDeviceId(): string {
  return (++n).toString(16).padStart(4, "0") + crypto.randomUUID().replace(/-/g, "").slice(4);
}

/** What a device generates per handshake: 32 random hex chars. */
export function newPollSecret(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

const postJson = (path: string, body: unknown) =>
  SELF.fetch(`http://feedme2${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

/** POST /api/pair/start as a device would. */
export async function pairStart(deviceId: string, pollSecret: string = newPollSecret(), fwVersion = "0.2.0") {
  const res = await postJson("/api/pair/start", { deviceId, hwModel: "device-sim", fwVersion, pollSecret });
  if (res.status !== 200) throw new Error(`start failed: ${res.status} ${await res.text()}`);
  return { ...PairStartResponseSchema.parse(await res.json()), pollSecret };
}

/** POST /api/pair/check as a device would. */
export async function pairCheck(deviceId: string, pollSecret: string) {
  return PairCheckResponseSchema.parse(await (await postJson("/api/pair/check", { deviceId, pollSecret })).json());
}

/** Pairs a device (fresh by default) to the given (or a fresh) house through the real routes. */
export async function pairDevice(house?: Awaited<ReturnType<typeof signup>>, name = "Kitchen", deviceId: string = newDeviceId()) {
  const s = house ?? (await signup());
  const start = await pairStart(deviceId);
  const confirm = await s.fetchAuthed("/api/pair/confirm", { method: "POST", body: JSON.stringify({ pairCode: start.pairCode, name }) });
  if (confirm.status !== 201) throw new Error(`confirm failed: ${confirm.status} ${await confirm.text()}`);
  const check = await pairCheck(deviceId, start.pollSecret);
  if (check.status !== "confirmed") throw new Error(`check: ${check.status}`);
  const fetchDevice = (path: string, init: RequestInit = {}) =>
    SELF.fetch(`http://feedme2${path}`, { ...init, headers: { "content-type": "application/json", authorization: `Bearer ${check.deviceToken}`, ...(init.headers ?? {}) } });
  return { house: s, deviceId, token: check.deviceToken, fetchDevice };
}

export { env };
