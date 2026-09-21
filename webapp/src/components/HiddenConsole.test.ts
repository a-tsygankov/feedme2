import { describe, expect, it } from "vitest";
import { makeConsoleDataSource } from "./HiddenConsole.tsx";

const respond = (status: number, body: unknown): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status }))) as typeof fetch;

describe("makeConsoleDataSource.getWorkerLogs", () => {
  it("returns the entries of a well-formed response", async () => {
    const ds = makeConsoleDataSource(respond(200, { entries: [{ ts: 1, level: "info", source: "worker", msg: "hi" }] }));
    expect(await ds.getWorkerLogs(10)).toEqual([{ ts: 1, level: "info", source: "worker", msg: "hi" }]);
  });
  it("returns null for a non-2xx, a malformed body, or a thrown fetch", async () => {
    expect(await makeConsoleDataSource(respond(500, { entries: [] })).getWorkerLogs(10)).toBeNull();
    expect(await makeConsoleDataSource(respond(200, { nope: true })).getWorkerLogs(10)).toBeNull();
    const failing = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await makeConsoleDataSource(failing).getWorkerLogs(10)).toBeNull();
  });
});
