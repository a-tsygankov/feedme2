import type { Bindings } from "./env.ts";
import { db } from "./db/client.ts";
import { LogsRepo } from "./repos/logs.ts";
import { RefreshTokensRepo } from "./repos/refresh-tokens.ts";
import { log } from "./logger.ts";

/**
 * Hourly retention. The two prunes are independent: a failing log prune
 * must not leave expired refresh tokens lying around, so both run and
 * the first failure is rethrown afterwards (the cron shows as failed).
 */
export async function runHousekeeping(env: Bindings, nowMs = Date.now()): Promise<void> {
  const d = db(env.DB);
  const [logs, tokens] = await Promise.allSettled([new LogsRepo(d).prune(nowMs), new RefreshTokensRepo(d).pruneExpired(nowMs)]);
  if (logs.status === "rejected" || tokens.status === "rejected") {
    log.error("housekeeping failed", {
      logs: logs.status === "rejected" ? String(logs.reason) : "ok",
      tokens: tokens.status === "rejected" ? String(tokens.reason) : "ok",
    });
    throw logs.status === "rejected" ? logs.reason : (tokens as PromiseRejectedResult).reason;
  }
  log.info("housekeeping", { logs: logs.value, tokens: tokens.value });
}
