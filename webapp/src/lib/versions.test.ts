import { describe, expect, it } from "vitest";
import { CLIENT_VERSION, fetchTierVersions } from "./versions.ts";
import pkg from "../../package.json";

const okFetch = (body: unknown): typeof fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))) as typeof fetch;

describe("versions", () => {
  it("CLIENT_VERSION is the package version", () => {
    expect(CLIENT_VERSION).toBe(pkg.version);
  });

  it("maps /api/version into tier versions", async () => {
    const v = await fetchTierVersions(
      okFetch({
        worker: { version: "0.1.4", env: "production" },
        schema: { version: "0000_init.sql" },
        firmware: { latest: "0.1.0" },
      }),
    );
    expect(v).toEqual({ client: pkg.version, worker: "0.1.4", schema: "0000_init.sql", firmware: "0.1.0", env: "production" });
  });

  it("degrades to nulls when the worker is unreachable or returns junk", async () => {
    const failing = (() => Promise.reject(new Error("offline"))) as typeof fetch;
    expect(await fetchTierVersions(failing)).toEqual({ client: pkg.version, worker: null, schema: null, firmware: null, env: null });
    expect(await fetchTierVersions(okFetch({ nope: 1 }))).toMatchObject({ worker: null });
  });
});
