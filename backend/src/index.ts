import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { Bindings } from "./env.ts";
import { runHousekeeping } from "./cron.ts";
import { db } from "./db/client.ts";
import { log } from "./logger.ts";
import { verifyDeviceToken } from "./auth/device-tokens.ts";
import { verifyAccessToken } from "./auth/tokens.ts";
import type { AuthVars } from "./middleware/auth.ts";
import { beginFinalLine, flushRequestLogs, parseClientId, runWithRequestContext } from "./request-context.ts";
import { authRouter } from "./routes/auth.ts";
import { catsRouter } from "./routes/cats.ts";
import { debugRouter } from "./routes/debug.ts";
import { feedingsRouter } from "./routes/feedings.ts";
import { houseRouter } from "./routes/house.ts";
import { logsRouter } from "./routes/logs.ts";
import { pairRouter } from "./routes/pair.ts";
import { devicesRouter } from "./routes/devices.ts";
import { deviceRouter } from "./routes/device.ts";
import { versionRouter } from "./routes/version.ts";

/** Keeps a worker row's data under the repo's 1 KB cap with room for the other fields. */
const MAX_ERROR_CHARS = 300;
const MAX_PATH_CHARS = 120;
const MAX_STACK_CHARS = 400;

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
  // A house access token or a device token (spec §3.2): both attribute the
  // request to a house; only a device token also names the device.
  const houseAuth = token ? await verifyAccessToken(token, c.env.AUTH_SECRET) : null;
  const deviceAuth = token && !houseAuth ? await verifyDeviceToken(token, c.env.AUTH_SECRET) : null;
  const auth = houseAuth ?? deviceAuth;
  const clientId = parseClientId(c.req.header("x-client-id"));
  await runWithRequestContext({ houseId: auth?.houseId ?? null, clientId, deviceId: deviceAuth?.deviceId }, async () => {
    // Hono's compose() hands a thrown handler error to app.onError and
    // records it on c.error rather than rejecting next(), so a
    // try/catch here would never see it.
    await next();
    if (!skip) {
      // The request line must survive a handler that flooded the log.
      beginFinalLine();
      // Capped: both fields are attacker-influenced and the row's data is limited to 1 KB.
      const fields = { method: c.req.method, path: path.slice(0, MAX_PATH_CHARS), status: c.res.status, durationMs: Date.now() - start };
      if (c.error) {
        // A 4xx HTTPException (malformed JSON, say) is the client's
        // mistake, not ours: warn, so error-level stays a real alarm.
        const clientFault = c.error instanceof HTTPException && c.error.status < 500;
        const failed = { ...fields, error: c.error.message.slice(0, MAX_ERROR_CHARS) };
        if (clientFault) log.warn("request failed", failed);
        else log.error("request failed", failed);
      } else if (fields.status >= 500) {
        log.error("request", fields);
      } else if (fields.status >= 400 && auth) {
        // Anonymous 4xx (scanners, 404s, 401s) stays info: a warn would be
        // persisted, and unauthenticated callers must not buy D1 writes.
        log.warn("request", fields);
      } else {
        log.info("request", fields);
      }
    }
    // executionCtx throws when there is none (app.request in unit tests):
    // then await the write instead of handing it to waitUntil. Local dev
    // awaits too: a waitUntil write races the client's next read (the
    // hidden console polling right after an action), which is only a
    // cosmetic flake in production but makes dev and tests nondeterministic.
    let ctx: Pick<ExecutionContext, "waitUntil"> | null;
    try {
      ctx = c.env.ENVIRONMENT === "development" ? null : c.executionCtx;
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
  // The stack is the one line that explains a 500: a handler that flooded the log first must not evict it.
  beginFinalLine();
  log.error("unhandled", {
    method: c.req.method,
    path: new URL(c.req.url).pathname.slice(0, MAX_PATH_CHARS),
    name: err.name.slice(0, 40),
    error: err.message.slice(0, MAX_ERROR_CHARS),
    stack: err.stack?.slice(0, MAX_STACK_CHARS),
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
app.route("/api/pair", pairRouter);
app.route("/api/devices", devicesRouter);
app.route("/api/device", deviceRouter);

export { app };

export default {
  fetch: app.fetch,
  // Hourly ([triggers] in wrangler.toml): log retention and expired
  // refresh tokens (spec §3.4).
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(runHousekeeping(env));
  },
} satisfies ExportedHandler<Bindings>;
