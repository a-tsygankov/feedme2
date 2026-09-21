import { SELF } from "cloudflare:test";
import { LogEntrySchema } from "@feedme2/shared";
import { describe, expect, it } from "vitest";
import { z } from "zod";

const Body = z.object({ entries: z.array(LogEntrySchema) });

describe("GET /api/debug/logs", () => {
  it("returns recent worker log lines, oldest first, including the request log", async () => {
    await SELF.fetch("http://feedme2/api/version");
    const res = await SELF.fetch("http://feedme2/api/debug/logs?limit=50");
    expect(res.status).toBe(200);
    const { entries } = Body.parse(await res.json());
    const req = entries.filter((e) => e.msg === "request");
    expect(req.length).toBeGreaterThan(0);
    expect(req.at(-1)?.data).toMatchObject({ method: "GET", path: "/api/version", status: 200 });
    expect(entries.every((e) => e.source === "worker")).toBe(true);
  });

  it("clamps limit to 100 and defaults to 100", async () => {
    for (let i = 0; i < 120; i++) await SELF.fetch("http://feedme2/api/version");
    const res = await SELF.fetch("http://feedme2/api/debug/logs?limit=5000");
    const { entries } = Body.parse(await res.json());
    expect(entries.length).toBe(100);
  });

  it("does not log its own requests", async () => {
    await SELF.fetch("http://feedme2/api/debug/logs");
    const res = await SELF.fetch("http://feedme2/api/debug/logs");
    const { entries } = Body.parse(await res.json());
    expect(entries.some((e) => (e.data as { path?: string } | undefined)?.path?.startsWith("/api/debug"))).toBe(false);
  });
});
