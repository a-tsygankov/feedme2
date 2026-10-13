#!/usr/bin/env tsx
/**
 * device-sim CLI: drives one fake device whose whole state lives in a JSON
 * snapshot file, so successive invocations behave like one device across
 * reboots. Usage: see USAGE below.
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { DeviceSim, SimError, type SimSnapshot } from "./sim.ts";

const DEFAULT_API = "http://127.0.0.1:8787";
const DEFAULT_STATE = "./device-sim.json";
const DEFAULT_WEB = "https://feedme2-webapp.pages.dev";

const USAGE = `usage: device-sim [--api <url>] [--state <file>] <command>
  --api <url>           API base (default: the one saved in the state file, else ${DEFAULT_API})
  --state <file>        snapshot file (default: ${DEFAULT_STATE}, relative to the current directory)
  pair                  start pairing, print the code, poll until confirmed
  status                print the snapshot summary
  state                 fetch /api/device/state and list the cats
  feed <cat> [mg]       queue a feeding (cat by name or id)
  log <level> <msg>     queue a device log line (level: debug, info, warn, error; msg up to 500 chars)
  sync                  feedings -> logs -> state -> heartbeat
  heartbeat             post a heartbeat
  login-qr [--web <url>] print a one-time sign-in URL for a phone (web base default: ${DEFAULT_WEB})
  forget-local          delete the snapshot file
  --help                show this text`;

/** Commands that change device state and so rewrite the snapshot. `status` only reads it. */
const SAVES = new Set(["pair", "state", "feed", "log", "sync", "heartbeat"]);
const COMMANDS = new Set([...SAVES, "status", "forget-local", "login-qr"]);

function parseArgs(argv: string[]) {
  let api: string | undefined;
  let stateFile = DEFAULT_STATE;
  let web = DEFAULT_WEB;
  let help = false;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--api") api = argv[++i] ?? api;
    else if (a === "--state") stateFile = argv[++i] ?? stateFile;
    else if (a === "--web") web = argv[++i] ?? web;
    else if (a === "--help" || a === "-h") help = true;
    else rest.push(a);
  }
  return { api, stateFile, web, help, cmd: rest[0], args: rest.slice(1) };
}

async function main(): Promise<void> {
  const { api, stateFile, web, help, cmd, args } = parseArgs(process.argv.slice(2));
  if (help || !cmd) { console.log(USAGE); return; }
  // Checked before any file is read or written: a typo must not create or rewrite a snapshot.
  if (!COMMANDS.has(cmd)) { console.error(`unknown command "${cmd}"\n${USAGE}`); process.exitCode = 1; return; }
  if (cmd === "forget-local") { rmSync(stateFile, { force: true }); console.log(`removed ${stateFile}`); return; }

  const snap = existsSync(stateFile) ? (JSON.parse(readFileSync(stateFile, "utf8")) as SimSnapshot) : undefined;
  const opts = { apiBase: api ?? snap?.apiBase ?? DEFAULT_API };
  const sim = snap ? DeviceSim.fromSnapshot(opts, snap) : new DeviceSim(opts);
  // Temp + rename: a Ctrl-C mid-write must not leave a truncated snapshot that loses the device's token.
  const save = () => {
    const tmp = `${stateFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(sim.snapshot(), null, 2) + "\n");
    renameSync(tmp, stateFile);
  };

  try {
    switch (cmd) {
      case "pair": {
        const before = sim.snapshot();
        if (before.token !== null) console.warn(`warning: already paired to house ${before.houseId}; pairing again replaces the saved token (forget-local starts a fresh device)`);
        const start = await sim.pairStart();
        save();
        console.log(`pair code ${start.pairCode} (device ${sim.deviceId}); enter it in Settings > Devices`);
        // Wait as long as the code lives, not a fixed two minutes: a human has to find it and type it.
        await sim.pairUntilConfirmed({ timeoutMs: Math.max(10_000, start.expiresAt - Date.now()), intervalMs: Math.max(1, start.pollAfterSec) * 1000 });
        console.log("paired");
        break;
      }
      case "status": {
        const s = sim.snapshot();
        console.log(JSON.stringify({ deviceId: s.deviceId, apiBase: s.apiBase, paired: s.token !== null, houseId: s.houseId, etag: s.etag, cats: s.state?.cats.map((c) => c.name) ?? [], queued: s.queue.length, logs: s.logs.length }, null, 2));
        break;
      }
      case "state": {
        const { changed, state } = await sim.fetchState();
        console.log(`${changed ? "changed" : "not modified"}: house ${state.house.name}, device ${state.device.name}`);
        for (const c of state.cats) console.log(`  ${c.name} (${c.id}) lastFedAt=${c.lastFedAt ?? "never"}`);
        break;
      }
      case "feed": {
        const [cat, mg] = args;
        if (!cat) throw new Error("feed needs a cat");
        const f = sim.feed(cat, mg === undefined ? undefined : Number(mg));
        console.log(`queued ${f.id}: ${f.amountMg} mg (${f.enteredValue} ${f.enteredUnit})`);
        break;
      }
      case "log": {
        const [level, ...msg] = args;
        if (!level || msg.length === 0) throw new Error("log needs a level and a message");
        sim.log(level as Parameters<DeviceSim["log"]>[0], msg.join(" "));
        console.log("queued log");
        break;
      }
      case "sync": {
        const summary = await sim.syncRound();
        console.log(JSON.stringify(summary));
        // 2, not 1: a transient failure cut the round short and the queues are kept, so a script can tell "retry" from "broken".
        if (summary.stoppedBy) process.exitCode = 2;
        break;
      }
      case "heartbeat": await sim.heartbeat(); console.log("heartbeat ok"); break;
      case "login-qr": {
        // Not in SAVES: minting a token changes nothing the device keeps, and the token must not land in the snapshot.
        const { token, expiresInSec } = await sim.loginToken();
        console.log(sim.loginUrl(web, token));
        console.log(`valid once, for ${expiresInSec} s`);
        break;
      }
    }
  } catch (e) {
    if (e instanceof SimError) console.error(`${e.message}: ${JSON.stringify(e.body)}`);
    else console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    // Persist even after a failure: a 401 or a half-drained queue is still device state.
    if (SAVES.has(cmd)) save();
  }
}

await main();
