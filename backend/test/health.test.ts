import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /api/health", () => {
  it("answers with ok, the env, and a timestamp", async () => {
    const res = await SELF.fetch("http://feedme2/api/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; env: string; ts: number };
    expect(body.ok).toBe(true);
    expect(body.env).toBe("development");
    expect(typeof body.ts).toBe("number");
  });
});
