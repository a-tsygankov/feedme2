import type { Bindings } from "./env.ts";
import { db } from "./db/client.ts";
import { LogsRepo } from "./repos/logs.ts";
import { PairingsRepo } from "./repos/pairings.ts";
import { RefreshTokensRepo } from "./repos/refresh-tokens.ts";
import { log } from "./logger.ts";

/**
 * Hourly retention. The prunes are independent: a failing log prune must
 * not leave expired refresh tokens (or expired pairing rows, which hold a
 * plaintext device token) lying around, so all run and the first failure
 * is rethrown afterwards (the cron shows as failed).
 */
export async function runHousekeeping(env: Bindings, nowMs = Date.now()): Promise<void> {
  const d = db(env.DB);
  const [logs, tokens, pairings] = await Promise.allSettled([
    new LogsRepo(d).prune(nowMs),
    new RefreshTokensRepo(d).pruneExpired(nowMs),
    new PairingsRepo(d).pruneExpired(nowMs),
  ]);
  const failed = [logs, tokens, pairings].find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed || logs.status === "rejected" || tokens.status === "rejected" || pairings.status === "rejected") {
    const state = (r: PromiseSettledResult<number>) => (r.status === "rejected" ? String(r.reason) : "ok");
    log.error("housekeeping failed", { logs: state(logs), tokens: state(tokens), pairings: state(pairings) });
    throw failed!.reason;
  }
  log.info("housekeeping", { logs: logs.value, tokens: tokens.value, pairings: pairings.value });
}
