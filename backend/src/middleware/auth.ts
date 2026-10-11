import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../env.ts";
import { verifyAccessToken } from "../auth/tokens.ts";

export type AuthVars = { Variables: { houseId: string } };

/**
 * Bearer access token → c.var.houseId. Downstream handlers and repos
 * take the house id ONLY from here, never from the request — that is
 * the entire multi-tenancy boundary. Uniform 401s: no hint whether the
 * token was missing, malformed or expired.
 */
export function requireHouse(): MiddlewareHandler<{ Bindings: Bindings } & AuthVars> {
  return async (c, next) => {
    const header = c.req.header("Authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const auth = token ? await verifyAccessToken(token, c.env.AUTH_SECRET) : null;
    if (!auth) return c.json({ error: "unauthorized" }, 401);
    c.set("houseId", auth.houseId);
    await next();
  };
}
