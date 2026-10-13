import type { Bindings } from "./env.ts";
import { db } from "./db/client.ts";
import { LoginQrTokensRepo } from "./repos/login-qr-tokens.ts";
import { LogsRepo } from "./repos/logs.ts";
import { PairingsRepo } from "./repos/pairings.ts";
import { RefreshTokensRepo } from "./repos/refresh-tokens.ts";
import { log } from "./logger.ts";

/**
 * Hourly retention. The prunes are independent: a failing log prune must
 * not leave expired refresh tokens (or expired pairing rows, which can hold a
 * plaintext device token, or old QR login tokens) lying around, so all run
 * and the first failure is rethrown afterwards (the cron shows as failed).
 */
export async function runHousekeeping(env: Bindings, nowMs = Date.now()): Promise<void> {
  const d = db(env.DB);
  const [logs, tokens, pairings, qrTokens] = await Promise.allSettled([
    new LogsRepo(d).prune(nowMs),
    new RefreshTokensRepo(d).pruneExpired(nowMs),
    new PairingsRepo(d).pruneExpired(nowMs),
    new LoginQrTokensRepo(d).pruneExpired(nowMs),
  ]);
  const failed = [logs, tokens, pairings, qrTokens].find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed || logs.status === "rejected" || tokens.status === "rejected" || pairings.status === "rejected" || qrTokens.status === "rejected") {
    const state = (r: PromiseSettledResult<number>) => (r.status === "rejected" ? String(r.reason) : "ok");
    log.error("housekeeping failed", { logs: state(logs), tokens: state(tokens), pairings: state(pairings), qrTokens: state(qrTokens) });
    throw failed!.reason;
  }
  log.info("housekeeping", { logs: logs.value, tokens: tokens.value, pairings: pairings.value, qrTokens: qrTokens.value });
}
