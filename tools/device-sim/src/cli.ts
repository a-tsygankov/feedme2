#!/usr/bin/env tsx
/**
 * device-sim CLI: drives one fake device whose whole state lives in a JSON
 * snapshot file, so successive invocations behave like one device across
 * reboots. Usage: see USAGE below.
 */
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { DeviceSim, SimError, type SimSnapshot } from "./sim.ts";

const USAGE = `usage: device-sim [--api <url>] [--state <file>] <command>
  pair                  start pairing, print the code, poll until confirmed
  status                print the snapshot summary
  state                 fetch /api/device/state and list the cats
  feed <cat> [mg]       queue a feeding (cat by name or id)
  log <level> <msg>     queue a device log line
  sync                  feedings -> logs -> state -> heartbeat
  heartbeat             post a heartbeat
  forget-local          delete the snapshot file`;

function parseArgs(argv: string[]) {
  let api = "http://127.0.0.1:8787";
  let stateFile = "./device-sim.json";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--api") api = argv[++i] ?? api;
    else if (a === "--state") stateFile = argv[++i] ?? stateFile;
    else rest.push(a);
  }
  return { api, stateFile, cmd: rest[0], args: rest.slice(1) };
}

async function main(): Promise<void> {
  const { api, stateFile, cmd, args } = parseArgs(process.argv.slice(2));
  if (!cmd) { console.log(USAGE); return; }
  if (cmd === "forget-local") { rmSync(stateFile, { force: true }); console.log(`removed ${stateFile}`); return; }

  const opts = { apiBase: api };
  const sim = existsSync(stateFile)
    ? DeviceSim.fromSnapshot(opts, JSON.parse(readFileSync(stateFile, "utf8")) as SimSnapshot)
    : new DeviceSim(opts);
  const save = () => writeFileSync(stateFile, JSON.stringify(sim.snapshot(), null, 2) + "\n");

  try {
    switch (cmd) {
      case "pair": {
        const start = await sim.pairStart();
        save();
        console.log(`pair code ${start.pairCode} (device ${sim.deviceId}); enter it in Settings > Devices`);
        await sim.pairUntilConfirmed({ intervalMs: Math.max(1, start.pollAfterSec) * 1000 });
        console.log("paired");
        break;
      }
      case "status": {
        const s = sim.snapshot();
        console.log(JSON.stringify({ deviceId: s.deviceId, paired: s.token !== null, houseId: s.houseId, etag: s.etag, cats: s.state?.cats.map((c) => c.name) ?? [], queued: s.queue.length, logs: s.logs.length }, null, 2));
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
      case "sync": console.log(JSON.stringify(await sim.syncRound())); break;
      case "heartbeat": await sim.heartbeat(); console.log("heartbeat ok"); break;
      default: console.log(USAGE); process.exitCode = 1;
    }
  } catch (e) {
    if (e instanceof SimError) console.error(`${e.message}: ${JSON.stringify(e.body)}`);
    else console.error((e as Error).message);
    process.exitCode = 1;
  } finally {
    // Persist even after a failure: a 401 or a half-drained queue is still device state.
    if (cmd !== "forget-local") save();
  }
}

await main();
