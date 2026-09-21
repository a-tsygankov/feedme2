import { Hono } from "hono";
import type { Bindings } from "./env.ts";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));

export { app };

export default {
  fetch: app.fetch,
  // Hourly cron ([triggers] in wrangler.toml). Nothing to prune yet;
  // Phase 1 adds log retention and expired-token cleanup here.
  async scheduled(_event, _env, _ctx) {},
} satisfies ExportedHandler<Bindings>;
