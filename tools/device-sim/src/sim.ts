/**
 * A fake CrowPanel that speaks the device API exactly (spec §5.7 item 3),
 * using the shared zod contracts so a server change breaks this before
 * it breaks the firmware. Used by the Playwright system e2e and by hand
 * from the CLI.
 */
import {
  DeviceFeedingsResponseSchema, DeviceStateSchema, EnteredValueSchema, FoodUnitSchema, HeartbeatResponseSchema, LogLevelSchema,
  PairCheckResponseSchema, PairStartResponseSchema,
  type DeviceFeedingCreate, type DeviceState, type FoodUnit, type HwModel, type LogUploadEntry, type PairCheckResponse, type PairStartResponse,
} from "@feedme2/shared";

export class SimError extends Error {
  constructor(readonly status: number, readonly body: unknown, message = `api ${status}`) {
    super(message);
    this.name = "SimError";
  }
}

export interface SimSnapshot {
  deviceId: string;
  token: string | null;
  houseId: string | null;
  etag: string | null;
  state: DeviceState | null;
  queue: DeviceFeedingCreate[];
  logs: LogUploadEntry[];
  /**
   * Per-handshake secret from the last pairStart(). Persisted so a CLI run that restarts between start and
   * confirm can still collect its token; absent in snapshots saved before the server required it.
   */
  pollSecret?: string;
  /** Where this device last talked to; the CLI reuses it so a later `--api` is only needed to move the device. */
  apiBase?: string;
}

export interface SimOptions {
  apiBase: string;
  deviceId?: string;
  hwModel?: HwModel;
  fwVersion?: string;
  /** Reported by every heartbeat when set; omitted otherwise (a mains-powered device has no battery). */
  batteryPct?: number;
  fetchFn?: typeof fetch;
  now?: () => number;
}

export interface SyncSummary {
  feedingsSent: number;
  feedingsAccepted: number;
  clamped: number;
  logsSent: number;
  stateChanged: boolean;
  heartbeat: boolean;
  stoppedBy?: string;
}

const hex32 = () => crypto.randomUUID().replace(/-/g, "");
/** 32 hex chars from the CSPRNG (the server requires 32-64). */
const pollSecret32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join("");

// The server's own limits (shared/src/api.ts amountMg, log msg): checked here so a typo fails at the keyboard
// instead of as a poisoned queue entry that the server rejects on every sync.
const MAX_AMOUNT_MG = 5_000_000;
const MAX_MSG_LENGTH = 500;
const MAX_LOGS = 500;

/** Whole grams when within 0.05 of one, otherwise one decimal (so 800 mg is "0.8", not "1"). */
function gramsText(mg: number): string {
  const g = mg / 1000;
  // Snapping needs a whole gram >= 1: 1-50 mg would otherwise become "0", which the server refuses as "not a positive amount".
  if (Math.round(g) >= 1 && Math.abs(g - Math.round(g)) <= 0.05) return String(Math.round(g));
  const oneDecimal = g.toFixed(1);
  // Still "0.0" below 0.05 g: keep one significant digit (24 mg -> "0.02", 1 mg -> "0.001").
  return oneDecimal === "0.0" ? g.toPrecision(1) : oneDecimal;
}

export class DeviceSim {
  readonly deviceId: string;
  private readonly apiBase: string;
  private readonly hwModel: HwModel;
  private readonly fwVersion: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly batteryPct: number | undefined;
  private readonly bootedAt: number;
  private snap: SimSnapshot;

  constructor(opts: SimOptions, snap?: SimSnapshot) {
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.hwModel = opts.hwModel ?? "device-sim";
    this.fwVersion = opts.fwVersion ?? "0.2.0";
    // Bound: calling a detached `fetch` throws "Illegal invocation" in some runtimes.
    this.fetchFn = opts.fetchFn ?? fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.batteryPct = opts.batteryPct;
    this.bootedAt = this.now();
    this.deviceId = snap?.deviceId ?? opts.deviceId ?? hex32();
    this.snap = snap ?? { deviceId: this.deviceId, token: null, houseId: null, etag: null, state: null, queue: [], logs: [] };
    this.snap.apiBase = this.apiBase;
  }

