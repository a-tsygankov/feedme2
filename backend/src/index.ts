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
  const path = new URL(c.req.url).pathname;
  const skip = path === "/api/health" || path.startsWith("/api/debug");
  // Hono's compose() catches a thrown handler error at the layer where
  // it happens (converting it to a response via the default error
  // handler) rather than rejecting next() here, so wrapping this in
  // try/catch never sees the error — c.error is how it surfaces instead.
  await next();
  if (skip) return;
  if (c.error) {
    log.error("request failed", {
      method: c.req.method,
      path,
      durationMs: Date.now() - start,
      error: c.error.message,
    });
    return;
  }
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
