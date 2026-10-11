import type { Context, Env } from "hono";
import type { ZodError } from "zod";

/**
 * Shared `zValidator` hook: one 400 body shape for every route, so the
 * client can show per-field messages without parsing zod's own format.
 */
export const validationHook = <E extends Env, P extends string>(r: { success: boolean; error?: ZodError }, c: Context<E, P>) => {
  if (!r.success) {
    return c.json(
      { error: "invalid_request", issues: (r.error?.issues ?? []).map((i) => ({ path: i.path, message: i.message })) },
      400,
    );
  }
};
