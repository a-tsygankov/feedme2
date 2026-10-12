import type { Device } from "@feedme2/shared";
import { ApiError, NetworkError } from "./api-client.ts";
import { relativeTime } from "./relative-time.ts";

export function pairErrorMessage(err: unknown): string {
  if (err instanceof NetworkError) return "Check your connection.";
  if (err instanceof ApiError) {
    const code = typeof err.body === "object" && err.body !== null ? (err.body as { error?: string }).error : undefined;
    // The server's own code, not any 404: a missing route or proxy hiccup is not "code not found".
    if (err.status === 404 && code === "pair_code_unknown") return "That code was not found or has expired. Ask the device for a new one.";
    if (code === "pair_code_used") return "That code was already used.";
    if (err.status === 429 && code === "too_many_attempts") {
      const sec = (err.body as { retryAfterSec?: unknown }).retryAfterSec;
      const minutes = typeof sec === "number" && Number.isFinite(sec) ? Math.ceil(sec / 60) : 1;
      return `Too many wrong codes. Try again in ${minutes <= 1 ? "a minute" : `${minutes} minutes`}.`;
    }
    if (code === "device_in_use") return "That device still belongs to another house. Forget it there first.";
    if (err.status === 400) return "Enter the six digits shown on the device.";
  }
  return "Something went wrong. Try again.";
}

export function deviceStatusLine(d: Device, nowMs: number): string {
  const seen = d.lastSeenAt === null ? "never seen" : `seen ${relativeTime(nowMs, d.lastSeenAt)}`;
  const battery = d.batteryPct === null ? "" : ` · ${d.batteryPct}%`;
  return `fw ${d.fwVersion} · ${seen}${battery}`;
}
