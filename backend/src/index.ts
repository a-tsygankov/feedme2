import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "./env.ts";
import { runHousekeeping } from "./cron.ts";
import { db } from "./db/client.ts";
import { log } from "./logger.ts";
import { verifyAccessToken } from "./auth/tokens.ts";
import type { AuthVars } from "./middleware/auth.ts";
import { flushRequestLogs, runWithRequestContext } from "./request-context.ts";
import { authRouter } from "./routes/auth.ts";
import { catsRouter } from "./routes/cats.ts";
import { debugRouter } from "./routes/debug.ts";
import { feedingsRouter } from "./routes/feedings.ts";
import { houseRouter } from "./routes/house.ts";
import { logsRouter } from "./routes/logs.ts";
import { versionRouter } from "./routes/version.ts";

const app = new Hono<{ Bindings: Bindings } & AuthVars>();

// Request log + persistence. Every log line written while serving the
// request is queued on its store (see D1Sink) and written to D1 after
// the response, attributed to the house whose token signed the request.
// The token is read here, independently of requireHouse, so a public
// route (/api/version) or a handler that fails before auth is still
// attributed when a valid token was sent; no token or a bad one yields
// house-less rows that no one can read back. Skips the health probe and
// /api/debug/* so the console polling for logs does not generate the
// logs it displays.
app.use("*", async (c, next) => {
  const start = Date.now();
  const path = new URL(c.req.url).pathname;
  const skip = path === "/api/health" || path.startsWith("/api/debug");
  // Same scheme parsing as requireHouse: the scheme is case-insensitive.
  const token = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header("Authorization") ?? "")?.[1] ?? "";
  const auth = token ? await verifyAccessToken(token, c.env.AUTH_SECRET) : null;
  await runWithRequestContext(auth?.houseId ?? null, async () => {
    // Hono's compose() hands a thrown handler error to app.onError and
    // records it on c.error rather than rejecting next(), so a
    // try/catch here would never see it.
    await next();
    if (!skip) {
      if (c.error) {
        // A 4xx HTTPException (malformed JSON, say) is the client's
        // mistake, not ours: warn, so error-level stays a real alarm.
        const clientFault = c.error instanceof HTTPException && c.error.status < 500;
        const fields = { method: c.req.method, path, status: c.res.status, durationMs: Date.now() - start, error: c.error.message };
        if (clientFault) log.warn("request failed", fields);
        else log.error("request failed", fields);
      } else {
        log.info("request", { method: c.req.method, path, status: c.res.status, durationMs: Date.now() - start });
      }
    }
    // executionCtx throws when there is none (app.request in unit tests):
    // then await the write instead of handing it to waitUntil.
    let ctx: Pick<ExecutionContext, "waitUntil"> | null;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = null;
    }
    await flushRequestLogs(db(c.env.DB), ctx);
  });
});

// Anything a handler throws that is not already a Response: HTTPExceptions
// (validator rejections, malformed JSON) keep their own status and body;
// the rest become a uniform JSON 500 instead of Hono's plain-text one,
// so the client's error handling never has to parse "Internal Server Error".
app.onError((err, c) => {
  if (err instanceof HTTPException) return err.getResponse();
  log.error("unhandled", {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    name: err.name,
    error: err.message,
    stack: err.stack?.slice(0, 1000),
  });
  return c.json({ error: "internal" }, 500);
});

app.get("/api/health", (c) => c.json({ ok: true, env: c.env.ENVIRONMENT, ts: Date.now() }));

app.route("/api/version", versionRouter);
app.route("/api/debug", debugRouter);
app.route("/api/auth", authRouter);
app.route("/api/house", houseRouter);
app.route("/api/cats", catsRouter);
app.route("/api/feedings", feedingsRouter);
app.route("/api/logs", logsRouter);

export { app };

export default {
  fetch: app.fetch,
  // Hourly ([triggers] in wrangler.toml): log retention and expired
  // refresh tokens (spec §3.4).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runHousekeeping(env));
  },
} satisfies ExportedHandler<Bindings>;
