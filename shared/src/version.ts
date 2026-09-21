import { z } from "zod";

/**
 * GET /api/version. The webapp adds its own build-time version; the
 * worker reports the tiers only it can know. `firmware.latest` is the
 * newest active release (null until Phase 3 lands firmware_releases).
 */
export const VersionResponseSchema = z.object({
  worker: z.object({ version: z.string(), env: z.string() }),
  schema: z.object({ version: z.string().nullable() }),
  firmware: z.object({ latest: z.string().nullable() }),
});

export type VersionResponse = z.infer<typeof VersionResponseSchema>;