  static fromSnapshot(opts: SimOptions, snap: SimSnapshot): DeviceSim {
    return new DeviceSim(opts, snap);
  }

  snapshot(): SimSnapshot {
    return structuredClone(this.snap);
  }

  private async call(path: string, init: RequestInit & { auth?: boolean } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    if (init.auth !== false && this.snap.token) headers.set("authorization", `Bearer ${this.snap.token}`);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.apiBase}${path}`, { ...init, headers, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      throw new SimError(0, null, `network: ${(err as Error).message}`);
    }
    if (!res.ok && res.status !== 304) {
      let body: unknown = null;
      try { body = await res.json(); } catch { /* text or empty */ }
      throw new SimError(res.status, body);
    }
    return res;
  }

  async pairStart(): Promise<PairStartResponse> {
    // A fresh secret per handshake: only the device that started it can collect the token from the public /check.
    this.snap.pollSecret = pollSecret32();
    const r = await this.call("/api/pair/start", { method: "POST", auth: false, body: JSON.stringify({ deviceId: this.deviceId, hwModel: this.hwModel, fwVersion: this.fwVersion, pollSecret: this.snap.pollSecret }) });
    return PairStartResponseSchema.parse(await r.json());
  }

  async pairCheck(): Promise<PairCheckResponse> {
    // A snapshot saved before the server required the secret would poll forever and only ever see 400s.
    if (!this.snap.pollSecret) throw new SimError(400, null, "pairing has no poll secret; run pair again");
    const r = await this.call("/api/pair/check", { method: "POST", auth: false, body: JSON.stringify({ deviceId: this.deviceId, pollSecret: this.snap.pollSecret }) });
    const body = PairCheckResponseSchema.parse(await r.json());
    if (body.status === "confirmed") {
      this.snap.token = body.deviceToken;
      this.snap.houseId = body.houseId;
    }
    return body;
  }

  async pairUntilConfirmed({ timeoutMs = 120_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
    if (!this.snap.pollSecret) throw new SimError(400, null, "pairing has no poll secret; run pair again");
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const r = await this.pairCheck();
      if (r.status === "confirmed") return;
      if (r.status === "expired" || r.status === "unknown") throw new SimError(410, r, `pairing ${r.status}`);
      await new Promise((f) => setTimeout(f, intervalMs));
    }
    throw new SimError(408, null, "pairing timed out");
  }

  async fetchState(): Promise<{ changed: boolean; state: DeviceState }> {
    const r = await this.call("/api/device/state", { headers: this.snap.etag ? { "if-none-match": this.snap.etag } : {} });
    if (r.status === 304) {
      if (!this.snap.state) throw new SimError(304, null, "304 without a cached state");
      return { changed: false, state: this.snap.state };
    }
    const state = DeviceStateSchema.parse(await r.json());
    this.snap.state = state;
    this.snap.etag = r.headers.get("etag");
    return { changed: true, state };
  }

  /** Queue a feeding like a knob press would; `cat` is a name or an id from the last state. */
  feed(cat: string, amountMg?: number, entered?: { unit: FoodUnit; value: string }): DeviceFeedingCreate {
    const c = this.snap.state?.cats.find((x) => x.id === cat || x.name === cat);
    if (!c) throw new Error(`unknown cat ${cat}`);
    const mg = amountMg ?? c.defaultAmountMg ?? 40_000;
    if (!Number.isInteger(mg) || mg < 1 || mg > MAX_AMOUNT_MG) throw new Error(`amountMg must be an integer from 1 to ${MAX_AMOUNT_MG}, got ${mg}`);
    const e = entered ?? (amountMg === undefined && c.defaultEnteredUnit && c.defaultEnteredValue ? { unit: c.defaultEnteredUnit, value: c.defaultEnteredValue } : { unit: "g" as const, value: gramsText(mg) });
    if (!FoodUnitSchema.safeParse(e.unit).success) throw new Error(`unknown entered unit ${String(e.unit)}`);
    if (!EnteredValueSchema.safeParse(e.value).success) throw new Error(`entered value must be a non-empty amount like "40" or "1/3", got "${e.value}"`);
    const item: DeviceFeedingCreate = { id: crypto.randomUUID(), catId: c.id, fedAt: this.now(), amountMg: mg, enteredUnit: e.unit, enteredValue: e.value };
    this.snap.queue.push(item);
    return item;
  }

  log(level: LogUploadEntry["level"], msg: string, data?: Record<string, unknown>): void {
    if (!LogLevelSchema.safeParse(level).success) throw new Error(`unknown log level "${String(level)}" (use ${LogLevelSchema.options.join(", ")})`);
    if (msg.length > MAX_MSG_LENGTH) throw new Error(`log msg is ${msg.length} chars; the limit is ${MAX_MSG_LENGTH}`);
    // A new array, never an in-place splice: an upload in flight holds the old entries by reference (see syncRound).
    this.snap.logs = [...this.snap.logs, { ts: this.now(), level, msg, ...(data ? { data } : {}) }].slice(-MAX_LOGS);
  }

  async heartbeat(): Promise<void> {
    const r = await this.call("/api/device/heartbeat", { method: "POST", body: JSON.stringify({ fwVersion: this.fwVersion, uptimeSec: Math.floor((this.now() - this.bootedAt) / 1000), resetReason: "SIM", freeHeap: 200_000, ...(this.batteryPct === undefined ? {} : { batteryPct: this.batteryPct }) }) });
    HeartbeatResponseSchema.parse(await r.json());
  }

  /** Drop exactly the entries that were uploaded. Positions may have shifted while the request was in flight
   * (log() trims the head at 500), so a head splice of batch.length would delete entries that were never sent. */
  private removeSent<T>(list: T[], sent: T[]): void {
    const gone = new Set(sent);
    const kept = list.filter((x) => !gone.has(x));
    list.splice(0, list.length, ...kept);
  }

  /** Spec §5.3: feedings → logs → state → heartbeat. A transport or 5xx failure stops the round and keeps the queues.
   * A non-transient 4xx (401 after a forget, 422 for a bad item) is rethrown with the item still at the head of its
   * queue, on purpose: dropping it would silently lose a feeding, and the 4xx tells the human something is wrong. */
  async syncRound(): Promise<SyncSummary> {
    const s: SyncSummary = { feedingsSent: 0, feedingsAccepted: 0, clamped: 0, logsSent: 0, stateChanged: false, heartbeat: false };
    const transient = (e: unknown) => e instanceof SimError && (e.status === 0 || e.status >= 500 || e.status === 408 || e.status === 429);
    try {
      while (this.snap.queue.length > 0) {
        const batch = this.snap.queue.slice(0, 100);
        const r = await this.call("/api/device/feedings", { method: "POST", body: JSON.stringify(batch) });
        const body = DeviceFeedingsResponseSchema.parse(await r.json());
        s.feedingsSent += batch.length;
        s.feedingsAccepted += body.accepted.length;
        s.clamped += body.clamped.length;
        this.removeSent(this.snap.queue, batch);
      }
      while (this.snap.logs.length > 0) {
        const batch = this.snap.logs.slice(0, 50);
        await this.call("/api/device/logs", { method: "POST", body: JSON.stringify(batch) });
        s.logsSent += batch.length;
        this.removeSent(this.snap.logs, batch);
      }
      s.stateChanged = (await this.fetchState()).changed;
      await this.heartbeat();
      s.heartbeat = true;
    } catch (e) {
      if (!transient(e)) throw e;
      s.stoppedBy = (e as SimError).message;
    }
    return s;
  }
}
