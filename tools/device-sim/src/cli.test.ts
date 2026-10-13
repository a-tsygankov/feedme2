import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { SimSnapshot } from "./sim.ts";

const PKG = fileURLToPath(new URL("..", import.meta.url));
const QR_TOKEN = "Ab-_".repeat(10) + "xyz";
const DEVICE = "b".repeat(32);

/** Runs the real CLI in a child process (async: the fake server lives in this process's event loop). */
function cli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], { cwd: PKG, timeout: 30_000 }, (err, stdout, stderr) => {
      resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr });
    });
  });
}

describe("device-sim CLI login-qr", () => {
  let server: Server;
  let api: string;
  let dir: string;
  const seen: Array<{ path: string; auth: string | undefined }> = [];

  beforeAll(async () => {
    server = createServer((req, res) => {
      seen.push({ path: req.url ?? "", auth: req.headers.authorization });
      if (req.url === "/api/auth/login-token-create" && req.method === "POST" && req.headers.authorization === "Bearer tok") {
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ token: QR_TOKEN, expiresInSec: 60 }));
      } else res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "unauthorized" }));
    });
    await new Promise<void>((f) => server.listen(0, "127.0.0.1", f));
    api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    dir = mkdtempSync(join(tmpdir(), "device-sim-cli-"));
  });
  afterAll(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const snapshot = (name: string, token: string | null): string => {
    const file = join(dir, name);
    const snap: SimSnapshot = { deviceId: DEVICE, token, houseId: token ? "h" : null, etag: null, state: null, queue: [], logs: [], apiBase: api };
    writeFileSync(file, JSON.stringify(snap));
    return file;
  };

  it("prints the sign-in url on the default web base and the seconds left for a paired device", async () => {
    const r = await cli(["--state", snapshot("paired.json", "tok"), "login-qr"]);
    expect(r.stderr).toBe("");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`https://feedme2-webapp.pages.dev/qr?deviceId=${DEVICE}&token=${QR_TOKEN}`);
    expect(r.stdout).toMatch(/\b60 s\b/);
    expect(seen.at(-1)).toEqual({ path: "/api/auth/login-token-create", auth: "Bearer tok" });
  }, 40_000);

  it("uses --web as the web base", async () => {
    const r = await cli(["--state", snapshot("paired-web.json", "tok"), "login-qr", "--web", "http://127.0.0.1:5192/"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`http://127.0.0.1:5192/qr?deviceId=${DEVICE}&token=${QR_TOKEN}`);
  }, 40_000);

  it("exits 1 when the device is not paired, without calling the api", async () => {
    const before = seen.length;
    const r = await cli(["--state", snapshot("unpaired.json", null), "login-qr"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("not paired");
    expect(r.stdout).toBe("");
    expect(seen.length).toBe(before);
  }, 40_000);
});
