import { Hono } from "hono";
import type { VersionResponse } from "@feedme2/shared";
import type { Bindings } from "../env.ts";
import { WORKER_VERSION, getLatestFirmwareVersion, getSchemaVersion } from "../version.ts";

/** GET /api/version — public: versions must show pre-login. */
export const versionRouter = new Hono<{ Bindings: Bindings }>().get("/", async (c) => {
  const body: VersionResponse = {
    worker: { version: WORKER_VERSION, env: c.env.ENVIRONMENT },
    schema: { version: await getSchemaVersion(c.env.DB) },
    firmware: { latest: await getLatestFirmwareVersion(c.env.DB) },
  };
  return c.json(body);
});
