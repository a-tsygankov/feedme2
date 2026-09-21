/**
 * Worker bindings + config. Secrets are set via `wrangler secret put`
 * (scripts/setup-secrets.ps1); vars live in wrangler.toml [vars].
 */
export type Bindings = {
  DB: D1Database;
  FIRMWARE: R2Bucket;
  ENVIRONMENT: string;
  AUTH_SECRET: string;
};
