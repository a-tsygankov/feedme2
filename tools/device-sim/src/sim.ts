/**
 * A fake CrowPanel that speaks the device API exactly (spec §5.7 item 3),
 * using the shared zod contracts so a server change breaks this before
 * it breaks the firmware. Used by the Playwright system e2e and by hand
 * from the CLI.
 */
import {
  DeviceFeedingsResponseSchema, DeviceStateSchema, HeartbeatResponseSchema, PairCheckResponseSchema, PairStartResponseSchema,
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
}

export interface SimOptions {
  apiBase: string;
  deviceId?: string;
  hwModel?: HwModel;
  fwVersion?: string;
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

export class DeviceSim {
  readonly deviceId: string;
  private readonly apiBase: string;
  private readonly hwModel: HwModel;
  private readonly fwVersion: string;
  private readonly fetchFn: typeof fetch;
  private readonly now: () => number;
  private readonly bootedAt: number;
  private snap: SimSnapshot;

  constructor(opts: SimOptions, snap?: SimSnapshot) {
    this.apiBase = opts.apiBase.replace(/\/$/, "");
    this.hwModel = opts.hwModel ?? "device-sim";
    this.fwVersion = opts.fwVersion ?? "0.2.0";
    this.fetchFn = opts.fetchFn ?? fetch;
    this.now = opts.now ?? Date.now;
    this.bootedAt = this.now();
    this.deviceId = snap?.deviceId ?? opts.deviceId ?? hex32();
    this.snap = snap ?? { deviceId: this.deviceId, token: null, houseId: null, etag: null, state: null, queue: [], logs: [] };
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
    const r = await this.call("/api/pair/start", { method: "POST", auth: false, body: JSON.stringify({ deviceId: this.deviceId, hwModel: this.hwModel, fwVersion: this.fwVersion }) });
    return PairStartResponseSchema.parse(await r.json());
  }

  async pairCheck(): Promise<PairCheckResponse> {
    const r = await this.call("/api/pair/check", { method: "POST", auth: false, body: JSON.stringify({ deviceId: this.deviceId }) });
    const body = PairCheckResponseSchema.parse(await r.json());
    if (body.status === "confirmed") {
      this.snap.token = body.deviceToken;
      this.snap.houseId = body.houseId;
    }
    return body;
  }

  async pairUntilConfirmed({ timeoutMs = 120_000, intervalMs = 500 }: { timeoutMs?: number; intervalMs?: number } = {}): Promise<void> {
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
    const e = entered ?? (amountMg === undefined && c.defaultEnteredUnit && c.defaultEnteredValue ? { unit: c.defaultEnteredUnit, value: c.defaultEnteredValue } : { unit: "g" as const, value: String(Math.round(mg / 1000)) });
    const item: DeviceFeedingCreate = { id: crypto.randomUUID(), catId: c.id, fedAt: this.now(), amountMg: mg, enteredUnit: e.unit, enteredValue: e.value };
    this.snap.queue.push(item);
    return item;
  }

  log(level: LogUploadEntry["level"], msg: string, data?: Record<string, unknown>): void {
    this.snap.logs.push({ ts: this.now(), level, msg, ...(data ? { data } : {}) });
    if (this.snap.logs.length > 500) this.snap.logs.splice(0, this.snap.logs.length - 500);
  }

  async heartbeat(): Promise<void> {
    const r = await this.call("/api/device/heartbeat", { method: "POST", body: JSON.stringify({ fwVersion: this.fwVersion, uptimeSec: Math.floor((this.now() - this.bootedAt) / 1000), resetReason: "SIM", freeHeap: 200_000 }) });
    HeartbeatResponseSchema.parse(await r.json());
  }

  /** Spec §5.3: feedings → logs → state → heartbeat. A transport or 5xx failure stops the round and keeps the queues. */
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
        this.snap.queue.splice(0, batch.length);
      }
      while (this.snap.logs.length > 0) {
        const batch = this.snap.logs.slice(0, 50);
        await this.call("/api/device/logs", { method: "POST", body: JSON.stringify(batch) });
        s.logsSent += batch.length;
        this.snap.logs.splice(0, batch.length);
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
