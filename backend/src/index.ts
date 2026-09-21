import { Hono } from "hono";
import type { Bindings } from "./env.ts";
import { log } from "./logger.ts";
import { debugRouter } from "./routes/debug.ts";
import { versionRouter } from "./routes/version.ts";

const app = new Hono<{ Bindings: Bindings }>();

// One JSON line per request. Skip the health probe and /api/debug/*
// itself — the console polling for logs must not generate the logs it
// displays.
app.use("*", async (c, next) => {
  const start = Date.now();
  await next();
  const path = new URL(c.req.url).pathname;
  if (path === "/api/health" || path.startsWith("/api/debug")) return;
  log.info("request", {
    method: c.req.method,
    path,
    status: c.res.status,
    durationMs: Date.now() - start,
  });
});

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));

app.route("/api/version", versionRouter);
app.route("/api/debug", debugRouter);

export { app };

export default {
  fetch: app.fetch,
  // Hourly cron ([triggers] in wrangler.toml). Nothing to prune yet;
  // Phase 1 adds log retention and expired-token cleanup here.
  async scheduled(_event, _env, _ctx) {},
} satisfies ExportedHandler<Bindings>;
